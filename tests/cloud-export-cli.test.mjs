import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { PassThrough } from "node:stream";
import { createDefaultDocument } from "../packages/platform/src/core.js";
import { createSupabaseAuthClient } from "../apps/cli/src/cloud-auth.js";
import { documentHash } from "../apps/cli/src/source-metadata.js";
import { runCli } from "../apps/cli/src/main.js";

const CONFIG = { url: "https://example.supabase.co", publishableKey: "sb_publishable_fixture" };
const USER = { id: "11111111-1111-4111-8111-111111111111", email: "fixture@example.com" };
const CALENDAR_BETA = "11111111-1111-4111-8111-111111111113";
const CALENDAR_BETA_2 = "11111111-1111-4111-8111-111111111114";
const NOW = "2026-10-10T15:00:00.000Z";
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
  return {
    value: {
      access_token: ACCESS_TOKEN,
      refresh_token: REFRESH_TOKEN,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: USER
    },
    async read() { return this.value; },
    async write(next) { this.value = next; },
    async remove() { this.value = null; }
  };
}

function documentFixture() {
  const document = createDefaultDocument("2026-10-01", NOW);
  document.calendarMeta.id = "calendario_principal";
  document.calendarMeta.revision = 517;
  document.calendarMeta.updatedAt = "2026-10-09T19:08:40.922Z";
  document.catalog.clients.push({ id: "cliente_base-operativa-dm-clientes-2", name: "Coopidrogas", active: true });
  document.catalog.sites.push({ id: "sede_base-operativa-dm-sede-10", clientId: "cliente_base-operativa-dm-clientes-2", name: "Coopidrogas Pereira", city: "Pereira", active: true });
  document.activities.push({
    id: "actividad_fixture", seriesId: null, date: "2026-10-01", planningBucket: "calendar",
    clientId: "cliente_base-operativa-dm-clientes-2", siteId: "sede_base-operativa-dm-sede-10",
    city: "Pereira", responsibleIds: [], serviceType: "preventive", status: "scheduled",
    sortOrder: null, observations: "", createdAt: NOW, updatedAt: NOW, completedAt: null, history: []
  });
  return document;
}

function makeFixture({ calendars, cloudRevision = 688, documentRevision = 517 } = {}) {
  const store = sessionStore();
  const calls = [];
  const document = documentFixture();
  const rows = calendars ?? [{
    id: CALENDAR_BETA, legacy_id: "calendario-hvac-siys-beta", name: "Cronograma hvac",
    coordinator: "Yuliam rivera", created_by: USER.id, created_at: "2026-08-04T03:18:22.643151+00:00", updated_at: NOW
  }];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes("/auth/v1/user")) return response(USER);
    if (url.includes("/rest/v1/profiles?")) return response([{ id: USER.id, display_name: "Yuliam Rivera" }]);
    if (url.includes("/rest/v1/calendars?legacy_id=")) return response(rows);
    if (url.includes("/rest/v1/calendar_documents?calendar_id=")) {
      const remote = { ...document, calendarMeta: { ...document.calendarMeta, revision: documentRevision } };
      return response([{ document: remote, revision: cloudRevision, updated_at: "2026-10-09T19:16:56.349008+00:00", updated_by: USER.id }]);
    }
    if (url.includes(RPC_PATH)) return response([]);
    throw new Error(`Ruta no simulada: ${url}`);
  };
  const auth = createSupabaseAuthClient(CONFIG, { fetchImpl, sessionStore: store });
  return { auth, store, fetchImpl, calls, document };
}

function outputStream() {
  const stream = new PassThrough();
  const chunks = [];
  stream.on("data", (chunk) => chunks.push(chunk.toString()));
  return { stream, text: () => chunks.join("") };
}

async function invokeCli(args, fixture) {
  const stdout = outputStream();
  const stderr = outputStream();
  const status = await runCli(args, {
    stdout: stdout.stream,
    stderr: stderr.stream,
    fetch: fixture.fetchImpl,
    sessionStore: fixture.store,
    stdin: new PassThrough(),
    env: {
      ...process.env,
      SIYS_SUPABASE_URL: CONFIG.url,
      SIYS_SUPABASE_PUBLISHABLE_KEY: CONFIG.publishableKey
    }
  });
  return { status, stdout: stdout.text(), stderr: stderr.text() };
}

function rpcWrites(calls) {
  return calls.filter((call) => call.url.includes(RPC_PATH));
}

