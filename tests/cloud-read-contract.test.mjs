import assert from "node:assert/strict";
import test from "node:test";
import { PassThrough } from "node:stream";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createBackupEnvelope, createDefaultDocument } from "../src/core.js";
import { executeCalendarOperation } from "../src/calendar-contract.js";
import { createSupabaseAuthClient } from "../src/cli/cloud-auth.js";
import { assertCloudReadMethod, CloudCalendarSource } from "../src/cli/cloud-read.js";
import { FileCalendarSource } from "../src/cli/sources.js";
import { runCli } from "../src/cli/main.js";

const CONFIG = { url: "https://example.supabase.co", publishableKey: "sb_publishable_fixture" };
const USER = { id: "11111111-1111-4111-8111-111111111111", email: "fixture@example.com" };
const CALENDAR_STABLE = "11111111-1111-4111-8111-111111111112";
const CALENDAR_BETA = "11111111-1111-4111-8111-111111111113";
const NOW = "2026-08-15T15:00:00.000Z";

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return payload === null ? "" : JSON.stringify(payload); }
  };
}

function sessionStore(initial = null) {
  let value = initial;
  return {
    async read() { return value; },
    async write(next) { value = next; },
    async remove() { value = null; },
    get value() { return value; }
  };
}

function documentWithActivities() {
  const document = createDefaultDocument("2026-08-15", NOW);
  document.calendarMeta.id = "calendar-meta-fixture";
  document.calendarMeta.revision = 7;
  document.calendarMeta.updatedAt = "2026-08-15T14:59:00.000Z";
  document.catalog.clients.push({ id: "client-1", name: "Cliente Fixture", active: true });
  document.catalog.sites.push({ id: "site-1", clientId: "client-1", name: "Sede Fixture", city: "Pereira", active: true });
  document.activities.push({
    id: "activity-today", seriesId: null, date: "2026-08-15", planningBucket: "calendar",
    clientId: "client-1", siteId: "site-1", city: "Pereira", responsibleIds: [],
    serviceType: "preventive", status: "scheduled", sortOrder: null, observations: "Hoy",
    createdAt: NOW, updatedAt: NOW, completedAt: null, history: []
  }, {
    id: "activity-other", seriesId: null, date: "2026-08-16", planningBucket: "calendar",
    clientId: "client-1", siteId: "site-1", city: "Pereira", responsibleIds: [],
    serviceType: "preventive", status: "scheduled", sortOrder: null, observations: "Mañana",
    createdAt: NOW, updatedAt: NOW, completedAt: null, history: []
  });
  return document;
}

function calendarRows(channel, count = 1) {
  const legacyId = channel === "beta" ? "calendario-hvac-siys-beta" : "calendario-hvac-siys";
  return Array.from({ length: count }, (_, index) => ({
    id: channel === "beta" ? CALENDAR_BETA : CALENDAR_STABLE,
    legacy_id: legacyId,
    name: `${channel} fixture ${index + 1}`,
    coordinator: "Coordinación Fixture",
    created_by: USER.id,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: NOW
  }));
}

function makeCloudFixture({ channel = "beta", calendars = calendarRows(channel), document = documentWithActivities(), cloudRevision = 7, documentRevision = 7, wrongLegacy = false, statusByPath = {} } = {}) {
  const store = sessionStore({
    access_token: "fixture-access-token",
    refresh_token: "fixture-refresh-token",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: USER
  });
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    const forced = Object.entries(statusByPath).find(([pattern]) => url.includes(pattern));
    if (forced) return response({ message: forced[1].message ?? "error" }, forced[1].status);
    if (url.includes("/auth/v1/token?grant_type=password")) return response({
      access_token: "fixture-access-token",
      refresh_token: "fixture-refresh-token",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: USER
    });
    if (url.includes("/auth/v1/user")) return response(USER);
    if (url.includes("/rest/v1/profiles?")) return response([{ id: USER.id, display_name: "Usuario Fixture" }]);
    if (url.includes("/rest/v1/calendars?legacy_id=")) {
      return response(wrongLegacy ? calendars.map((row) => ({ ...row, legacy_id: "otro-canal" })) : calendars);
    }
    if (url.includes("/rest/v1/calendar_documents?calendar_id=")) {
      const remoteDocument = { ...document, calendarMeta: { ...document.calendarMeta, revision: documentRevision } };
      return response([{ document: remoteDocument, revision: cloudRevision, updated_at: "2026-08-15T14:58:00.000Z", updated_by: USER.id }]);
    }
    throw new Error(`Ruta no simulada: ${url}`);
  };
  const auth = createSupabaseAuthClient(CONFIG, { fetchImpl, sessionStore: store });
  const source = new CloudCalendarSource(CONFIG, { auth, fetchImpl, now: () => NOW });
  return { source, auth, store, fetchImpl, calls, document };
}

