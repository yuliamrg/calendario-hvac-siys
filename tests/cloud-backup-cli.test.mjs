import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { PassThrough } from "node:stream";
import { createBackupEnvelope, createDefaultDocument } from "../packages/platform/src/core.js";
import { buildPayload } from "../apps/cli/src/arguments.js";
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

function cloudDocument({ documentRevision = 3 } = {}) {
  const document = createDefaultDocument("2026-09-01", NOW);
  document.calendarMeta.id = "calendar-meta-fixture";
  document.calendarMeta.revision = documentRevision;
  document.calendarMeta.name = "Cronograma Cloud";
  document.calendarMeta.coordinator = "Coordinación";
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

function makeFixture({ cloudRevision = 50, documentRevision = 3, rpcResponder } = {}) {
  const store = sessionStore();
  const calls = [];
  const document = cloudDocument({ documentRevision });
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
        document, revision: cloudRevision,
        updated_at: "2026-08-15T14:58:00.000Z", updated_by: USER.id
      }]);
    }
    throw new Error(`Ruta no simulada: ${url}`);
  };
  const auth = createSupabaseAuthClient(CONFIG, { fetchImpl, sessionStore: store });
  return { auth, store, fetchImpl, calls, document, cloudRevision };
}

function outputStream() {
  const stream = new PassThrough();
  const chunks = [];
  stream.on("data", (chunk) => chunks.push(chunk.toString()));
  return { stream, text: () => chunks.join("") };
}

async function invokeCli(args, fixture, { stdin } = {}) {
  const stdout = outputStream();
  const stderr = outputStream();
  const status = await runCli(args, {
    stdout: stdout.stream,
    stderr: stderr.stream,
    fetch: fixture.fetchImpl,
    sessionStore: fixture.store,
    stdin: stdin ?? new PassThrough(),
    env: {
      ...process.env,
      SIYS_SUPABASE_URL: CONFIG.url,
      SIYS_SUPABASE_PUBLISHABLE_KEY: CONFIG.publishableKey
    }
  });
  return { status, stdout: stdout.text(), stderr: stderr.text() };
}

