import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { PassThrough } from "node:stream";
import { CALENDAR_OPERATIONS } from "../packages/platform/src/calendar-contract.js";
import { createBackupEnvelope, createDefaultDocument } from "../packages/platform/src/core.js";
import { createSupabaseAuthClient } from "../apps/cli/src/cloud-auth.js";
import { runCli } from "../apps/cli/src/main.js";

const CONFIG = { url: "https://example.supabase.co", publishableKey: "sb_publishable_fixture" };
const USER = { id: "11111111-1111-4111-8111-111111111111", email: "fixture@example.com" };
const CALENDAR_ID = "11111111-1111-4111-8111-111111111112";
const NOW = "2026-08-03T12:00:00.000Z";
const ACCESS_TOKEN = "fixture-access-token";
const REFRESH_TOKEN = "fixture-refresh-token";
const RPC_PATH = "/rest/v1/rpc/persist_calendar_document";
const ALL_OPERATIONS = Object.keys(CALENDAR_OPERATIONS).sort();

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

function baseDocument() {
  const document = createDefaultDocument("2026-08-03", NOW);
  document.calendarMeta.id = "calendar-meta-fixture";
  document.calendarMeta.revision = 3;
  document.catalog.clients.push({
    id: "client-1", name: "Cliente Prueba", active: true, source: "manual",
    sourceKey: "manual:client-1", updatedAt: NOW
  });
  document.catalog.sites.push({
    id: "site-1", clientId: "client-1", name: "Sede Prueba", city: "Pereira",
    active: true, source: "manual", sourceKey: "manual:site-1", updatedAt: NOW
  });
  document.catalog.responsibles.push({
    id: "person-1", name: "Ana Prueba", responsibleType: "payroll", active: true,
    source: "manual", sourceKey: "manual:person-1", updatedAt: NOW
  });
  return document;
}

// Fake Supabase stateful: sólo almacena estado; las reglas viven en calendar-contract.
function createSupabaseFake() {
  const document = baseDocument();
  const calendar = {
    id: CALENDAR_ID,
    legacy_id: "calendario-hvac-siys-beta",
    name: document.calendarMeta.name,
    coordinator: document.calendarMeta.coordinator,
    created_by: USER.id,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: NOW
  };
  const state = { document, calendar, revision: 10, calls: [] };
  const store = sessionStore();

  function handleRpc(body) {
    if (body.target_calendar_id !== CALENDAR_ID) return response({ message: "not found" }, 404);
    if (Number(body.expected_revision) !== state.revision) return response([]);
    state.document = body.next_document;
    state.revision += 1;
    state.calendar.name = body.next_document?.calendarMeta?.name ?? state.calendar.name;
    state.calendar.coordinator = body.next_document?.calendarMeta?.coordinator ?? "";
    return response([{ revision: state.revision, updated_at: NOW, updated_by: USER.id }]);
  }

  const fetchImpl = async (url, options = {}) => {
    state.calls.push({ url, options });
    if (url.includes("grant_type=refresh_token")) {
      return response({ access_token: ACCESS_TOKEN, refresh_token: REFRESH_TOKEN, expires_at: Math.floor(Date.now() / 1000) + 3600, user: USER });
    }
    if (url.includes(RPC_PATH)) return handleRpc(JSON.parse(options.body));
    if (url.includes("/rest/v1/profiles?")) return response([{ id: USER.id, display_name: "Usuario Fixture" }]);
    if (url.includes("/rest/v1/calendars?legacy_id=")) {
      return response([{
        ...state.calendar,
        name: state.document.calendarMeta.name,
        coordinator: state.document.calendarMeta.coordinator
      }]);
    }
    if (url.includes("/rest/v1/calendar_documents?calendar_id=")) {
      return response([{
        document: structuredClone(state.document),
        revision: state.revision,
        updated_at: "2026-08-15T14:58:00.000Z",
        updated_by: USER.id
      }]);
    }
    throw new Error(`Ruta no simulada: ${url}`);
  };

  const auth = createSupabaseAuthClient(CONFIG, { fetchImpl, sessionStore: store });
  assert.ok(auth);
  return { state, store, fetchImpl };
}