async function withDirectory(run) {
  const directory = await mkdtemp(resolve(tmpdir(), "calendary-export-"));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const EXPORT_ARGS = ["cloud", "export-backup", "--channel", "beta", "--calendar-id", CALENDAR_BETA, "--output", "json"];

test("E1 export-backup escribe un respaldo compatible con document y capture separados", async () => {
  await withDirectory(async (directory) => {
    const fixture = makeFixture();
    const target = resolve(directory, "respaldo.json");
    const result = await invokeCli([...EXPORT_ARGS, "--output-file", target], fixture);
    assert.equal(result.status, 0, result.stderr);

    const raw = JSON.parse(await readFile(target, "utf8"));
    assert.equal(raw.format, "calendario-hvac-siys-backup");
    assert.equal(raw.formatVersion, 1);
    assert.equal(raw.channel, "beta");
    assert.equal(raw.revision, 517);
    assert.equal(raw.document.calendarMeta.revision, 517);
    assert.equal(raw.document.activities.length, 1);

    assert.equal(raw.capture.extractor, "calendary-cli");
    assert.equal(raw.capture.channel, "beta");
    assert.equal(raw.capture.calendarId, CALENDAR_BETA);
    assert.equal(raw.capture.cloudRevision, 688);
    assert.equal(raw.capture.documentRevision, 517);
    assert.equal(raw.capture.documentUpdatedAt, "2026-10-09T19:16:56.349008+00:00");
    assert.match(raw.capture.observedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(raw.capture.documentHash, documentHash(raw.document));
    assert.deepEqual(raw.capture.warnings, ["REVISION_COUNTERS_DIFFER"]);
    assert.equal(Object.hasOwn(raw.document, "capture"), false);

    const output = JSON.parse(result.stdout);
    assert.equal(output.exported, true);
    assert.equal(output.file.path, target);
    assert.ok(output.file.bytes > 0);
    assert.equal(rpcWrites(fixture.calls).length, 0, "la exportación no debe escribir el calendario");
    for (const stream of [result.stdout, result.stderr]) {
      assert.ok(!stream.includes(ACCESS_TOKEN));
      assert.ok(!stream.includes(REFRESH_TOKEN));
      assert.ok(!stream.includes(CONFIG.publishableKey));
    }
  });
});

test("E2 selección ambigua se rechaza sin exportar", async () => {
  await withDirectory(async (directory) => {
    const rows = [
      { id: CALENDAR_BETA, legacy_id: "calendario-hvac-siys-beta", name: "A", created_by: USER.id, created_at: NOW, updated_at: NOW },
      { id: CALENDAR_BETA_2, legacy_id: "calendario-hvac-siys-beta", name: "B", created_by: USER.id, created_at: NOW, updated_at: NOW }
    ];
    const fixture = makeFixture({ calendars: rows });
    const target = resolve(directory, "respaldo.json");
    const result = await invokeCli(["cloud", "export-backup", "--channel", "beta", "--output-file", target, "--output", "json"], fixture);
    assert.equal(result.status, 4);
    assert.match(result.stderr, /CALENDAR_AMBIGUOUS/);
    await assert.rejects(readFile(target, "utf8"));
  });
});

test("E3 no sobreescribe un destino existente", async () => {
  await withDirectory(async (directory) => {
    const fixture = makeFixture();
    const target = resolve(directory, "respaldo.json");
    await writeFile(target, "{\"previo\":true}", "utf8");
    const result = await invokeCli([...EXPORT_ARGS, "--output-file", target], fixture);
    assert.equal(result.status, 4);
    assert.match(result.stderr, /OUTPUT_EXISTS/);
    assert.equal(await readFile(target, "utf8"), "{\"previo\":true}");
    assert.equal(rpcWrites(fixture.calls).length, 0);
  });
});

test("E4 canal inválido falla antes de cualquier red", async () => {
  await withDirectory(async (directory) => {
    const fixture = makeFixture();
    const target = resolve(directory, "respaldo.json");
    const result = await invokeCli(["cloud", "export-backup", "--channel", "local", "--calendar-id", CALENDAR_BETA, "--output-file", target], fixture);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /CHANNEL_INVALID/);
    assert.equal(fixture.calls.length, 0);
  });
});

test("E5 --output-file es obligatorio", async () => {
  const fixture = makeFixture();
  const result = await invokeCli(EXPORT_ARGS, fixture);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /INVALID_REQUEST/);
  assert.equal(fixture.calls.length, 0);
});

test("E6 --mine y --calendar-id son mutuamente excluyentes", async () => {
  await withDirectory(async (directory) => {
    const fixture = makeFixture();
    const target = resolve(directory, "respaldo.json");
    const result = await invokeCli([...EXPORT_ARGS, "--mine", "--output-file", target], fixture);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /INVALID_REQUEST/);
    assert.equal(fixture.calls.length, 0);
  });
});

test("E7 --mine selecciona el calendario del usuario y no escribe", async () => {
  await withDirectory(async (directory) => {
    const rows = [
      { id: CALENDAR_BETA, legacy_id: "calendario-hvac-siys-beta", name: "mío", created_by: USER.id, created_at: NOW, updated_at: NOW },
      { id: CALENDAR_BETA_2, legacy_id: "calendario-hvac-siys-beta", name: "ajeno", created_by: "22222222-2222-4222-8222-222222222222", created_at: NOW, updated_at: NOW }
    ];
    const fixture = makeFixture({ calendars: rows });
    const target = resolve(directory, "respaldo.json");
    const result = await invokeCli(["cloud", "export-backup", "--channel", "beta", "--mine", "--output-file", target, "--output", "json"], fixture);
    assert.equal(result.status, 0, result.stderr);
    const raw = JSON.parse(await readFile(target, "utf8"));
    assert.equal(raw.capture.calendarId, CALENDAR_BETA);
    assert.equal(rpcWrites(fixture.calls).length, 0);
    assert.equal(fixture.calls.every((call) => String(call.options.method ?? "GET").toUpperCase() === "GET"), true);
  });
});