async function invokeBare(args) {
  const stdout = outputStream();
  const stderr = outputStream();
  const status = await runCli(args, {
    stdout: stdout.stream,
    stderr: stderr.stream,
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

function cloudBackupArgs(operation, backupPath, extra = []) {
  return [
    "backup", operation, "--source", "cloud", "--channel", "beta",
    "--calendar-id", CALENDAR_ID, "--backup-file", backupPath, "--output", "json", ...extra
  ];
}

async function writeBackup(directory, document, { revision } = {}) {
  const path = resolve(directory, `respaldo-${Math.random().toString(16).slice(2)}.json`);
  const copy = structuredClone(document);
  if (revision !== undefined) copy.calendarMeta.revision = revision;
  await writeFile(path, JSON.stringify(createBackupEnvelope(copy, { channel: "beta" })), "utf8");
  return path;
}

async function withDirectory(run) {
  const directory = await mkdtemp(resolve(tmpdir(), "calendary-cloud-backup-"));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("R1 --source file|cloud es la única semántica y respaldo.json ya no es --source", async () => {
  const legacy = await invokeBare(["backup", "restore", "--source", "respaldo.json"]);
  assert.equal(legacy.status, 2);
  assert.match(legacy.stderr, /INVALID_REQUEST/);
  assert.match(legacy.stderr, /--backup-file/);

  const cloud = await invokeBare(["backup", "merge", "--source", "cloud"]);
  assert.equal(cloud.status, 2);
  assert.match(cloud.stderr, /CHANNEL_INVALID/);

  const bogus = await invokeBare(["activity", "list", "--source", "bogus"]);
  assert.equal(bogus.status, 2);
  assert.match(bogus.stderr, /sólo admite cloud/);
});

test("R2 --backup-file es obligatorio y es sólo operando del respaldo", async () => {
  await assert.rejects(
    buildPayload("backup.merge", {}),
    (error) => error.code === "INVALID_REQUEST" && /--backup-file/.test(error.message)
  );
  await withDirectory(async (directory) => {
    const backupPath = await writeBackup(directory, createDefaultDocument("2026-08-01", NOW), { revision: 5 });
    const payload = await buildPayload("backup.merge", { "backup-file": backupPath });
    assert.equal(payload.document.calendarMeta.revision, 5);
  });
});

test("S1 backup file fue retirado: --source file y --input fallan antes de red o archivo", async () => {
  const sourceFile = await invokeBare([
    "backup", "restore", "--source", "file", "--backup-file", "respaldo.json", "--yes"
  ]);
  assert.equal(sourceFile.status, 2, sourceFile.stderr);
  assert.match(sourceFile.stderr, /INVALID_REQUEST/);
  assert.match(sourceFile.stderr, /sólo admite cloud/);

  const mergeSourceFile = await invokeBare([
    "backup", "merge", "--source", "file", "--backup-file", "respaldo.json"
  ]);
  assert.equal(mergeSourceFile.status, 2, mergeSourceFile.stderr);
  assert.match(mergeSourceFile.stderr, /INVALID_REQUEST/);

  const inputFlag = await invokeBare([
    "backup", "merge", "--source", "cloud", "--channel", "beta", "--input", "actual.json", "--backup-file", "respaldo.json"
  ]);
  assert.equal(inputFlag.status, 2, inputFlag.stderr);
  assert.match(inputFlag.stderr, /INVALID_REQUEST/);
});

test("T1 restore cloud usa CAS de calendar_documents.revision y preserva la revisión del respaldo", async () => {
  await withDirectory(async (directory) => {
    const fixture = makeFixture({ cloudRevision: 50, documentRevision: 3 });
    const backupPath = await writeBackup(directory, createDefaultDocument("2026-08-01", NOW), { revision: 7 });

    const result = await invokeCli(cloudBackupArgs("restore", backupPath, ["--yes"]), fixture);
    assert.equal(result.status, 0, result.stderr);

    const rpc = rpcWrites(fixture.calls);
    assert.equal(rpc.length, 1);
    const body = JSON.parse(rpc[0].options.body);
    assert.equal(body.target_calendar_id, CALENDAR_ID);
    assert.equal(body.expected_revision, 50);
    assert.notEqual(body.expected_revision, 7, "el CAS no usa la revisión documental del respaldo");
    assert.equal(body.next_document.calendarMeta.revision, 7);

    const output = JSON.parse(result.stdout);
    assert.equal(output.source.cloudRevision, 50);
    assert.equal(output.source.documentRevision, 3);
    assert.equal(output.written.kind, "cloud");
    assert.equal(output.written.calendarId, CALENDAR_ID);
    assert.equal(output.written.revision, 51);
    assert.equal(output.document.calendarMeta.revision, 7);
    assert.notEqual(output.written.revision, output.document.calendarMeta.revision);
  });
});

test("U1 restore cloud --dry-run lee, valida y ejecuta el contrato sin persistir", async () => {
  await withDirectory(async (directory) => {
    const fixture = makeFixture({ cloudRevision: 50, documentRevision: 3 });
    const backupPath = await writeBackup(directory, createDefaultDocument("2026-08-01", NOW), { revision: 7 });

    const result = await invokeCli(cloudBackupArgs("restore", backupPath, ["--dry-run", "--yes"]), fixture);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(rpcWrites(fixture.calls).length, 0);
    const output = JSON.parse(result.stdout);
    assert.equal(output.changed, true);
    assert.equal(output.written, null);
    assert.equal(output.document.calendarMeta.revision, 7);
  });
});

test("V1 restore cloud en conflicto produce CONFLICT con un solo RPC sin recarga ni reaplicación", async () => {
  await withDirectory(async (directory) => {
    const fixture = makeFixture({ cloudRevision: 50, rpcResponder: () => response([]) });
    const backupPath = await writeBackup(directory, createDefaultDocument("2026-08-01", NOW), { revision: 7 });

    const result = await invokeCli(cloudBackupArgs("restore", backupPath, ["--yes"]), fixture);
    assert.equal(result.status, 4);
    assert.match(result.stderr, /CONFLICT/);
    const rpc = rpcWrites(fixture.calls);
    assert.equal(rpc.length, 1);
    const rpcIndex = fixture.calls.findIndex((call) => call.url.includes(RPC_PATH));
    assert.equal(
      fixture.calls.slice(rpcIndex + 1).filter((call) => call.options.method === "GET").length,
      0,
      "no debe recargar ni reaplicar"
    );
  });
});

test("W1 restore cloud sin --yes en no-TTY falla antes de persistir", async () => {
  await withDirectory(async (directory) => {
    const fixture = makeFixture({ cloudRevision: 50 });
    const backupPath = await writeBackup(directory, createDefaultDocument("2026-08-01", NOW), { revision: 7 });

    const result = await invokeCli(cloudBackupArgs("restore", backupPath), fixture);
    assert.equal(result.status, 4);
    assert.match(result.stderr, /CONFIRMATION_REQUIRED/);
    assert.equal(rpcWrites(fixture.calls).length, 0);
  });
});

test("W2 backup cloud rechaza --input y --write", async () => {
  await withDirectory(async (directory) => {
    const fixture = makeFixture({ cloudRevision: 50 });
    const backupPath = await writeBackup(directory, createDefaultDocument("2026-08-01", NOW), { revision: 7 });
    for (const flag of [["--input", "actual.json"], ["--write", "salida.json"]]) {
      const result = await invokeCli(cloudBackupArgs("restore", backupPath, ["--yes", ...flag]), fixture);
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, /INVALID_REQUEST/);
      assert.equal(rpcWrites(fixture.calls).length, 0);
    }
  });
});

test("X1 merge cloud con cambios emite un RPC CAS e independiza las dos revisiones", async () => {
  await withDirectory(async (directory) => {
    const fixture = makeFixture({ cloudRevision: 50, documentRevision: 3 });
    const backup = structuredClone(fixture.document);
    backup.catalog.clients.push({ id: "client-2", name: "Cliente Dos", active: true, updatedAt: NOW });
    const backupPath = await writeBackup(directory, backup);

    const result = await invokeCli(cloudBackupArgs("merge", backupPath), fixture);
    assert.equal(result.status, 0, result.stderr);

    const rpc = rpcWrites(fixture.calls);
    assert.equal(rpc.length, 1);
    const body = JSON.parse(rpc[0].options.body);
    assert.equal(body.expected_revision, 50);
    assert.equal(body.next_document.calendarMeta.revision, 4);
    assert.equal(body.next_document.catalog.clients.length, 2);

    const output = JSON.parse(result.stdout);
    assert.equal(output.written.revision, 51);
    assert.notEqual(output.written.revision, output.document.calendarMeta.revision);
  });
});

test("X2 merge cloud no-op no emite RPC", async () => {
  await withDirectory(async (directory) => {
    const fixture = makeFixture({ cloudRevision: 50, documentRevision: 3 });
    const backupPath = await writeBackup(directory, fixture.document);

    const result = await invokeCli(cloudBackupArgs("merge", backupPath), fixture);
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.changed, false);
    assert.equal(output.written, null);
    assert.equal(rpcWrites(fixture.calls).length, 0);
  });
});

test("X3 merge cloud --dry-run no emite RPC", async () => {
  await withDirectory(async (directory) => {
    const fixture = makeFixture({ cloudRevision: 50, documentRevision: 3 });
    const backup = structuredClone(fixture.document);
    backup.catalog.clients.push({ id: "client-2", name: "Cliente Dos", active: true, updatedAt: NOW });
    const backupPath = await writeBackup(directory, backup);

    const result = await invokeCli(cloudBackupArgs("merge", backupPath, ["--dry-run"]), fixture);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).changed, true);
    assert.equal(rpcWrites(fixture.calls).length, 0);
  });
});

