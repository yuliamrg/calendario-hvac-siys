import assert from "node:assert/strict";
import test from "node:test";
import {
  createSupabasePersistence,
  hasPersistedCalendarData,
  isSupabaseConfigEnabled,
  shouldUseSupabaseCloud,
  shouldMigrateLocalDocument,
  SupabaseCloudConflictError,
  SupabaseCloudError,
  supabaseCalendarKeyForChannel
} from "../apps/web/src/cloud.js";
import { SupabaseTransportError } from "../packages/platform/src/supabase/transport.js";

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return payload === null ? "" : JSON.stringify(payload);
    }
  };
}

function storageMock() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    }
  };
}

test("la configuración cloud exige una clave publishable y no acepta una vacía", () => {
  assert.equal(isSupabaseConfigEnabled({ enabled: true, url: "https://example.supabase.co", publishableKey: "sb_publishable_demo" }), true);
  assert.equal(isSupabaseConfigEnabled({ enabled: true, url: "https://example.supabase.co", publishableKey: "" }), false);
  assert.equal(isSupabaseConfigEnabled({ enabled: false, url: "https://example.supabase.co", publishableKey: "sb_publishable_demo" }), false);
});

test("stable y beta habilitan Supabase con calendarios cloud separados", () => {
  const config = {
    enabled: true,
    url: "https://example.supabase.co",
    publishableKey: "sb_publishable_demo"
  };
  assert.equal(shouldUseSupabaseCloud("stable", config), true);
  assert.equal(shouldUseSupabaseCloud("beta", config), true);
  assert.equal(shouldUseSupabaseCloud("local", config), false);
  assert.equal(shouldUseSupabaseCloud("stable", { ...config, enabled: false }), false);
  assert.equal(supabaseCalendarKeyForChannel("stable"), "calendario-hvac-siys");
  assert.equal(supabaseCalendarKeyForChannel("beta"), "calendario-hvac-siys-beta");
});

test("la migración sólo considera datos locales cuando el cloud está vacío", () => {
  const local = {
    calendarMeta: { name: "Cronograma HVAC", coordinator: "", revision: 3 },
    catalog: { clients: [{ id: "client-1" }] },
    activities: []
  };
  const emptyRemote = {
    calendarMeta: { name: "Cronograma HVAC", coordinator: "", revision: 0 },
    catalog: { clients: [], sites: [], responsibles: [] },
    activities: []
  };
  const populatedRemote = {
    ...emptyRemote,
    activities: [{ id: "activity-1" }]
  };
  assert.equal(hasPersistedCalendarData(local), true);
  assert.equal(hasPersistedCalendarData(emptyRemote), false);
  assert.equal(shouldMigrateLocalDocument(local, emptyRemote), true);
  assert.equal(shouldMigrateLocalDocument(local, populatedRemote), false);
  assert.equal(shouldMigrateLocalDocument(emptyRemote, emptyRemote), false);
});

test("la sesión de Supabase se comparte entre canales sin compartir sus calendarios", async () => {
  const storage = storageMock();
  const session = {
    access_token: "access-1",
    refresh_token: "refresh-1",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "user-1", email: "test@example.com" }
  };
  const beta = createSupabasePersistence({
    enabled: true,
    url: "https://example.supabase.co",
    publishableKey: "sb_publishable_demo"
  }, {
    calendarKey: "calendario-hvac-siys-beta",
    fetchImpl: async (url) => url.includes("/auth/v1/token?grant_type=password")
      ? response(session)
      : response({}, 500),
    storage
  });
  const stableWithAuth = createSupabasePersistence({
    enabled: true,
    url: "https://example.supabase.co",
    publishableKey: "sb_publishable_demo"
  }, {
    calendarKey: "calendario-hvac-siys",
    fetchImpl: async (url) => url.includes("/auth/v1/token?grant_type=password")
      ? response(session)
      : response({}, 500),
    storage
  });
  await stableWithAuth.signIn("test@example.com", "secret123");
  const restored = await beta.restoreSession();
  assert.equal(restored.access_token, "access-1");
  assert.deepEqual(beta.getUser(), session.user);
  assert.equal(storage.getItem("siys-sync-supabase-session:calendario-hvac-siys"), null);
  assert.ok(storage.getItem("siys-sync-supabase-session"));
});

