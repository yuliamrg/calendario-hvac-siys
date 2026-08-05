import assert from "node:assert/strict";
import test from "node:test";
import {
  createSupabasePersistence,
  isSupabaseConfigEnabled,
  shouldUseSupabaseCloud,
  SupabaseCloudConflictError,
  supabaseCalendarKeyForChannel
} from "../src/cloud.js";

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

test("el adaptador autentica, crea el calendario inicial y usa revisión optimista", async () => {
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
    if (url.includes("/rest/v1/calendar_members?")) return response([{ role: "owner" }]);
    if (url.includes("/rest/v1/calendar_documents?calendar_id=") && options.method === "GET") return response([]);
    if (url.includes("/rest/v1/calendar_documents?select=")) return response([{
      document: initialDocument,
      revision: 0,
      updated_at: "2026-08-04T00:00:00Z"
    }], 201);
    if (url.includes("/rest/v1/calendar_documents?calendar_id=") && options.method === "PATCH") {
      assert.match(url, /revision=eq\.0/);
      return response([{
        document: initialDocument,
        revision: 1,
        updated_at: "2026-08-04T00:01:00Z"
      }]);
    }
    if (url.includes("/rest/v1/calendars?id=")) return response(null, 204);
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
  assert.ok(calls.some(({ url, options }) => url.includes("/rest/v1/calendar_documents") && options.method === "PATCH"));
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
      if (url.includes("/rest/v1/calendars?legacy_id=")) return response([{ id: "calendar-1", name: "Cronograma HVAC", coordinator: "" }]);
      if (url.includes("/rest/v1/calendar_members?")) return response([{ role: "owner" }]);
      if (url.includes("/rest/v1/calendar_documents") && options.method === "GET") return response([{ document: { calendarMeta: { name: "Cronograma HVAC" } }, revision: 4 }]);
      if (url.includes("/rest/v1/calendar_documents") && options.method === "PATCH") return response([]);
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