async function invokeCli(args, fixture, env = {}) {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const out = [];
  const err = [];
  stdout.on("data", (chunk) => out.push(chunk.toString()));
  stderr.on("data", (chunk) => err.push(chunk.toString()));
  const status = await runCli(args, {
    stdout,
    stderr,
    fetch: fixture?.fetchImpl,
    sessionStore: fixture?.store,
    stdin: fixture?.stdin,
    env: {
      SIYS_SUPABASE_URL: CONFIG.url,
      SIYS_SUPABASE_PUBLISHABLE_KEY: CONFIG.publishableKey,
      ...process.env,
      ...env
    }
  });
  return { status, stdout: out.join(""), stderr: err.join("") };
}

test("T1 stable mapea legacy_id correcto", async () => {
  const fixture = makeCloudFixture({ channel: "stable" });
  const listed = await fixture.source.listCalendars({ channel: "stable" });
  assert.equal(listed[0].legacyId, "calendario-hvac-siys");
  assert.equal(listed[0].channel, "stable");
});

test("T2 beta mapea legacy_id correcto", async () => {
  const fixture = makeCloudFixture({ channel: "beta" });
  const listed = await fixture.source.listCalendars({ channel: "beta" });
  assert.equal(listed[0].legacyId, "calendario-hvac-siys-beta");
});

test("T3 local rechaza cloud", async () => {
  const fixture = makeCloudFixture();
  const result = await invokeCli(["activity", "list", "--source", "cloud", "--channel", "local", "--output", "json"], fixture);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /CHANNEL_INVALID/);
  assert.equal(fixture.calls.length, 0);
});

test("T4 lista calendarios", async () => {
  const fixture = makeCloudFixture();
  const result = await invokeCli(["cloud", "calendars", "--channel", "beta", "--output", "json"], fixture);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.calendars[0].calendarId, CALENDAR_BETA);
  assert.equal(output.calendars[0].ownerName, "Usuario Fixture");
});

test("T5 múltiples calendarios producen CALENDAR_AMBIGUOUS", async () => {
  const calendars = [...calendarRows("beta"), { ...calendarRows("beta")[0], id: "11111111-1111-4111-8111-111111111114", name: "beta fixture 2" }];
  const fixture = makeCloudFixture({ calendars });
  await assert.rejects(fixture.source.load({ channel: "beta" }), (error) => error.code === "CALENDAR_AMBIGUOUS");
});

test("T6 calendar-id exacto selecciona calendario", async () => {
  const fixture = makeCloudFixture();
  const loaded = await fixture.source.load({ channel: "beta", calendarId: CALENDAR_BETA });
  assert.equal(loaded.source.calendarId, CALENDAR_BETA);
});

test("T7 UUID inexistente produce CALENDAR_NOT_FOUND", async () => {
  const fixture = makeCloudFixture();
  await assert.rejects(fixture.source.load({ channel: "beta", calendarId: "11111111-1111-4111-8111-111111111199" }), (error) => error.code === "CALENDAR_NOT_FOUND");
});

test("T8 legacy/channel mismatch falla", async () => {
  const fixture = makeCloudFixture({ wrongLegacy: true });
  await assert.rejects(fixture.source.listCalendars({ channel: "beta" }), (error) => error.code === "CHANNEL_MISMATCH");
});

