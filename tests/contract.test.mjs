import test from "node:test";
import assert from "node:assert/strict";
import {
  CONTRACT_VERSION,
  CalendarContractError,
  executeCalendarOperation
} from "../src/calendar-contract.js";
import { createDefaultDocument } from "../src/core.js";

const NOW = "2026-08-03T12:00:00.000Z";

function idFactory() {
  let value = 0;
  return () => `id-${++value}`;
}

function documentFixture() {
  const document = createDefaultDocument("2026-08-03", "2026-08-01T00:00:00.000Z");
  document.catalog.clients.push({
    id: "client-1", name: "Cliente Uno", active: true, source: "manual",
    sourceKey: "manual:client-1", updatedAt: NOW
  });
  document.catalog.sites.push({
    id: "site-1", clientId: "client-1", name: "Sede Uno", city: "Pereira",
    active: true, source: "manual", sourceKey: "manual:site-1", updatedAt: NOW
  });
  document.catalog.responsibles.push({
    id: "person-1", name: "Ana Técnica", responsibleType: "payroll", active: true,
    source: "manual", sourceKey: "manual:person-1", updatedAt: NOW
  });
  return document;
}

function createOne(document, overrides = {}, options = {}) {
  return executeCalendarOperation(document, {
    operation: "activity.create",
    payload: {
      date: "2026-08-03",
      clientId: "client-1",
      siteId: "site-1",
      city: "Pereira",
      responsibleIds: ["person-1"],
      serviceType: "preventive",
      status: "scheduled",
      observations: "Visita inicial",
      ...overrides
    }
  }, { now: NOW, idFactory: options.idFactory ?? idFactory() });
}

test("el contrato crea de forma atómica y actualiza una sola revisión", () => {
  const original = documentFixture();
  const result = createOne(original);
  assert.equal(CONTRACT_VERSION, 1);
  assert.equal(original.activities.length, 0);
  assert.equal(result.changed, true);
  assert.equal(result.document.activities.length, 1);
  assert.equal(result.document.calendarMeta.revision, 1);
  assert.equal(result.document.audit.at(-1).action, "activity_created");
  assert.equal(result.result.activityIds[0], "actividad_id-1");
});

test("un error conserva intacto el documento y usa un código estable", () => {
  const original = documentFixture();
  const snapshot = structuredClone(original);
  assert.throws(
    () => createOne(original, { siteId: "missing" }),
    (error) => error instanceof CalendarContractError && error.code === "VALIDATION_FAILED"
  );
  assert.deepEqual(original, snapshot);
});

test("inspect, list y get producen vistas resueltas sin mutar", () => {
  const created = createOne(documentFixture()).document;
  const inspect = executeCalendarOperation(created, { operation: "calendar.inspect" });
  const listed = executeCalendarOperation(created, {
    operation: "activity.list",
    payload: { clientId: "client-1", statuses: ["scheduled"] }
  });
  const item = executeCalendarOperation(created, {
    operation: "activity.get",
    payload: { activityId: created.activities[0].id }
  });
  assert.equal(inspect.changed, false);
  assert.equal(inspect.result.counts.activities, 1);
  assert.equal(listed.result.items[0].clientName, "Cliente Uno");
  assert.equal(item.result.siteName, "Sede Uno");
});

test("la edición respeta el alcance de datos, estado y fecha", () => {
  const ranged = createOne(documentFixture(), {
    date: "2026-08-03",
    endDate: "2026-08-05"
  }).document;
  const target = ranged.activities[0];
  const edited = executeCalendarOperation(ranged, {
    operation: "activity.edit",
    payload: {
      activityId: target.id,
      commonScope: "series",
      statusScope: "future",
      patch: { observations: "Serie actualizada", status: "confirmed", date: "2026-08-04" }
    }
  }, { now: "2026-08-03T13:00:00.000Z" });
  assert.ok(edited.document.activities.every((item) => item.observations === "Serie actualizada"));
  assert.ok(edited.document.activities.every((item) => item.status === "confirmed"));
  assert.equal(edited.document.activities.find((item) => item.id === target.id).date, "2026-08-04");
  assert.equal(edited.document.calendarMeta.revision, ranged.calendarMeta.revision + 1);
});

test("mover a domingo exige confirmación y mover al mismo día es no-op", () => {
  const created = createOne(documentFixture()).document;
  const id = created.activities[0].id;
  assert.throws(
    () => executeCalendarOperation(created, {
      operation: "activity.move",
      payload: { activityIds: [id], targetDate: "2026-08-09" }
    }),
    (error) => error.code === "NON_WORKING_CONFIRMATION_REQUIRED"
  );
  const noOp = executeCalendarOperation(created, {
    operation: "activity.move",
    payload: { activityIds: [id], targetDate: "2026-08-03" }
  }, { now: NOW });
  assert.equal(noOp.changed, false);
  assert.equal(noOp.document.calendarMeta.revision, created.calendarMeta.revision);
});

