import assert from "node:assert/strict";
import test from "node:test";

import { createCloudCalendarWriter } from "../src/cli/cloud-write.js";
import { createSupabaseRestClient } from "../src/cli/cloud-rest.js";

const CONFIG = { url: "https://example.supabase.co", publishableKey: "sb_publishable_fixture" };
const CALENDAR_ID = "11111111-1111-4111-8111-111111111112";
const ACCESS_TOKEN = "fixture-access-token";

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return payload === null ? "" : JSON.stringify(payload); }
  };
}

function cloudDocument() {
  return {
    schemaVersion: 5,
    calendarMeta: { id: "calendar-meta-fixture", revision: 99 },
    catalog: { clients: [], sites: [] },
    activities: []
  };
}

function makeWriter({ responder, options = {} } = {}) {
  const calls = [];
  const counters = { refresh: 0, accessToken: 0 };
  const auth = {
    accessToken: async () => { counters.accessToken += 1; return ACCESS_TOKEN; },
    refreshSession: async () => { counters.refresh += 1; return { access_token: ACCESS_TOKEN }; }
  };
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return responder(url, init, calls.length);
  };
  const writer = createCloudCalendarWriter(CONFIG, { auth, fetchImpl, ...options });
  return { writer, auth, calls, counters };
}

test("writeDocument aplica CAS sobre expectedRevision=12 e ignora calendarMeta.revision", async () => {
  const { writer, calls } = makeWriter({
    responder: () => response([{ revision: 13, updated_at: "2026-09-01T00:00:00.000Z", updated_by: "user-1" }])
  });
  const document = cloudDocument();
  const result = await writer.writeDocument({ calendarId: CALENDAR_ID, expectedRevision: 12, document });

  assert.equal(calls.length, 1);
  const [{ url, init }] = calls;
  assert.equal(init.method, "PATCH");
  assert.match(url, /\/rest\/v1\/calendar_documents\?/);
  assert.ok(url.includes(`calendar_id=eq.${CALENDAR_ID}`));
  assert.ok(url.includes("revision=eq.12"));
  assert.ok(url.includes("select=document,revision,updated_at,updated_by"));
  assert.ok(!url.includes("revision=eq.99"), "el CAS no debe usar calendarMeta.revision");
  assert.equal(init.headers.Prefer, "return=representation");
  assert.equal(init.headers["Content-Type"], "application/json");

  const body = JSON.parse(init.body);
  assert.equal(body.revision, 13);
  assert.equal(body.schema_version, 5);
  assert.equal(body.document.calendarMeta.revision, 99);

  assert.equal(result.revision, 13);
  assert.equal(result.updatedAt, "2026-09-01T00:00:00.000Z");
  assert.equal(result.calendarId, CALENDAR_ID);
});

test("schema_version cae a 4 cuando el documento no lo declara", async () => {
  const { writer, calls } = makeWriter({
    responder: () => response([{ revision: 1, updated_at: null, updated_by: null }])
  });
  await writer.writeDocument({ calendarId: CALENDAR_ID, expectedRevision: 0, document: { calendarMeta: {} } });
  assert.equal(JSON.parse(calls[0].init.body).schema_version, 4);
});

test("cero filas producen CONFLICT con un único PATCH y ningún GET ni recarga", async () => {
  const { writer, calls } = makeWriter({ responder: () => response([]) });
  await assert.rejects(
    writer.writeDocument({ calendarId: CALENDAR_ID, expectedRevision: 12, document: cloudDocument() }),
    (error) => error.code === "CONFLICT"
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, "PATCH");
  assert.equal(calls.filter((call) => call.init.method === "GET").length, 0);
});

test("más de una fila producen REMOTE_INVALID", async () => {
  const { writer } = makeWriter({
    responder: () => response([
      { revision: 13, updated_at: null, updated_by: null },
      { revision: 13, updated_at: null, updated_by: null }
    ])
  });
  await assert.rejects(
    writer.writeDocument({ calendarId: CALENDAR_ID, expectedRevision: 12, document: cloudDocument() }),
    (error) => error.code === "REMOTE_INVALID"
  );
});

test("una revisión devuelta distinta de expected+1 produce REMOTE_INVALID", async () => {
  for (const wrong of [12, 14, "13.5", null]) {
    const { writer } = makeWriter({ responder: () => response([{ revision: wrong, updated_at: null, updated_by: null }]) });
    await assert.rejects(
      writer.writeDocument({ calendarId: CALENDAR_ID, expectedRevision: 12, document: cloudDocument() }),
      (error) => error.code === "REMOTE_INVALID",
      `revisión ${String(wrong)} debe rechazarse`
    );
  }
});

test("expectedRevision nula o inválida falla cerrado sin red y sin inventar revisión 0", async () => {
  for (const bad of [null, undefined, -1, 1.5, "doce"]) {
    const { writer, calls } = makeWriter({ responder: () => response([{ revision: 1 }]) });
    await assert.rejects(
      writer.writeDocument({ calendarId: CALENDAR_ID, expectedRevision: bad, document: cloudDocument() }),
      (error) => error.code === "REMOTE_INVALID",
      `revisión ${String(bad)} debe fallar cerrado`
    );
    assert.equal(calls.length, 0, "no debe haber red antes de validar expectedRevision");
  }
});