test("T9 carga documento actual", async () => {
  const fixture = makeCloudFixture();
  const loaded = await fixture.source.load({ channel: "beta", calendarId: CALENDAR_BETA });
  assert.equal(loaded.document.activities.length, 2);
  assert.equal(loaded.source.kind, "cloud");
});

test("T10 cloudRevision se conserva", async () => {
  const fixture = makeCloudFixture({ cloudRevision: 12, documentRevision: 12 });
  const loaded = await fixture.source.load({ channel: "beta", calendarId: CALENDAR_BETA });
  assert.equal(loaded.source.cloudRevision, 12);
  assert.equal(loaded.source.documentRevision, 12);
  assert.deepEqual(loaded.source.warnings, []);
});

test("T11 cloudRevision mayor que documentRevision es válido y se conserva", async () => {
  const fixture = makeCloudFixture({ cloudRevision: 12, documentRevision: 9 });
  const loaded = await fixture.source.load({ channel: "beta", calendarId: CALENDAR_BETA });
  assert.equal(loaded.source.cloudRevision, 12);
  assert.equal(loaded.source.documentRevision, 9);
  assert.deepEqual(loaded.source.warnings, ["REVISION_COUNTERS_DIFFER"]);
});

test("T12 cloudRevision menor que documentRevision es válido y se conserva", async () => {
  const fixture = makeCloudFixture({ cloudRevision: 4, documentRevision: 9 });
  const loaded = await fixture.source.load({ channel: "beta", calendarId: CALENDAR_BETA });
  assert.equal(loaded.source.cloudRevision, 4);
  assert.equal(loaded.source.documentRevision, 9);
  assert.deepEqual(loaded.source.warnings, ["REVISION_COUNTERS_DIFFER"]);
});

test("T13 observedAt está presente", async () => {
  const fixture = makeCloudFixture();
  const loaded = await fixture.source.load({ channel: "beta", calendarId: CALENDAR_BETA });
  assert.equal(loaded.source.observedAt, NOW);
});

test("T14 documentUpdatedAt se preserva", async () => {
  const fixture = makeCloudFixture();
  const loaded = await fixture.source.load({ channel: "beta", calendarId: CALENDAR_BETA });
  assert.equal(loaded.source.documentUpdatedAt, "2026-08-15T14:58:00.000Z");
});

test("T15 hash determinístico", async () => {
  const fixture = makeCloudFixture();
  const first = await fixture.source.load({ channel: "beta", calendarId: CALENDAR_BETA });
  const second = await fixture.source.load({ channel: "beta", calendarId: CALENDAR_BETA });
  assert.match(first.source.documentHash, /^[0-9a-f]{64}$/);
  assert.equal(first.source.documentHash, second.source.documentHash);
});

test("T16 activity.list reutiliza calendar-contract", async () => {
  const fixture = makeCloudFixture();
  const loaded = await fixture.source.load({ channel: "beta", calendarId: CALENDAR_BETA });
  const outcome = executeCalendarOperation(loaded.document, {
    operation: "activity.list",
    payload: { from: "2026-08-15", to: "2026-08-15" }
  });
  assert.deepEqual(outcome.result.items.map((item) => item.id), ["activity-today"]);
});

test("T17 filtro today/from/to correcto", async () => {
  for (const [cloudRevision, documentRevision] of [[12, 9], [4, 9]]) {
    const fixture = makeCloudFixture({ cloudRevision, documentRevision });
    const result = await invokeCli([
      "activity", "list", "--source", "cloud", "--channel", "beta", "--calendar-id", CALENDAR_BETA,
      "--from", "2026-08-15", "--to", "2026-08-15", "--output", "json"
    ], fixture);
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.deepEqual(output.result.items.map((item) => item.id), ["activity-today"]);
    assert.equal(output.source.channel, "beta");
    assert.equal(output.source.cloudRevision, cloudRevision);
    assert.equal(output.source.documentRevision, documentRevision);
    assert.deepEqual(output.source.warnings, ["REVISION_COUNTERS_DIFFER"]);
  }
});