test("X4 merge cloud en conflicto emite un RPC y aborta", async () => {
  await withDirectory(async (directory) => {
    const fixture = makeFixture({ cloudRevision: 50, rpcResponder: () => response([]) });
    const backup = structuredClone(fixture.document);
    backup.catalog.clients.push({ id: "client-2", name: "Cliente Dos", active: true, updatedAt: NOW });
    const backupPath = await writeBackup(directory, backup);

    const result = await invokeCli(cloudBackupArgs("merge", backupPath), fixture);
    assert.equal(result.status, 4);
    assert.match(result.stderr, /CONFLICT/);
    const rpc = rpcWrites(fixture.calls);
    assert.equal(rpc.length, 1);
    const rpcIndex = fixture.calls.findIndex((call) => call.url.includes(RPC_PATH));
    assert.equal(fixture.calls.slice(rpcIndex + 1).length, 0, "no debe recargar ni reaplicar");
  });
});

test("Y1 restore cloud no filtra tokens en stdout ni stderr", async () => {
  await withDirectory(async (directory) => {
    const fixture = makeFixture({ cloudRevision: 50 });
    const backupPath = await writeBackup(directory, createDefaultDocument("2026-08-01", NOW), { revision: 7 });
    const result = await invokeCli(cloudBackupArgs("restore", backupPath, ["--yes"]), fixture);
    assert.equal(result.status, 0, result.stderr);
    for (const stream of [result.stdout, result.stderr]) {
      assert.ok(!stream.includes(ACCESS_TOKEN));
      assert.ok(!stream.includes(REFRESH_TOKEN));
      assert.ok(!stream.includes(CONFIG.publishableKey));
    }
  });
});
