import assert from "node:assert/strict";
import test from "node:test";
import { PassThrough } from "node:stream";
import { createDefaultDocument } from "../packages/platform/src/core.js";
import { createSupabaseAuthClient } from "../apps/cli/src/cloud-auth.js";
import { runCli } from "../apps/cli/src/main.js";

const CONFIG = { url: "https://example.supabase.co", publishableKey: "sb_publishable_fixture" };
const USER = { id: "11111111-1111-4111-8111-111111111111", email: "fixture@example.com" };
const CALENDAR_ID = "11111111-1111-4111-8111-111111111112";
const NOW = "2026-09-01T10:00:00.000Z";
const ACCESS_TOKEN = "fixture-access-token";
const REFRESH_TOKEN = "fixture-refresh-token";
const RPC_PATH = "/rest/v1/rpc/persist_calendar_document";

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return payload === null ? "" : JSON.stringify(payload); }
  };
}

function sessionStore() {
  let value = {
    access_token: ACCESS_TOKEN,
    refresh_token: REFRESH_TOKEN,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: USER
  };
  return {
    async read() { return value; },
    async write(next) { value = next; },
    async remove() { value = null; },
    get value() { return value; }
  };
}

function documentWithActivity(cloudRevision) {
  const document = createDefaultDocument("2026-09-01", NOW, { appVersion: "0.6.0" });
  document.calendarMeta.id = "calendar-meta-fixture";
  document.calendarMeta.revision = cloudRevision;
  document.catalog.clients.push({ id: "client-1", name: "Cliente Fixture", active: true });
  document.catalog.sites.push({ id: "site-1", clientId: "client-1", name: "Sede Fixture", city: "Pereira", active: true });
  document.activities.push({
    id: "activity-today", seriesId: null, date: "2026-09-01", planningBucket: "calendar",
    clientId: "client-1", siteId: "site-1", city: "Pereira", responsibleIds: [],
    serviceType: "preventive", status: "scheduled", sortOrder: null, observations: "Hoy",
    createdAt: NOW, updatedAt: NOW, completedAt: null, history: []
  });
  return document;
}

function makeFixture({ cloudRevision = 12, rpcResponder } = {}) {
  const store = sessionStore();
  const calls = [];
  const persist = rpcResponder ?? (() => response([{ revision: cloudRevision + 1, updated_at: "2026-09-01T10:01:00.000Z", updated_by: USER.id }]));
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes("grant_type=refresh_token")) {
      return response({ access_token: ACCESS_TOKEN, refresh_token: REFRESH_TOKEN, expires_at: Math.floor(Date.now() / 1000) + 3600, user: USER });
    }
    if (url.includes(RPC_PATH)) return persist(url, options, calls);
    if (url.includes("/rest/v1/profiles?")) return response([{ id: USER.id, display_name: "Usuario Fixture" }]);
    if (url.includes("/rest/v1/calendars?legacy_id=")) {
      return response([{
        id: CALENDAR_ID, legacy_id: "calendario-hvac-siys-beta", name: "beta fixture",
        coordinator: "Coordinación", created_by: USER.id, created_at: "2026-08-01T00:00:00.000Z", updated_at: NOW
      }]);
    }
    if (url.includes("/rest/v1/calendar_documents?calendar_id=")) {
      return response([{
        document: documentWithActivity(cloudRevision), revision: cloudRevision,
        updated_at: "2026-08-15T14:58:00.000Z", updated_by: USER.id
      }]);
    }
    throw new Error(`Ruta no simulada: ${url}`);
  };
  const auth = createSupabaseAuthClient(CONFIG, { fetchImpl, sessionStore: store });
  return { auth, store, fetchImpl, calls };
}

async function invokeCli(args, fixture, { stdin } = {}) {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const out = [];
  const err = [];
  stdout.on("data", (chunk) => out.push(chunk.toString()));
  stderr.on("data", (chunk) => err.push(chunk.toString()));
  const status = await runCli(args, {
    stdout,
    stderr,
    fetch: fixture.fetchImpl,
    sessionStore: fixture.store,
    stdin: stdin ?? new PassThrough(),
    env: {
      ...process.env,
      SIYS_SUPABASE_URL: CONFIG.url,
      SIYS_SUPABASE_PUBLISHABLE_KEY: CONFIG.publishableKey
    }
  });
  return { status, stdout: out.join(""), stderr: err.join("") };
}

function createPayload() {
  return JSON.stringify({
    date: "2026-09-03", clientId: "client-1", siteId: "site-1", city: "Pereira",
    serviceType: "preventive", status: "scheduled", observations: "Nueva"
  });
}

function baseArgs() {
  return ["activity", "create", "--source", "cloud", "--channel", "beta", "--calendar-id", CALENDAR_ID, "--output", "json"];
}

function identifyArgs() {
  return ["calendar", "identify", "--source", "cloud", "--channel", "beta", "--calendar-id", CALENDAR_ID, "--output", "json"];
}