test("una sesión heredada por canal se migra a la clave compartida al restaurarse", async () => {
  const storage = storageMock();
  const session = {
    access_token: "legacy-access-1",
    refresh_token: "legacy-refresh-1",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "user-1", email: "test@example.com" }
  };
  storage.setItem(
    "siys-sync-supabase-session:calendario-hvac-siys-beta",
    JSON.stringify(session)
  );
  const persistence = createSupabasePersistence({
    enabled: true,
    url: "https://example.supabase.co",
    publishableKey: "sb_publishable_demo"
  }, {
    calendarKey: "calendario-hvac-siys",
    fetchImpl: async () => response({}, 500),
    storage
  });
  const restored = await persistence.restoreSession();
  assert.equal(restored.access_token, "legacy-access-1");
  assert.ok(storage.getItem("siys-sync-supabase-session"));
});

test("el adaptador autentica, crea el calendario inicial y usa revisión optimista vía RPC", async () => {
  const calls = [];
  const initialDocument = {
    schemaVersion: 4,
    calendarMeta: { name: "Cronograma HVAC", coordinator: "" },
    activities: []
  };
  const calendar = {
    id: "calendar-1",
    name: "Cronograma HVAC",
    coordinator: "",
    created_by: "user-1"
  };
  let rpcCount = 0;
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes("/auth/v1/token?grant_type=password")) {
      return response({
        access_token: "access-1",
        refresh_token: "refresh-1",
        expires_in: 3600,
        user: { id: "user-1", email: "test@example.com" }
      });
    }
    if (url.includes("/rest/v1/calendars?legacy_id=")) return response([]);
    if (url.includes("/rest/v1/rpc/create_calendar_for_current_user")) return response([calendar], 201);
    if (url.includes("/rest/v1/rpc/persist_calendar_document")) {
      rpcCount += 1;
      const body = JSON.parse(options.body);
      if (rpcCount === 1) {
        assert.equal(body.expected_revision, null, "la creación inicial no usa CAS");
        return response([{ revision: 0, updated_at: "2026-08-04T00:00:00Z", updated_by: "user-1" }], 201);
      }
      assert.equal(body.expected_revision, 0, "la actualización usa la revisión cargada");
      return response([{ revision: 1, updated_at: "2026-08-04T00:01:00Z", updated_by: "user-1" }]);
    }
    if (url.includes("/rest/v1/calendar_documents?calendar_id=") && options.method === "GET") return response([]);
    if (url.includes("/rest/v1/calendars?id=")) throw new Error("el write no debe hacer un PATCH separado a calendars");
    throw new Error(`Ruta no simulada: ${url}`);
  };
  const persistence = createSupabasePersistence({
    enabled: true,
    url: "https://example.supabase.co",
    publishableKey: "sb_publishable_demo"
  }, {
    calendarKey: "calendario-test",
    fetchImpl,
    storage: storageMock()
  });

  await persistence.signIn("test@example.com", "secret123");
  const created = await persistence.initialize({ initialDocument });
  assert.equal(created.revision, 0);
  assert.equal(persistence.getCalendar().id, "calendar-1");
  const bootstrapCall = calls.find(({ url }) => url.includes("/rest/v1/rpc/create_calendar_for_current_user"));
  assert.deepEqual(JSON.parse(bootstrapCall.options.body), {
    requested_legacy_id: "calendario-test",
    requested_name: "Cronograma HVAC",
    requested_coordinator: ""
  });

  const saved = await persistence.write({
    ...initialDocument,
    calendarMeta: { ...initialDocument.calendarMeta, coordinator: "Coordinación" }
  });
  assert.equal(saved.revision, 1);
  assert.equal(rpcCount, 2);
  assert.equal(calls.filter(({ options }) => options.method === "PATCH").length, 0);
});