test("calendarId inválido y documento inválido fallan antes de red", async () => {
  const { writer, calls } = makeWriter({ responder: () => response([{ revision: 1 }]) });
  await assert.rejects(
    writer.writeDocument({ calendarId: "", expectedRevision: 12, document: cloudDocument() }),
    (error) => error.code === "INVALID_REQUEST"
  );
  await assert.rejects(
    writer.writeDocument({ calendarId: CALENDAR_ID, expectedRevision: 12, document: [] }),
    (error) => error.code === "INVALID_REQUEST"
  );
  assert.equal(calls.length, 0);
});

test("403 produce RLS_DENIED sin reintento", async () => {
  const { writer, calls } = makeWriter({ responder: () => response({ message: "denied" }, 403) });
  await assert.rejects(
    writer.writeDocument({ calendarId: CALENDAR_ID, expectedRevision: 12, document: cloudDocument() }),
    (error) => error.code === "RLS_DENIED"
  );
  assert.equal(calls.length, 1);
});

test("un fallo de red produce NETWORK_ERROR y no reintenta el PATCH", async () => {
  const failure = new TypeError("red caída");
  const { writer, calls } = makeWriter({ responder: () => { throw failure; } });
  await assert.rejects(
    writer.writeDocument({ calendarId: CALENDAR_ID, expectedRevision: 12, document: cloudDocument() }),
    (error) => error.code === "NETWORK_ERROR" && error.cause === failure
  );
  assert.equal(calls.length, 1);
});

test("un timeout produce TIMEOUT y no reintenta el PATCH", async () => {
  const { writer, calls } = makeWriter({
    options: { timeoutMs: 10 },
    responder: (url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        const abortError = new Error("aborted");
        abortError.name = "AbortError";
        reject(abortError);
      });
    })
  });
  await assert.rejects(
    writer.writeDocument({ calendarId: CALENDAR_ID, expectedRevision: 12, document: cloudDocument() }),
    (error) => error.code === "TIMEOUT"
  );
  assert.equal(calls.length, 1);
});

test("401 refresca exactamente una vez, repite exactamente una vez y termina en AUTH_REQUIRED", async () => {
  const { writer, calls, counters } = makeWriter({ responder: () => response({ message: "expired" }, 401) });
  await assert.rejects(
    writer.writeDocument({ calendarId: CALENDAR_ID, expectedRevision: 12, document: cloudDocument() }),
    (error) => error.code === "AUTH_REQUIRED"
  );
  assert.equal(counters.refresh, 1);
  assert.equal(calls.length, 2);
});

test("ningún token aparece en el error de escritura", async () => {
  const { writer } = makeWriter({ responder: () => response({ message: "denied" }, 403) });
  await assert.rejects(
    writer.writeDocument({ calendarId: CALENDAR_ID, expectedRevision: 12, document: cloudDocument() }),
    (error) => {
      assert.ok(!error.message.includes(ACCESS_TOKEN));
      assert.ok(!JSON.stringify(error.details ?? {}).includes(ACCESS_TOKEN));
      return true;
    }
  );
});

test("cloud-rest: method por defecto GET y headers inyectados se reenvían", async () => {
  const calls = [];
  const auth = { accessToken: async () => ACCESS_TOKEN, refreshSession: async () => ({ access_token: ACCESS_TOKEN }) };
  const client = createSupabaseRestClient(CONFIG, {
    auth,
    fetchImpl: async (url, init) => { calls.push({ url, init }); return response([]); }
  });
  await client.request("/rest/v1/calendars?select=id", { headers: { Accept: "application/json" } });
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.headers.Accept, "application/json");
  assert.equal("Content-Type" in calls[0].init.headers, false);
});

test("cloud-rest: 5xx produce REMOTE_UNAVAILABLE y 409 produce REMOTE_ERROR sin retry", async () => {
  for (const [status, code] of [[500, "REMOTE_UNAVAILABLE"], [409, "REMOTE_ERROR"]]) {
    const calls = [];
    const auth = { accessToken: async () => ACCESS_TOKEN, refreshSession: async () => ({ access_token: ACCESS_TOKEN }) };
    const client = createSupabaseRestClient(CONFIG, {
      auth,
      fetchImpl: async (url, init) => { calls.push({ url, init }); return response({ message: "x" }, status); }
    });
    await assert.rejects(
      client.request("/rest/v1/calendar_documents", { method: "PATCH", body: {}, operation: "probar" }),
      (error) => error.code === code
    );
    assert.equal(calls.length, 1);
  }
});

test("cloud-rest: JSON inválido produce REMOTE_INVALID", async () => {
  const auth = { accessToken: async () => ACCESS_TOKEN, refreshSession: async () => ({ access_token: ACCESS_TOKEN }) };
  const client = createSupabaseRestClient(CONFIG, {
    auth,
    fetchImpl: async () => ({ ok: true, status: 200, async text() { return "<html>no json</html>"; } })
  });
  await assert.rejects(
    client.request("/rest/v1/calendars", { operation: "probar" }),
    (error) => error.code === "REMOTE_INVALID"
  );
});