function outputStream() {
  const stream = new PassThrough();
  const chunks = [];
  stream.on("data", (chunk) => chunks.push(chunk.toString()));
  return { stream, text: () => chunks.join("") };
}

async function invoke(fixture, args, { stdin } = {}) {
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

function cloudArgs(group, action, extra = []) {
  return [group, action, "--source", "cloud", "--channel", "beta", "--calendar-id", CALENDAR_ID, "--output", "json", ...extra];
}

async function writeBackup(directory, document) {
  const path = resolve(directory, `respaldo-${Math.random().toString(16).slice(2)}.json`);
  await writeFile(path, JSON.stringify(createBackupEnvelope(document, { channel: "beta" }), null, 2), "utf8");
  return path;
}

test("ruta e2e cloud cubre el contrato público completo con fake Supabase stateful", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "calendary-cloud-e2e-"));
  const fixture = createSupabaseFake();
  const state = fixture.state;
  const used = new Set();

  async function readOperation(group, action, operationPayload = undefined, extra = []) {
    const operation = `${group}.${action}`;
    used.add(operation);
    const args = cloudArgs(group, action, extra);
    if (operationPayload !== undefined) args.push("--payload", JSON.stringify(operationPayload));
    const result = await invoke(fixture, args);
    assert.equal(result.status, 0, `${operation}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.equal(result.stderr, "", `${operation} no debe escribir en stderr.`);
    return JSON.parse(result.stdout);
  }

  async function writeOperation(group, action, operationPayload = undefined, extra = []) {
    const operation = `${group}.${action}`;
    used.add(operation);
    const before = state.revision;
    const args = cloudArgs(group, action, extra);
    if (operationPayload !== undefined) args.push("--payload", JSON.stringify(operationPayload));
    const result = await invoke(fixture, args);
    assert.equal(result.status, 0, `${operation}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.equal(result.stderr, "", `${operation} no debe escribir en stderr.`);
    const output = JSON.parse(result.stdout);
    if (!extra.includes("--dry-run")) {
      if (output.changed) {
        assert.equal(output.written?.revision, before + 1, `${operation}: written.revision debe avanzar`);
        assert.equal(state.revision, before + 1, `${operation}: cloudRevision remota debe avanzar`);
      } else {
        assert.equal(output.written, null, `${operation}: no-op sin escritura`);
        assert.equal(state.revision, before, `${operation}: no-op no avanza revisión`);
      }
    }
    return output;
  }

  try {
    // 1. Reads iniciales.
    const inspected = await readOperation("calendar", "inspect", {});
    assert.equal(inspected.result.counts.activities, 0);
    assert.equal(inspected.result.counts.clients, 1);
    assert.equal(inspected.source.kind, "cloud");
    assert.equal(inspected.source.cloudRevision, 10);
    assert.equal(inspected.source.documentRevision, 3);

    for (const type of ["client", "site", "responsible"]) {
      const list = await readOperation("catalog", "list", { type, active: true });
      assert.ok(Array.isArray(list.result.items));
    }

    // 2. Catálogo.
    const clientUpsert = await writeOperation("catalog", "upsert", {
      type: "client",
      values: { name: "Cliente Dos", active: true }
    });
    const clientTwoId = clientUpsert.result.itemId;
    assert.ok(clientTwoId);
    await writeOperation("catalog", "upsert", {
      type: "site",
      values: { clientId: "client-1", name: "Sede Dos", city: "Armenia", active: true }
    });
    await writeOperation("catalog", "upsert", {
      type: "responsible",
      values: { name: "Carlos Contratista", responsibleType: "contractor", company: "Proveedor", active: true }
    });
    const catalogQuery = await readOperation("catalog", "list", { type: "client", query: "dos" });
    assert.equal(catalogQuery.result.items.length, 1);
    assert.equal(catalogQuery.result.items[0].id, clientTwoId);

    // 3. Festivos.
    const holidays = await readOperation("holiday", "list", { year: 2026 });
    assert.ok(holidays.result.items.some((item) => item.date === "2026-08-17"));
    const holidayAdded = await writeOperation("holiday", "add", {
      date: "2026-08-18", type: "manual-closure", name: "Cierre de prueba", reason: "Ruta e2e"
    });
    const overrideId = holidayAdded.result.overrideId;
    const holidayRange = await readOperation("holiday", "list", { from: "2026-08-17", to: "2026-08-19" });
    assert.ok(holidayRange.result.items.some((item) => item.date === "2026-08-18"));

    // 4. Actividades.
    const created = await writeOperation("activity", "create", {
      date: "2026-08-03", endDate: "2026-08-05", clientId: "client-1", siteId: "site-1",
      city: "Pereira", responsibleIds: ["person-1"], serviceType: "preventive",
      status: "scheduled", observations: "Ruta inicial", includeNonWorking: false, forceIncludeDates: []
    });
    const seriesIds = created.result.activityIds;
    assert.equal(seriesIds.length, 3);

    // --payload-file actúa como operando, no como autoridad.
    const payloadPath = resolve(directory, "payload-extra.json");
    await writeFile(payloadPath, JSON.stringify({
      date: "2026-08-03", clientId: "client-1", siteId: "site-1", city: "Pereira",
      serviceType: "administrative", status: "scheduled", observations: "Extra 03"
    }), "utf8");
    const extraCreated = await writeOperation("activity", "create", undefined, ["--payload-file", payloadPath]);
    const extraId = extraCreated.result.activityIds[0];
    assert.ok(extraId);

    const reordered = await writeOperation("activity", "reorder", {
      activityIds: [extraId], targetId: seriesIds[0], targetDate: "2026-08-03", position: "before"
    });
    assert.ok(reordered.changed || reordered.result.order.length >= 1);

    const listed = await readOperation("activity", "list", {
      from: "2026-08-03", to: "2026-08-05", clientId: "client-1", siteId: "site-1",
      city: "Pereira", responsibleIds: ["person-1"], serviceTypes: ["preventive"],
      statuses: ["scheduled"], query: "ruta"
    });
    assert.equal(listed.result.items.length, 3);
    const fetched = await readOperation("activity", "get", { activityId: seriesIds[0] });
    assert.equal(fetched.result.id, seriesIds[0]);

    const edited = await writeOperation("activity", "edit", {
      activityId: seriesIds[0],
      patch: { observations: "Ruta editada", status: "confirmed" },
      commonScope: "series", statusScope: "series"
    });
    assert.equal(edited.result.activityIds.length, 3);

    const pendingCreated = await writeOperation("activity", "create", {
      planningBucket: "quarantine", clientId: "client-1", siteId: "site-1", city: "Pereira",
      responsibleIds: ["person-1"], serviceType: "warranty", status: "to_schedule", observations: "Pendiente e2e"
    });
    const pendingId = pendingCreated.result.activityIds[0];
    const pendingList = await readOperation("activity", "list", { planningBuckets: ["quarantine"], serviceTypes: ["warranty"] });
    assert.deepEqual(pendingList.result.items.map((item) => item.id), [pendingId]);
    await writeOperation("activity", "quarantine", { activityId: seriesIds[0], scope: "single" });
    const assigned = await writeOperation("activity", "assign-date", { activityId: seriesIds[0], targetDate: "2026-08-06" });
    assert.equal(assigned.result.status, "scheduled");

    // 4b. Movimiento bloqueado por domingo y movimiento autorizado.
    const blockedBefore = state.revision;
    const blocked = await invoke(fixture, cloudArgs("activity", "move", ["--payload", JSON.stringify({ activityIds: [seriesIds[0]], targetDate: "2026-08-09" })]));
    used.add("activity.move");
    assert.equal(blocked.status, 4, blocked.stderr);
    assert.match(blocked.stderr, /NON_WORKING_CONFIRMATION_REQUIRED/);
    assert.equal(state.revision, blockedBefore, "el rechazo no puede persistir");

    const moved = await writeOperation("activity", "move", {
      activityIds: [seriesIds[0]], targetDate: "2026-08-10", allowNonWorking: true
    });
    assert.equal(moved.result.moves.length, 1);

    const duplicate = await writeOperation("activity", "duplicate", { activityIds: [seriesIds[0]], targetDate: "2026-08-20" });
    const duplicateId = duplicate.result.activityIds[0];
    assert.ok(duplicateId);
    const extended = await writeOperation("activity", "extend", { activityId: seriesIds[1], targetDate: "2026-08-11" });
    const extendedId = extended.result.activityId;
    assert.ok(extendedId);
    const extendedRange = await writeOperation("activity", "extend-range", {
      activityId: seriesIds[1], fromDate: "2026-08-12", toDate: "2026-08-14", mode: "extend"
    });
    assert.equal(extendedRange.result.activityIds.length, 3);

    const status = await writeOperation("activity", "status", { activityId: duplicateId, status: "in_progress", scope: "single" });
    assert.deepEqual(status.result.activityIds, [duplicateId]);
    const bulk = await writeOperation("activity", "bulk-edit", {
      activityIds: [duplicateId, extendedId], field: "observations", mode: "append", value: "NOTA E2E"
    });
    assert.equal(bulk.result.activityIds.length, 2);
    const normalized = await writeOperation("document", "normalize-text", {
      includeActivities: true, includeCatalog: false, includeMeta: false
    });
    assert.equal(normalized.result.counts.fields > 0, true);
    const deleted = await writeOperation("activity", "delete", { activityIds: [extendedId] }, ["--yes"]);
    assert.deepEqual(deleted.result.activityIds, [extendedId]);

    const notFoundBefore = state.revision;
    const notFound = await invoke(fixture, cloudArgs("activity", "get", ["--activity-id", extendedId]));
    assert.equal(notFound.status, 3, notFound.stderr);
    assert.match(notFound.stderr, /NOT_FOUND/);
    assert.equal(state.revision, notFoundBefore);

    const noConfirmBefore = state.revision;
    const noConfirm = await invoke(fixture, cloudArgs("activity", "delete", ["--activity-ids", duplicateId]));
    assert.equal(noConfirm.status, 4, noConfirm.stderr);
    assert.match(noConfirm.stderr, /CONFIRMATION_REQUIRED/);
    assert.equal(state.revision, noConfirmBefore, "la confirmación faltante no persiste");

    // 5. calendar.identify sincroniza name/coordinator por el RPC.
    const identified = await writeOperation("calendar", "identify", { name: "Cronograma E2E", coordinator: "Coordinación" });
    assert.equal(identified.result.name, "Cronograma E2E");
    assert.equal(state.calendar.name, "Cronograma E2E");
    assert.equal(state.calendar.coordinator, "Coordinación");

    // 6. CSV con --csv-output como salida.
    const csvPath = resolve(directory, "programacion.csv");
    const csv = await invoke(fixture, cloudArgs("calendar", "export-csv", ["--year", "2026", "--month", "8", "--csv-output", csvPath]));
    used.add("calendar.export-csv");
    assert.equal(csv.status, 0, csv.stderr);
    assert.equal(csv.stdout, "");
    assert.equal(csv.stderr, "");
    const csvContent = await readFile(csvPath, "utf8");
    assert.match(csvContent, /Fecha/);
    assert.match(csvContent, /Ruta editada/);

    const quarantineCsvPath = resolve(directory, "pendientes.csv");
    const quarantineCsv = await invoke(fixture, cloudArgs("calendar", "export-quarantine-csv", ["--csv-output", quarantineCsvPath]));
    used.add("calendar.export-quarantine-csv");
    assert.equal(quarantineCsv.status, 0, quarantineCsv.stderr);
    const quarantineContent = await readFile(quarantineCsvPath, "utf8");
    assert.match(quarantineContent, /Bandeja/);
    assert.match(quarantineContent, /Pendiente e2e/);

    // 7. Backup merge y restore con --backup-file como único operando.
    const beforeMerge = structuredClone(state.document);
    const beforeMergeRevision = beforeMerge.calendarMeta.revision;
    const snapshotPath = await writeBackup(directory, beforeMerge);

    const incoming = structuredClone(beforeMerge);
    incoming.activities.push({
      id: "merge-activity", seriesId: null, date: "2026-08-25", planningBucket: "calendar",
      clientId: "client-1", siteId: "site-1", city: "Pereira", responsibleIds: [],
      serviceType: "administrative", status: "scheduled", sortOrder: null, observations: "Sólo en merge",
      createdAt: NOW, updatedAt: "2026-08-25T00:00:00.000Z", completedAt: null, history: []
    });
    const incomingPath = await writeBackup(directory, incoming);

    const merged = await writeOperation("backup", "merge", undefined, ["--backup-file", incomingPath]);
    assert.equal(merged.result.counts.added, 1);
    assert.ok(state.document.activities.some((item) => item.observations === "Sólo en merge"));

    const restored = await writeOperation("backup", "restore", undefined, ["--backup-file", snapshotPath, "--yes"]);
    assert.equal(restored.result.counts.activities, beforeMerge.activities.length);
    assert.equal(restored.document.calendarMeta.revision, beforeMergeRevision);
    assert.ok(!state.document.activities.some((item) => item.observations === "Sólo en merge"));
    assert.notEqual(state.revision, state.document.calendarMeta.revision, "la revisión CAS y la documental son independientes");

    // 8. holiday.delete confirmado tras la restauración.
    const deletedHoliday = await writeOperation("holiday", "delete", { overrideId }, ["--yes"]);
    assert.equal(deletedHoliday.result.overrideId, overrideId);

    // 9. dry-run, quiet y payload inválido.
    const dryBefore = state.revision;
    const dryRun = await writeOperation("activity", "create", {
      date: "2026-08-26", serviceType: "administrative", status: "scheduled"
    }, ["--dry-run"]);
    assert.equal(dryRun.changed, true);
    assert.equal(dryRun.written, null);
    assert.equal(state.revision, dryBefore, "dry-run no persiste");

    const quiet = await invoke(fixture, ["calendar", "inspect", "--source", "cloud", "--channel", "beta", "--calendar-id", CALENDAR_ID, "--quiet"]);
    assert.equal(quiet.status, 0, quiet.stderr);
    assert.equal(quiet.stdout, "");
    assert.equal(quiet.stderr, "");

    const invalidPayload = await invoke(fixture, cloudArgs("activity", "create", ["--dry-run", "--payload", "{no-json}"]));
    assert.equal(invalidPayload.status, 2);
    assert.match(invalidPayload.stderr, /INVALID_REQUEST/);
    assert.equal(invalidPayload.stdout, "");

    // 10. Cobertura completa del contrato público.
    assert.deepEqual([...used].sort(), ALL_OPERATIONS);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("el estado file retirado no revierte a JSON aunque existan archivos", async () => {
  const fixture = createSupabaseFake();
  const before = fixture.state.revision;
  const legacy = await invoke(fixture, ["activity", "create", "--source", "file", "--input", "viejo.json", "--write", "nuevo.json"]);
  assert.equal(legacy.status, 2, legacy.stderr);
  assert.match(legacy.stderr, /INVALID_REQUEST/);
  assert.equal(fixture.state.revision, before);
  assert.equal(fixture.state.calls.length, 0, "no debe haber red para un comando file retirado");
});

test("backup restore y merge con --source file fallan sin red ni archivo", async () => {
  const fixture = createSupabaseFake();
  for (const operation of ["restore", "merge"]) {
    const result = await invoke(fixture, ["backup", operation, "--source", "file", "--input", "actual.json", "--backup-file", "respaldo.json", "--write", "salida.json"]);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /INVALID_REQUEST/);
  }
  assert.equal(fixture.state.calls.length, 0, "ningún comando file retirado puede tocar la red");
});