test("una cuenta nueva crea su propio calendario aunque ya exista otro del mismo canal", async () => {
  const calls = [];
  const existing = {
    id: "calendar-existing",
    legacy_id: "calendario-test",
    name: "Cronograma de la cuenta principal",
    coordinator: "Coordinación 1",
    created_by: "user-1",
    created_at: "2026-08-05T00:00:00Z"
  };
  const created = {
    id: "calendar-new",
    legacy_id: "calendario-test",
    name: "Cronograma de la cuenta nueva",
    coordinator: "Coordinación 2",
    created_by: "user-2",
    created_at: "2026-08-06T00:00:00Z"
  };
  const initialDocument = {
    schemaVersion: 4,
    calendarMeta: { name: "Cronograma de la cuenta nueva", coordinator: "Coordinación 2" },
    activities: []
  };
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes("/auth/v1/token?grant_type=password")) {
      return response({
        access_token: "access-2",
        refresh_token: "refresh-2",
        expires_in: 3600,
        user: { id: "user-2", email: "second@example.com" }
      });
    }
    if (url.includes("/rest/v1/calendars?legacy_id=")) return response([existing]);
    if (url.includes("/rest/v1/profiles?")) return response([]);
    if (url.includes("/rest/v1/rpc/create_calendar_for_current_user")) return response([created], 201);
    if (url.includes("/rest/v1/calendar_documents?calendar_id=eq.calendar-new") && options.method === "GET") return response([]);
    if (url.includes("/rest/v1/rpc/persist_calendar_document")) {
      const body = JSON.parse(options.body);
      assert.equal(body.target_calendar_id, "calendar-new");
      assert.equal(body.expected_revision, null);
      assert.equal(body.next_document.calendarMeta.name, "Cronograma de la cuenta nueva");
      assert.equal(body.next_document.calendarMeta.coordinator, "Coordinación 2");
      return response([{ revision: 0, updated_at: "2026-08-06T00:00:00Z", updated_by: "user-2" }], 201);
    }
    if (url.includes("/rest/v1/calendars?id=")) throw new Error("el bootstrap no debe hacer un PATCH separado a calendars");
    throw new Error(`Ruta no simulada: ${url}`);
  };
  const persistence = createSupabasePersistence({
    enabled: true,
    url: "https://example.supabase.co",
    publishableKey: "sb_publishable_demo"
  }, {
    calendarKey: "calendario-test",
    fetchImpl,
    storage: storageMock()
  });

  await persistence.signIn("second@example.com", "secret123");
  const initialized = await persistence.initialize({ initialDocument });

  assert.equal(initialized.initializedFromInitial, true);
  assert.equal(persistence.getCalendar().id, "calendar-new");
  assert.equal(persistence.canEdit(), true);
  assert.equal(persistence.getCalendars().length, 2);
  const createCall = calls.find(({ url }) => url.includes("/rest/v1/rpc/create_calendar_for_current_user"));
  assert.deepEqual(JSON.parse(createCall.options.body), {
    requested_legacy_id: "calendario-test",
    requested_name: "Cronograma de la cuenta nueva",
    requested_coordinator: "Coordinación 2"
  });
});

test("los demás cronogramas se pueden leer pero no escribir desde otra cuenta", async () => {
  const calendars = [
    {
      id: "calendar-own",
      legacy_id: "calendario-test",
      name: "Mi cronograma",
      coordinator: "Propio",
      created_by: "user-2",
      created_at: "2026-08-05T00:00:00Z"
    },
    {
      id: "calendar-other",
      legacy_id: "calendario-test",
      name: "Cronograma de otra cuenta",
      coordinator: "Otra",
      created_by: "user-1",
      created_at: "2026-08-06T00:00:00Z"
    }
  ];
  const fetchImpl = async (url, options = {}) => {
    if (url.includes("/auth/v1/token?grant_type=password")) {
      return response({
        access_token: "access-2",
        refresh_token: "refresh-2",
        expires_in: 3600,
        user: { id: "user-2", email: "second@example.com" }
      });
    }
    if (url.includes("/rest/v1/calendars?legacy_id=")) return response(calendars);
    if (url.includes("/rest/v1/profiles?")) return response([
      { id: "user-1", display_name: "Cuenta principal" },
      { id: "user-2", display_name: "Cuenta secundaria" }
    ]);
    if (url.includes("/rest/v1/calendar_documents?calendar_id=eq.calendar-own") && options.method === "GET") {
      return response([{ document: { calendarMeta: { name: "Mi cronograma" } }, revision: 3 }]);
    }
    if (url.includes("/rest/v1/calendar_documents?calendar_id=eq.calendar-other") && options.method === "GET") {
      return response([{ document: { calendarMeta: { name: "Cronograma de otra cuenta" } }, revision: 7 }]);
    }
    throw new Error(`Ruta no simulada: ${url}`);
  };
  const persistence = createSupabasePersistence({
    enabled: true,
    url: "https://example.supabase.co",
    publishableKey: "sb_publishable_demo"
  }, {
    calendarKey: "calendario-test",
    fetchImpl,
    storage: storageMock()
  });

  await persistence.signIn("second@example.com", "secret123");
  await persistence.initialize({ initialDocument: { calendarMeta: { name: "Mi cronograma" } } });
  assert.equal(persistence.canEdit(), true);

  await persistence.selectCalendar("calendar-other");
  const other = await persistence.read();
  assert.equal(other.document.calendarMeta.name, "Cronograma de otra cuenta");
  assert.equal(persistence.getRole(), "viewer");
  assert.equal(persistence.canEdit(), false);
  await assert.rejects(
    persistence.write({ calendarMeta: { name: "Cambio no autorizado" } }),
    (error) => error.code === "calendar_read_only" && error.status === 403
  );
});