test("duplicar, ampliar, cambiar estado y editar en lote usan el mismo contrato", () => {
  const nextId = idFactory();
  let document = createOne(documentFixture(), {}, { idFactory: nextId }).document;
  const sourceId = document.activities[0].id;
  const duplicated = executeCalendarOperation(document, {
    operation: "activity.duplicate",
    payload: { activityIds: [sourceId], targetDate: "2026-08-04" }
  }, { now: NOW, idFactory: nextId });
  document = duplicated.document;
  const extended = executeCalendarOperation(document, {
    operation: "activity.extend",
    payload: { activityId: sourceId, targetDate: "2026-08-05" }
  }, { now: NOW, idFactory: nextId });
  document = extended.document;
  const status = executeCalendarOperation(document, {
    operation: "activity.status",
    payload: { activityId: sourceId, status: "confirmed", scope: "series" }
  }, { now: NOW });
  const bulk = executeCalendarOperation(status.document, {
    operation: "activity.bulk-edit",
    payload: {
      activityIds: status.result.activityIds,
      field: "observations",
      mode: "append",
      value: "Confirmada"
    }
  }, { now: NOW });
  assert.equal(duplicated.result.activityIds.length, 1);
  assert.ok(extended.result.seriesId);
  assert.ok(status.result.activityIds.length >= 2);
  assert.ok(bulk.document.activities.find((item) => item.id === sourceId).observations.includes("Confirmada"));
});

test("estado y edición múltiple idénticos son no-op", () => {
  const created = createOne(documentFixture()).document;
  const id = created.activities[0].id;
  const status = executeCalendarOperation(created, {
    operation: "activity.status",
    payload: { activityId: id, status: "scheduled", scope: "single" }
  });
  const bulk = executeCalendarOperation(created, {
    operation: "activity.bulk-edit",
    payload: { activityIds: [id], field: "observations", mode: "replace", value: "Visita inicial" }
  });
  assert.equal(status.changed, false);
  assert.equal(bulk.changed, false);
});

test("catálogo y excepciones conservan origen y detectan conflictos", () => {
  let document = documentFixture();
  const catalog = executeCalendarOperation(document, {
    operation: "catalog.upsert",
    payload: {
      type: "responsible",
      values: { name: "Carlos Contratista", responsibleType: "contractor", company: "Proveedor" }
    }
  }, { now: NOW, idFactory: idFactory() });
  document = catalog.document;
  assert.equal(catalog.result.item.source, "manual");
  const holiday = executeCalendarOperation(document, {
    operation: "holiday.add",
    payload: { date: "2026-08-08", type: "manual-closure", name: "Cierre local", reason: "Inventario" }
  }, { now: NOW, idFactory: idFactory() });
  assert.throws(
    () => executeCalendarOperation(holiday.document, {
      operation: "holiday.add",
      payload: { date: "2026-08-08", type: "allow-scheduling", name: "Abrir", reason: "Operación" }
    }, { now: NOW, idFactory: idFactory() }),
    (error) => error.code === "CONFLICT"
  );
  const removed = executeCalendarOperation(holiday.document, {
    operation: "holiday.delete",
    payload: { overrideId: holiday.result.overrideId }
  }, { now: NOW });
  assert.equal(removed.document.holidayOverrides.length, 0);
});

test("eliminar, restaurar, combinar y exportar preservan sus políticas", () => {
  const created = createOne(documentFixture()).document;
  const deleted = executeCalendarOperation(created, {
    operation: "activity.delete",
    payload: { activityIds: [created.activities[0].id] }
  }, { now: NOW });
  assert.equal(deleted.document.activities.length, 0);

  const incoming = documentFixture();
  incoming.calendarMeta.revision = 9;
  const restored = executeCalendarOperation(deleted.document, {
    operation: "backup.restore",
    payload: { document: incoming }
  }, { now: NOW });
  assert.equal(restored.document.calendarMeta.revision, 9);
  assert.equal(restored.document.audit.at(-1).action, "backup_restored");

  const remote = documentFixture();
  remote.catalog.clients[0].name = "Cliente actualizado";
  remote.catalog.clients[0].updatedAt = "2026-08-04T00:00:00.000Z";
  const merged = executeCalendarOperation(restored.document, {
    operation: "backup.merge",
    payload: { document: remote }
  }, { now: NOW });
  assert.equal(merged.result.counts.updated, 1);

  const csv = executeCalendarOperation(created, {
    operation: "calendar.export-csv",
    payload: { year: 2026, month: 8 }
  });
  assert.equal(csv.changed, false);
  assert.match(csv.result.content, /Cliente Uno/);
});