test("T18 source=file continúa funcionando", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "calendary-cloud-read-file-"));
  try {
    const path = resolve(directory, "input.json");
    await writeFile(path, JSON.stringify(createBackupEnvelope(createDefaultDocument("2026-08-15", NOW), { channel: "local" })), "utf8");
    const source = await new FileCalendarSource(path, { now: () => NOW }).load();
    assert.equal(source.source.kind, "file");
    const result = await invokeCli(["calendar", "inspect", "--input", path, "--output", "json"], null);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).source.kind, "file");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("T19 operación write + cloud produce CLOUD_WRITE_NOT_ALLOWED antes de red", async () => {
  const fixture = makeCloudFixture();
  const result = await invokeCli(["activity", "create", "--source", "cloud", "--channel", "beta", "--calendar-id", CALENDAR_BETA, "--write", "never.json"], fixture);
  assert.equal(result.status, 4);
  assert.match(result.stderr, /CLOUD_WRITE_NOT_ALLOWED/);
  assert.equal(fixture.calls.length, 0);
});

test("T20 adaptador cloud rechaza métodos no GET", () => {
  assert.throws(() => assertCloudReadMethod("POST"), (error) => error.code === "CLOUD_WRITE_NOT_ALLOWED");
  assert.doesNotThrow(() => assertCloudReadMethod("GET"));
});

test("T21 error auth falla cerrado", async () => {
  const fixture = makeCloudFixture({ statusByPath: { "/rest/v1/calendars?": { status: 401, message: "expired" } } });
  fixture.store.value.refresh_token = "";
  await assert.rejects(fixture.source.load({ channel: "beta", calendarId: CALENDAR_BETA }), (error) => error.code === "AUTH_REQUIRED");
});

test("T22 error RLS/network no hace fallback silencioso a JSON", async () => {
  const fixture = makeCloudFixture({ statusByPath: { "/rest/v1/calendars?": { status: 403, message: "denied" } } });
  await assert.rejects(fixture.source.load({ channel: "beta", calendarId: CALENDAR_BETA }), (error) => error.code === "RLS_DENIED");
});

test("T23 --as-of falla con HISTORICAL_QUERY_UNSUPPORTED", async () => {
  const result = await invokeCli(["activity", "list", "--source", "cloud", "--channel", "beta", "--as-of", "2026-08-01", "--output", "json"], null);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /HISTORICAL_QUERY_UNSUPPORTED/);
});

test("T24 ningún secreto aparece en output/log", async () => {
  const fixture = makeCloudFixture();
  const result = await invokeCli(["cloud", "whoami", "--output", "json"], fixture);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!result.stdout.includes("fixture-access-token"));
  assert.ok(!result.stdout.includes("fixture-refresh-token"));
  assert.ok(!result.stderr.includes("fixture-access-token"));
  assert.ok(!result.stderr.includes("fixture-refresh-token"));
});

test("T25 --mine limita la selección al usuario autenticado", async () => {
  const fixture = makeCloudFixture();
  const result = await invokeCli(["cloud", "calendars", "--channel", "beta", "--mine", "--output", "json"], fixture);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.calendars.map((calendar) => calendar.createdBy), [USER.id]);
});

test("T26 cloud login no acepta contraseña por argv", async () => {
  const fixture = makeCloudFixture();
  const result = await invokeCli(["cloud", "login", "--email", USER.email, "--password", "no-debe-aparecer"], fixture);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /INVALID_REQUEST/);
  assert.ok(!result.stderr.includes("no-debe-aparecer"));
});

test("T27 cloud login acepta contraseña solo por stdin", async () => {
  const fixture = makeCloudFixture();
  fixture.stdin = new PassThrough();
  fixture.stdin.end("fixture-password\n");
  const result = await invokeCli(["cloud", "login", "--email", USER.email, "--password-stdin", "--output", "json"], fixture);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.loggedIn, true);
  assert.ok(!result.stdout.includes("fixture-access-token"));
  assert.equal(fixture.store.value.user.id, USER.id);
});