test("una actualización sin filas se reporta como conflicto cloud", async () => {
  const persistence = createSupabasePersistence({
    enabled: true,
    url: "https://example.supabase.co",
    publishableKey: "sb_publishable_demo"
  }, {
    fetchImpl: async (url, options = {}) => {
      if (url.includes("/auth/v1/token?grant_type=password")) {
        return response({ access_token: "access-1", refresh_token: "refresh-1", expires_in: 3600, user: { id: "user-1" } });
      }
      if (url.includes("/rest/v1/calendars?legacy_id=")) return response([{
        id: "calendar-1",
        name: "Cronograma HVAC",
        coordinator: "",
        created_by: "user-1"
      }]);
      if (url.includes("/rest/v1/calendar_documents") && options.method === "GET") return response([{ document: { calendarMeta: { name: "Cronograma HVAC" } }, revision: 4 }]);
      if (url.includes("/rest/v1/rpc/persist_calendar_document")) return response([]);
      throw new Error(`Ruta no simulada: ${url}`);
    },
    storage: storageMock()
  });
  await persistence.signIn("test@example.com", "secret123");
  await persistence.initialize({ initialDocument: { calendarMeta: { name: "Cronograma HVAC" } } });
  await assert.rejects(
    persistence.write({ calendarMeta: { name: "Cronograma HVAC" } }),
    (error) => error instanceof SupabaseCloudConflictError
  );
});

test("un fallo de red en Auth conserva el contrato browser de network_error", async () => {
  const failure = new TypeError("falló la red en auth");
  const persistence = createSupabasePersistence({
    enabled: true,
    url: "https://example.supabase.co",
    publishableKey: "sb_publishable_demo"
  }, {
    fetchImpl: async () => { throw failure; },
    storage: storageMock()
  });

  await assert.rejects(
    persistence.signIn("test@example.com", "secret123"),
    (error) => (
      error instanceof SupabaseCloudError
      && !(error instanceof SupabaseTransportError)
      && error.name === "SupabaseCloudError"
      && error.code === "network_error"
      && error.message === "No fue posible conectar con Supabase: falló la red en auth"
      && error.details === failure
    )
  );
});

test("un fallo de red en REST conserva el contrato browser de network_error", async () => {
  const failure = new TypeError("falló la red en rest");
  const session = {
    access_token: "access-1",
    refresh_token: "refresh-1",
    expires_in: 3600,
    user: { id: "user-1", email: "test@example.com" }
  };
  const persistence = createSupabasePersistence({
    enabled: true,
    url: "https://example.supabase.co",
    publishableKey: "sb_publishable_demo"
  }, {
    fetchImpl: async (url) => {
      if (url.includes("/auth/v1/token?grant_type=password")) return response(session);
      throw failure;
    },
    storage: storageMock()
  });

  await persistence.signIn("test@example.com", "secret123");
  await assert.rejects(
    persistence.loadCalendars(),
    (error) => (
      error instanceof SupabaseCloudError
      && !(error instanceof SupabaseTransportError)
      && error.code === "network_error"
      && error.message === "No fue posible conectar con Supabase: falló la red en rest"
      && error.details === failure
    )
  );
});