function rpcWrites(calls) {
  return calls.filter((call) => call.url.includes(RPC_PATH));
}

function patchWrites(calls) {
  return calls.filter((call) => call.options.method === "PATCH");
}

test("C1 activity.create cloud carga rev 12, ejecuta contrato y emite un único RPC con CAS", async () => {
  const fixture = makeFixture({ cloudRevision: 12 });
  const result = await invokeCli([...baseArgs(), "--payload", createPayload()], fixture);
  assert.equal(result.status, 0, result.stderr);
  const rpc = rpcWrites(fixture.calls);
  assert.equal(rpc.length, 1);
  assert.equal(rpc[0].options.method, "POST");
  assert.equal(patchWrites(fixture.calls).length, 0);
  const body = JSON.parse(rpc[0].options.body);
  assert.equal(body.target_calendar_id, CALENDAR_ID);
  assert.equal(body.expected_revision, 12);
  assert.equal(body.next_document.calendarMeta.revision, 13);
  assert.equal(body.next_document.appVersion, "0.6.0", "CLI mutation preserves legacy metadata");
  assert.ok(body.next_document.calendarMeta.name, "la metadata viaja dentro del documento");
});

test("C2 respuesta exitosa expone written cloud y conserva source.cloudRevision original", async () => {
  const fixture = makeFixture({ cloudRevision: 12 });
  const result = await invokeCli([...baseArgs(), "--payload", createPayload()], fixture);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.written.kind, "cloud");
  assert.equal(output.written.calendarId, CALENDAR_ID);
  assert.equal(output.written.revision, 13);
  assert.equal(output.source.cloudRevision, 12);
  assert.ok(!result.stdout.includes(ACCESS_TOKEN));
  assert.ok(!result.stdout.includes(REFRESH_TOKEN));
  assert.ok(!result.stderr.includes(ACCESS_TOKEN));
});

test("C3 --dry-run realiza reads y contrato pero no emite RPC ni written cloud", async () => {
  const fixture = makeFixture({ cloudRevision: 12 });
  const result = await invokeCli([...baseArgs(), "--dry-run", "--payload", createPayload()], fixture);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(rpcWrites(fixture.calls).length, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.changed, true);
  assert.equal(output.written, null);
  assert.ok(output.document.activities.length >= 2);
});

test("C4 outcome.changed=false no emite RPC (operación no-op real)", async () => {
  const fixture = makeFixture({ cloudRevision: 12 });
  const result = await invokeCli([
    "activity", "edit", "--source", "cloud", "--channel", "beta", "--calendar-id", CALENDAR_ID, "--output", "json",
    "--payload", JSON.stringify({ activityId: "activity-today", patch: { observations: "Hoy" } })
  ], fixture);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.changed, false);
  assert.equal(output.written, null);
  assert.equal(rpcWrites(fixture.calls).length, 0);
});

test("C5 conflicto OCC produce CONFLICT con un único RPC y ningún GET posterior", async () => {
  const fixture = makeFixture({ cloudRevision: 12, rpcResponder: () => response([]) });
  const result = await invokeCli([...baseArgs(), "--payload", createPayload()], fixture);
  assert.equal(result.status, 4);
  assert.match(result.stderr, /CONFLICT/);
  assert.equal(rpcWrites(fixture.calls).length, 1);
  const rpcIndex = fixture.calls.findIndex((call) => call.url.includes(RPC_PATH));
  const after = fixture.calls.slice(rpcIndex + 1);
  assert.equal(after.filter((call) => call.options.method === "GET").length, 0);
});

test("C6 RLS 403 en el RPC produce RLS_DENIED sin fallback", async () => {
  const fixture = makeFixture({ cloudRevision: 12, rpcResponder: () => response({ message: "denied" }, 403) });
  const result = await invokeCli([...baseArgs(), "--payload", createPayload()], fixture);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /RLS_DENIED/);
  assert.equal(rpcWrites(fixture.calls).length, 1);
});

test("C7 fallo de red en el RPC produce NETWORK_ERROR sin retry", async () => {
  const failure = new TypeError("red caída");
  const fixture = makeFixture({ cloudRevision: 12, rpcResponder: () => { throw failure; } });
  const result = await invokeCli([...baseArgs(), "--payload", createPayload()], fixture);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /NETWORK_ERROR/);
  assert.equal(rpcWrites(fixture.calls).length, 1);
});

