import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createBackupEnvelope, createDefaultDocument } from "../src/core.js";

const root = resolve(import.meta.dirname, "..");
const bin = resolve(root, "bin", "calendary.js");
const NOW = "2026-08-03T12:00:00.000Z";
const ALL_OPERATIONS = [
  "calendar.inspect", "calendar.export-csv", "calendar.export-quarantine-csv",
  "activity.list", "activity.get", "activity.create", "activity.edit", "activity.move", "activity.quarantine", "activity.assign-date",
  "activity.duplicate", "activity.extend", "activity.status", "activity.bulk-edit", "activity.delete",
  "catalog.list", "catalog.upsert", "holiday.list", "holiday.add", "holiday.delete",
  "backup.restore", "backup.merge"
];

function invoke(args) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true
  });
}

function assertExit(result, expected = 0) {
  assert.equal(result.status, expected, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
}

function parseOutput(result) {
  assertExit(result);
  assert.equal(result.stderr, "", "Una operación exitosa no debe escribir diagnósticos en stderr.");
  return JSON.parse(result.stdout);
}

function payload(value) { return JSON.stringify(value); }

async function documentFrom(path) {
  return JSON.parse(await readFile(path, "utf8")).document;
}

async function makeFixture(directory) {
  const input = resolve(directory, "00-input.json");
  const document = createDefaultDocument("2026-08-03", NOW);
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
  await writeFile(input, JSON.stringify(createBackupEnvelope(document, { channel: "local" })), "utf8");
  return input;
}

test("ruta e2e de la CLI cubre el contrato completo y sus controles operativos", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "calendary-cli-e2e-"));
  const used = new Set();
  let sequence = 0;
  let current;
  try {
    current = await makeFixture(directory);

    const version = invoke(["--version"]);
    assertExit(version);
    assert.match(version.stdout.trim(), /^0\.12\.0-beta\.1$/);
    const help = invoke(["--help"]);
    assertExit(help);
    assert.match(help.stdout, /activity\s+list \| get \| create/);
    assert.match(help.stdout, /--version/);

    function readOperation(group, action, operationPayload = {}, extra = []) {
      const operation = `${group}.${action}`;
      used.add(operation);
      return parseOutput(invoke([
        group, action, "--input", current, "--output", "json",
        "--payload", payload(operationPayload), ...extra
      ]));
    }

    async function writeOperation(group, action, operationPayload = {}, extra = []) {
      const operation = `${group}.${action}`;
      used.add(operation);
      const output = resolve(directory, `${String(++sequence).padStart(2, "0")}-${group}-${action}.json`);
      const result = parseOutput(invoke([
        group, action, "--input", current, "--write", output, "--output", "json",
        "--payload", payload(operationPayload), ...extra
      ]));
      await access(output, constants.F_OK);
      current = output;
      return { result, output };
    }

    const inspected = readOperation("calendar", "inspect");
    assert.equal(inspected.result.counts.activities, 0);
    assert.equal(inspected.result.counts.clients, 1);

    for (const type of ["client", "site", "responsible"]) {
      const list = readOperation("catalog", "list", { type, active: true });
      assert.ok(Array.isArray(list.result.items));
    }
    const clientUpsert = await writeOperation("catalog", "upsert", {
      type: "client",
      values: { name: "Cliente Dos", active: true }
    });
    const clientTwoId = clientUpsert.result.result.itemId;
    const siteUpsert = await writeOperation("catalog", "upsert", {
      type: "site",
      values: { clientId: "client-1", name: "Sede Dos", city: "Armenia", active: true }
    });
    assert.ok(siteUpsert.result.result.itemId);
    const responsibleUpsert = await writeOperation("catalog", "upsert", {
      type: "responsible",
      values: { name: "Carlos Contratista", responsibleType: "contractor", company: "Proveedor", active: true }
    });
    assert.ok(responsibleUpsert.result.result.itemId);
    const catalogQuery = readOperation("catalog", "list", { type: "client", query: "dos" });
    assert.equal(catalogQuery.result.items.length, 1);
    assert.equal(catalogQuery.result.items[0].id, clientTwoId);

    const holidays = readOperation("holiday", "list", { year: 2026 });
    assert.ok(holidays.result.items.some((item) => item.date === "2026-08-17"));
    const holidayAdded = await writeOperation("holiday", "add", {
      date: "2026-08-18", type: "manual-closure", name: "Cierre de prueba", reason: "Ruta e2e"
    });
    const overrideId = holidayAdded.result.result.overrideId;
    const holidayRange = readOperation("holiday", "list", { from: "2026-08-17", to: "2026-08-19" });
    assert.ok(holidayRange.result.items.some((item) => item.date === "2026-08-18"));

    const created = await writeOperation("activity", "create", {
      date: "2026-08-03", endDate: "2026-08-05", clientId: "client-1", siteId: "site-1",
      city: "Pereira", responsibleIds: ["person-1"], serviceType: "preventive",
      status: "scheduled", observations: "Ruta inicial", includeNonWorking: false, forceIncludeDates: []
    });
    const seriesIds = created.result.result.activityIds;
    assert.equal(seriesIds.length, 3);
    const listed = readOperation("activity", "list", {
      from: "2026-08-03", to: "2026-08-05", clientId: "client-1", siteId: "site-1",
      city: "Pereira", responsibleIds: ["person-1"], serviceTypes: ["preventive"],
      statuses: ["scheduled"], query: "ruta"
    });
    assert.equal(listed.result.items.length, 3);
    const fetched = readOperation("activity", "get", { activityId: seriesIds[0] });
    assert.equal(fetched.result.id, seriesIds[0]);

    const edited = await writeOperation("activity", "edit", {
      activityId: seriesIds[0],
      patch: { observations: "Ruta editada", status: "confirmed" },
      commonScope: "series", statusScope: "series"
    });
    assert.equal(edited.result.result.activityIds.length, 3);

    const pendingCreated = await writeOperation("activity", "create", {
      planningBucket: "quarantine", clientId: "client-1", siteId: "site-1", city: "Pereira",
      responsibleIds: ["person-1"], serviceType: "warranty", status: "to_schedule", observations: "Pendiente e2e"
    });
    const pendingId = pendingCreated.result.result.activityIds[0];
    const pendingList = readOperation("activity", "list", { planningBuckets: ["quarantine"], serviceTypes: ["warranty"] });
    assert.deepEqual(pendingList.result.items.map((item) => item.id), [pendingId]);
    const quarantined = await writeOperation("activity", "quarantine", {
      activityId: seriesIds[0], scope: "single"
    });
    assert.equal(quarantined.result.result.activityId, seriesIds[0]);
    const assigned = await writeOperation("activity", "assign-date", {
      activityId: seriesIds[0], targetDate: "2026-08-06"
    });
    assert.equal(assigned.result.result.status, "scheduled");

    const blockedMoveOutput = resolve(directory, "blocked-move.json");
    used.add("activity.move");
    const blockedMove = invoke([
      "activity", "move", "--input", current, "--write", blockedMoveOutput,
      "--output", "json", "--payload", payload({ activityIds: [seriesIds[0]], targetDate: "2026-08-09" })
    ]);
    assertExit(blockedMove, 4);
    assert.match(blockedMove.stderr, /NON_WORKING_CONFIRMATION_REQUIRED/);
    await assert.rejects(access(blockedMoveOutput, constants.F_OK));

    const moved = await writeOperation("activity", "move", {
      activityIds: [seriesIds[0]], targetDate: "2026-08-10", allowNonWorking: true
    });
    assert.equal(moved.result.result.moves.length, 1);
    const duplicate = await writeOperation("activity", "duplicate", {
      activityIds: [seriesIds[0]], targetDate: "2026-08-20"
    });
    const duplicateId = duplicate.result.result.activityIds[0];
    assert.ok(duplicateId);
    const extended = await writeOperation("activity", "extend", {
      activityId: seriesIds[1], targetDate: "2026-08-11"
    });
    const extendedId = extended.result.result.activityId;
    assert.ok(extendedId);

    const status = await writeOperation("activity", "status", {
      activityId: duplicateId, status: "in_progress", scope: "single"
    });
    assert.deepEqual(status.result.result.activityIds, [duplicateId]);
    const bulk = await writeOperation("activity", "bulk-edit", {
      activityIds: [duplicateId, extendedId], field: "observations", mode: "append", value: "Nota e2e"
    });
    assert.equal(bulk.result.result.activityIds.length, 2);
    const deleted = await writeOperation("activity", "delete", { activityIds: [extendedId] }, ["--yes"]);
    assert.deepEqual(deleted.result.result.activityIds, [extendedId]);

    const notFound = invoke([
      "activity", "get", "--input", current, "--output", "json", "--activity-id", extendedId
    ]);
    assertExit(notFound, 3);
    assert.match(notFound.stderr, /NOT_FOUND/);

    const noConfirm = invoke([
      "activity", "delete", "--input", current, "--write", resolve(directory, "no-confirm.json"),
      "--output", "json", "--activity-ids", duplicateId
    ]);
    assertExit(noConfirm, 4);
    assert.match(noConfirm.stderr, /CONFIRMATION_REQUIRED/);

    const csv = resolve(directory, "programacion.csv");
    used.add("calendar.export-csv");
    const csvResult = invoke([
      "calendar", "export-csv", "--input", current, "--year", "2026", "--month", "8", "--csv-output", csv
    ]);
    assertExit(csvResult);
    assert.equal(csvResult.stdout, "");
    assert.equal(csvResult.stderr, "");
    const csvContent = await readFile(csv, "utf8");
    assert.match(csvContent, /Fecha/);
    assert.match(csvContent, /Ruta editada/);

    const quarantineCsv = resolve(directory, "pendientes.csv");
    used.add("calendar.export-quarantine-csv");
    const quarantineCsvResult = invoke([
      "calendar", "export-quarantine-csv", "--input", current, "--csv-output", quarantineCsv
    ]);
    assertExit(quarantineCsvResult);
    const quarantineCsvContent = await readFile(quarantineCsv, "utf8");
    assert.match(quarantineCsvContent, /Bandeja/);
    assert.match(quarantineCsvContent, /Pendiente e2e/);

    const beforeMerge = current;
    const incomingOutput = resolve(directory, "incoming.json");
    const incoming = invoke([
      "activity", "create", "--input", beforeMerge, "--write", incomingOutput, "--output", "json",
      "--payload", payload({ date: "2026-08-25", serviceType: "administrative", status: "scheduled", observations: "Sólo en merge" })
    ]);
    assertExit(incoming);
    used.add("activity.create");
    const incomingDocument = await documentFrom(incomingOutput);
    assert.ok(incomingDocument.activities.some((item) => item.observations === "Sólo en merge"));

    const merged = await writeOperation("backup", "merge", {}, ["--source", incomingOutput]);
    assert.equal(merged.result.result.counts.added, 1);
    const restored = await writeOperation("backup", "restore", {}, ["--source", beforeMerge, "--yes"]);
    assert.equal(restored.result.result.counts.activities, (await documentFrom(beforeMerge)).activities.length);
    const finalDocument = await documentFrom(current);
    assert.equal(finalDocument.activities.some((item) => item.observations === "Sólo en merge"), false);

    const dryRunOutput = resolve(directory, "dry-run.json");
    const dryRun = invoke([
      "activity", "create", "--input", current, "--write", dryRunOutput, "--dry-run", "--output", "json",
      "--payload", payload({ date: "2026-08-26", serviceType: "administrative", status: "scheduled" })
    ]);
    assertExit(dryRun);
    assert.equal(JSON.parse(dryRun.stdout).changed, true);
    await assert.rejects(access(dryRunOutput, constants.F_OK));

    const quiet = invoke(["calendar", "inspect", "--input", current, "--quiet"]);
    assertExit(quiet);
    assert.equal(quiet.stdout, "");
    assert.equal(quiet.stderr, "");

    const invalidPayload = invoke([
      "activity", "create", "--input", current, "--dry-run", "--payload", "{no-json}"
    ]);
    assertExit(invalidPayload, 2);
    assert.match(invalidPayload.stderr, /INVALID_REQUEST/);
    assert.equal(invalidPayload.stdout, "");

    const samePath = invoke([
      "activity", "create", "--input", current, "--write", current,
      "--payload", payload({ date: "2026-08-27", serviceType: "administrative", status: "scheduled" })
    ]);
    assertExit(samePath, 4);
    assert.match(samePath.stderr, /CONFLICT/);

    const deletedHoliday = await writeOperation("holiday", "delete", { overrideId }, ["--yes"]);
    assert.equal(deletedHoliday.result.result.overrideId, overrideId);

    assert.deepEqual([...used].sort(), [...ALL_OPERATIONS].sort());
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