test("un Auth request sin body conserva Content-Type application/json", async () => {
  const calls = [];
  const session = {
    access_token: "access-1",
    refresh_token: "refresh-1",
    expires_in: 3600,
    user: { id: "user-1", email: "test@example.com" }
  };
  const persistence = createSupabasePersistence({
    enabled: true,
    url: "https://example.supabase.co",
    publishableKey: "sb_publishable_demo"
  }, {
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (url.includes("/auth/v1/token?grant_type=password")) return response(session);
      return response(null, 204);
    },
    storage: storageMock()
  });

  await persistence.signIn("test@example.com", "secret123");
  await persistence.signOut();

  const logout = calls.find(({ url }) => url.includes("/auth/v1/logout"));
  assert.ok(logout, "debe emitir el Auth request de logout");
  assert.equal(logout.options.body, undefined);
  assert.equal(logout.options.headers["Content-Type"], "application/json");
});

test("un REST GET sin body conserva Content-Type, apikey y Authorization", async () => {
  const calls = [];
  const session = {
    access_token: "access-1",
    refresh_token: "refresh-1",
    expires_in: 3600,
    user: { id: "user-1", email: "test@example.com" }
  };
  const persistence = createSupabasePersistence({
    enabled: true,
    url: "https://example.supabase.co",
    publishableKey: "sb_publishable_demo"
  }, {
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (url.includes("/auth/v1/token?grant_type=password")) return response(session);
      if (url.includes("/rest/v1/calendars?legacy_id=")) return response([]);
      return response({}, 500);
    },
    storage: storageMock()
  });

  await persistence.signIn("test@example.com", "secret123");
  await persistence.loadCalendars();

  const get = calls.find(({ url }) => url.includes("/rest/v1/calendars?legacy_id="));
  assert.ok(get, "debe emitir el GET de calendarios");
  assert.equal(get.options.method, "GET");
  assert.equal(get.options.body, undefined);
  assert.equal(get.options.headers["Content-Type"], "application/json");
  assert.equal(get.options.headers.apikey, "sb_publishable_demo");
  assert.equal(get.options.headers.Authorization, "Bearer access-1");
});

test("un 401 REST dispara exactamente un refresh y un solo retry", async () => {
  let refreshCalls = 0;
  let getCalls = 0;
  const session = {
    access_token: "access-1",
    refresh_token: "refresh-1",
    expires_in: 3600,
    user: { id: "user-1", email: "test@example.com" }
  };
  const refreshed = {
    access_token: "access-2",
    refresh_token: "refresh-2",
    expires_in: 3600,
    user: { id: "user-1", email: "test@example.com" }
  };
  const persistence = createSupabasePersistence({
    enabled: true,
    url: "https://example.supabase.co",
    publishableKey: "sb_publishable_demo"
  }, {
    fetchImpl: async (url) => {
      if (url.includes("/auth/v1/token?grant_type=password")) return response(session);
      if (url.includes("/auth/v1/token?grant_type=refresh_token")) {
        refreshCalls += 1;
        return response(refreshed);
      }
      if (url.includes("/rest/v1/calendars?legacy_id=")) {
        getCalls += 1;
        return getCalls === 1 ? response({}, 401) : response([]);
      }
      return response({}, 500);
    },
    storage: storageMock()
  });

  await persistence.signIn("test@example.com", "secret123");
  const calendars = await persistence.loadCalendars();

  assert.deepEqual(calendars, []);
  assert.equal(refreshCalls, 1);
  assert.equal(getCalls, 2);
});

test("un 401 REST persistente no reintenta en bucle", async () => {
  let refreshCalls = 0;
  let getCalls = 0;
  const session = {
    access_token: "access-1",
    refresh_token: "refresh-1",
    expires_in: 3600,
    user: { id: "user-1", email: "test@example.com" }
  };
  const refreshed = {
    access_token: "access-2",
    refresh_token: "refresh-2",
    expires_in: 3600,
    user: { id: "user-1", email: "test@example.com" }
  };
  const persistence = createSupabasePersistence({
    enabled: true,
    url: "https://example.supabase.co",
    publishableKey: "sb_publishable_demo"
  }, {
    fetchImpl: async (url) => {
      if (url.includes("/auth/v1/token?grant_type=password")) return response(session);
      if (url.includes("/auth/v1/token?grant_type=refresh_token")) {
        refreshCalls += 1;
        return response(refreshed);
      }
      if (url.includes("/rest/v1/calendars?legacy_id=")) {
        getCalls += 1;
        return response({}, 401);
      }
      return response({}, 500);
    },
    storage: storageMock()
  });

  await persistence.signIn("test@example.com", "secret123");
  await assert.rejects(
    persistence.loadCalendars(),
    (error) => error instanceof SupabaseCloudError && error.status === 401
  );
  assert.equal(refreshCalls, 1);
  assert.equal(getCalls, 2);
});