test("C8 401 refresca una vez y completa el RPC en el segundo intento", async () => {
  let rpcCount = 0;
  let refreshCount = 0;
  const fixture = makeFixture({
    cloudRevision: 12,
    rpcResponder: () => {
      rpcCount += 1;
      return rpcCount === 1
        ? response({ message: "expired" }, 401)
        : response([{ revision: 13, updated_at: "2026-09-01T10:01:00.000Z", updated_by: USER.id }]);
    }
  });
  const originalFetch = fixture.fetchImpl;
  fixture.fetchImpl = async (url, options = {}) => {
    if (url.includes("grant_type=refresh_token")) refreshCount += 1;
    return originalFetch(url, options);
  };
  const result = await invokeCli([...baseArgs(), "--payload", createPayload()], fixture);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(refreshCount, 1);
  assert.equal(rpcCount, 2);
  const output = JSON.parse(result.stdout);
  assert.equal(output.written.revision, 13);
});

test("C9 destructive sin --yes en stdin no-TTY falla antes del RPC", async () => {
  const fixture = makeFixture({ cloudRevision: 12 });
  const result = await invokeCli([
    "activity", "delete", "--source", "cloud", "--channel", "beta", "--calendar-id", CALENDAR_ID, "--output", "json",
    "--payload", JSON.stringify({ activityIds: ["activity-today"] })
  ], fixture);
  assert.equal(result.status, 4);
  assert.match(result.stderr, /CONFIRMATION_REQUIRED/);
  assert.equal(rpcWrites(fixture.calls).length, 0);
});

test("C10 destructive con --yes permite el RPC", async () => {
  const fixture = makeFixture({ cloudRevision: 12 });
  const result = await invokeCli([
    "activity", "delete", "--source", "cloud", "--channel", "beta", "--calendar-id", CALENDAR_ID, "--output", "json", "--yes",
    "--payload", JSON.stringify({ activityIds: ["activity-today"] })
  ], fixture);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(rpcWrites(fixture.calls).length, 1);
});

test("C11 calendar.identify --source cloud carga N, ejecuta contrato y persiste N+1 una sola vez", async () => {
  const fixture = makeFixture({ cloudRevision: 12 });
  const result = await invokeCli([
    ...identifyArgs(), "--payload", JSON.stringify({ name: "Nuevo", coordinator: "Nueva" })
  ], fixture);
  assert.equal(result.status, 0, result.stderr);
  const rpc = rpcWrites(fixture.calls);
  assert.equal(rpc.length, 1);
  assert.equal(patchWrites(fixture.calls).length, 0);
  const body = JSON.parse(rpc[0].options.body);
  assert.equal(body.expected_revision, 12);
  assert.equal(body.next_document.calendarMeta.name, "Nuevo");
  assert.equal(body.next_document.calendarMeta.coordinator, "Nueva");
  const output = JSON.parse(result.stdout);
  assert.equal(output.written.kind, "cloud");
  assert.equal(output.written.revision, 13);
  assert.equal(output.document.calendarMeta.name, "Nuevo");
  assert.equal(output.document.calendarMeta.coordinator, "Nueva");
  assert.equal(output.source.cloudRevision, 12);
});

test("C12 identify en conflicto produce CONFLICT sin reload ni reap", async () => {
  const fixture = makeFixture({ cloudRevision: 12, rpcResponder: () => response([]) });
  const result = await invokeCli([
    ...identifyArgs(), "--payload", JSON.stringify({ name: "Nuevo", coordinator: "Nueva" })
  ], fixture);
  assert.equal(result.status, 4);
  assert.match(result.stderr, /CONFLICT/);
  assert.equal(rpcWrites(fixture.calls).length, 1);
  const rpcIndex = fixture.calls.findIndex((call) => call.url.includes(RPC_PATH));
  assert.equal(fixture.calls.slice(rpcIndex + 1).length, 0, "no debe recargar ni reaplicar");
});

test("C13 identify --dry-run no emite ningún RPC", async () => {
  const fixture = makeFixture({ cloudRevision: 12 });
  const result = await invokeCli([
    ...identifyArgs(), "--dry-run", "--payload", JSON.stringify({ name: "Nuevo", coordinator: "Nueva" })
  ], fixture);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(rpcWrites(fixture.calls).length, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.changed, true);
  assert.equal(output.written, null);
});

test("C14 identify no-op no emite ningún RPC", async () => {
  const fixture = makeFixture({ cloudRevision: 12 });
  const result = await invokeCli([
    ...identifyArgs(), "--payload", JSON.stringify({ name: "Cronograma HVAC", coordinator: "" })
  ], fixture);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.changed, false);
  assert.equal(output.written, null);
  assert.equal(rpcWrites(fixture.calls).length, 0);
});

test("C15 no se filtran tokens en stdout ni stderr", async () => {
  const fixture = makeFixture({ cloudRevision: 12 });
  const result = await invokeCli([...baseArgs(), "--payload", createPayload()], fixture);
  assert.equal(result.status, 0, result.stderr);
  for (const stream of [result.stdout, result.stderr]) {
    assert.ok(!stream.includes(ACCESS_TOKEN));
    assert.ok(!stream.includes(REFRESH_TOKEN));
    assert.ok(!stream.includes(CONFIG.publishableKey));
  }
});