test("la configuración incompleta conserva invalid_config browser", () => {
  for (const config of [
    { enabled: true, url: "", publishableKey: "sb_publishable_demo" },
    { enabled: true, url: "https://example.supabase.co", publishableKey: "" },
    { enabled: false, url: "https://example.supabase.co", publishableKey: "sb_publishable_demo" }
  ]) {
    assert.throws(
      () => createSupabasePersistence(config, { fetchImpl: async () => response({}) }),
      (error) => (
        error instanceof SupabaseCloudError
        && error.code === "invalid_config"
        && error.message === "La configuración de Supabase está incompleta."
      ),
      `configuración inválida no detectada: ${JSON.stringify(config)}`
    );
  }
});

test("fetchImpl null conserva fetch_unavailable browser", () => {
  assert.throws(
    () => createSupabasePersistence({
      enabled: true,
      url: "https://example.supabase.co",
      publishableKey: "sb_publishable_demo"
    }, { fetchImpl: null }),
    (error) => (
      error instanceof SupabaseCloudError
      && error.code === "fetch_unavailable"
      && error.message === "Este navegador no permite conexiones a Supabase."
    )
  );
});

test("el write de un documento existente es una sola transacción sin segundo PATCH a calendars", async () => {
  const calls = [];
  const calendar = { id: "calendar-1", name: "Cronograma HVAC", coordinator: "", created_by: "user-1" };
  const document = {
    schemaVersion: 4,
    calendarMeta: { name: "Cronograma HVAC", coordinator: "" },
    activities: []
  };
  const persistence = createSupabasePersistence({
    enabled: true,
    url: "https://example.supabase.co",
    publishableKey: "sb_publishable_demo"
  }, {
    calendarKey: "calendario-test",
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (url.includes("/auth/v1/token?grant_type=password")) {
        return response({ access_token: "access-1", refresh_token: "refresh-1", expires_in: 3600, user: { id: "user-1" } });
      }
      if (url.includes("/rest/v1/calendars?legacy_id=")) return response([calendar]);
      if (url.includes("/rest/v1/profiles?")) return response([]);
      if (url.includes("/rest/v1/calendar_documents?calendar_id=") && options.method === "GET") return response([]);
      if (url.includes("/rest/v1/rpc/persist_calendar_document")) {
        const body = JSON.parse(options.body);
        if (body.expected_revision === null) {
          return response([{ revision: 0, updated_at: "2026-08-04T00:00:00Z", updated_by: "user-1" }], 201);
        }
        return response([{ revision: 1, updated_at: "2026-08-04T00:01:00Z", updated_by: "user-1" }]);
      }
      if (url.includes("/rest/v1/calendars?id=")) throw new Error("no debe existir PATCH separado a calendars");
      throw new Error(`Ruta no simulada: ${url}`);
    },
    storage: storageMock()
  });

  await persistence.signIn("test@example.com", "secret123");
  const initialized = await persistence.initialize({ initialDocument: document });
  assert.equal(initialized.initializedFromInitial, true);
  assert.equal(initialized.revision, 0);

  const coordinator = "Coordinación";
  const saved = await persistence.write({ ...document, calendarMeta: { name: "Cronograma HVAC", coordinator } });
  assert.equal(saved.revision, 1);
  assert.equal(saved.updatedAt, "2026-08-04T00:01:00Z");

  const rpc = calls.filter(({ url }) => url.includes("/rest/v1/rpc/persist_calendar_document"));
  assert.equal(rpc.length, 2, "bootstrap + update, una persistencia por escritura");
  const updateBody = JSON.parse(rpc[1].options.body);
  assert.equal(updateBody.target_calendar_id, "calendar-1");
  assert.equal(updateBody.expected_revision, 0);
  assert.equal(updateBody.next_document.calendarMeta.name, "Cronograma HVAC");
  assert.equal(updateBody.next_document.calendarMeta.coordinator, coordinator);

  assert.equal(calls.filter(({ options }) => options.method === "PATCH").length, 0);
});
