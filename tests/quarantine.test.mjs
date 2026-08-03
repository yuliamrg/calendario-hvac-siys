import test from "node:test";
import assert from "node:assert/strict";

import {
  ACTIVITY_STATUSES,
  PLANNING_BUCKETS,
  SCHEMA_VERSION,
  SERVICE_TYPES,
  addDaysISO,
  assignQuarantineDate,
  buildMonthlyCsv,
  buildQuarantineCsv,
  colombianHolidays,
  createActivitiesFromRange,
  createBackupEnvelope,
  createDefaultDocument,
  createQuarantineActivity,
  mergeBackupDocument,
  moveActivityToQuarantine,
  parseBackup,
  sanitizeDocument,
  validateActivity,
  validatePlanningDate
} from "../src/core.js";
import {
  applyProgrammingImport,
  parseProgrammingWorkbook
} from "../src/importer.js";

function makeSheet(rows) {
  const sheet = { __rows: rows };
  return sheet;
}

function workbook(rows) {
  return {
    SheetNames: ["Programacion"],
    Sheets: { Programacion: makeSheet(rows) }
  };
}

function operationalDocument() {
  const document = createDefaultDocument("2026-07-01", "2026-07-01T00:00:00.000Z");
  document.catalog.clients.push({ id: "c1", name: "Cliente Uno", active: true });
  document.catalog.sites.push({ id: "s1", clientId: "c1", name: "Sede Centro", city: "Pereira", active: true });
  document.catalog.responsibles.push({ id: "r1", name: "Ana Técnica", responsibleType: "payroll", active: true });
  return document;
}

function makeRange(document, idFactory = (() => "id")) {
  const generated = createActivitiesFromRange(
    {
      date: "2026-07-01",
      endDate: "2026-07-03",
      clientId: "c1",
      siteId: "s1",
      city: "Pereira",
      responsibleIds: ["r1"],
      serviceType: "diagnostic",
      status: "scheduled",
      observations: "Rango"
    },
    new Map(),
    { idFactory, now: "2026-07-01T01:00:00.000Z" }
  );
  document.activities.push(...generated.activities);
  document.series.push(generated.series);
  return generated.activities;
}

test("el esquema 4 agrega bandeja Pendiente, Diagnóstico, Garantía y Por programar", () => {
  const document = createDefaultDocument("2026-07-01");
  assert.equal(SCHEMA_VERSION, 4);
  assert.equal(document.schemaVersion, 4);
  assert.equal(SERVICE_TYPES.diagnostic, "Diagnóstico");
  assert.equal(SERVICE_TYPES.warranty, "Garantía");
  assert.equal(ACTIVITY_STATUSES.to_schedule, "Por programar");
  assert.deepEqual(PLANNING_BUCKETS, { calendar: "Calendario", quarantine: "Pendiente" });
});

test("crear cuarentena fuerza fecha nula, serie nula y Por programar", () => {
  const activity = createQuarantineActivity({
    clientId: "c1",
    siteId: "s1",
    city: "Pereira",
    responsibleIds: ["r1"],
    serviceType: "warranty",
    status: "confirmed",
    observations: "Pendiente de repuesto"
  }, { idFactory: () => "q1", now: "2026-07-01T01:00:00.000Z" });
  assert.deepEqual(
    {
      date: activity.date,
      planningBucket: activity.planningBucket,
      status: activity.status,
      seriesId: activity.seriesId
    },
    { date: null, planningBucket: "quarantine", status: "to_schedule", seriesId: null }
  );
  assert.deepEqual(validateActivity({ ...activity, date: "2026-07-01" }).some((error) => /Por programar|sin fecha/i.test(error)), true);
  assert.deepEqual(validateActivity({ ...activity, planningBucket: "calendar", date: null }).length > 0, true);
});

test("mover una fecha a cuarentena independiza la tarjeta y convertir toda la serie elimina las demás", () => {
  const document = operationalDocument();
  const activities = makeRange(document, (() => {
    let index = 0;
    return () => `a${++index}`;
  })());
  const moved = moveActivityToQuarantine(document, activities[1].id, "single", "2026-07-02T02:00:00.000Z");
  assert.equal(moved.activity.id, activities[1].id);
  assert.equal(moved.activity.date, null);
  assert.equal(moved.activity.planningBucket, "quarantine");
  assert.equal(document.activities.find((item) => item.id === activities[0].id).seriesId, activities[0].seriesId);
  assert.equal(document.activities.find((item) => item.id === activities[2].id).seriesId, activities[2].seriesId);

  const whole = moveActivityToQuarantine(document, activities[0].id, "series", "2026-07-02T03:00:00.000Z");
  assert.equal(whole.activity.id, activities[0].id);
  assert.equal(document.activities.length, 2);
  assert.equal(document.activities.find((item) => item.id === activities[0].id).date, null);
  assert.equal(document.activities.find((item) => item.id === activities[0].id).seriesId, null);
  assert.equal(document.series.length, 0);
  assert.equal(document.activities[0].history.at(-1).scope, "series");
});

test("cuarentena bloquea estados finales y asignar fecha vuelve a Programada", () => {
  const document = operationalDocument();
  const activity = createQuarantineActivity({
    clientId: "c1", siteId: "s1", city: "Pereira", serviceType: "corrective"
  }, { idFactory: () => "q1" });
  document.activities.push(activity);
  const invalidStatuses = ["in_progress", "completed", "not_executed", "cancelled"];
  for (const status of invalidStatuses) {
    const candidate = {
      ...activity,
      date: "2026-07-02",
      planningBucket: "calendar",
      status,
      seriesId: null
    };
    document.activities[0] = candidate;
    assert.throws(
      () => moveActivityToQuarantine(document, candidate.id, "single"),
      /Por programar|sólo se permiten/i
    );
    assert.equal(validateActivity({ ...candidate, planningBucket: "quarantine", date: null }).length > 0, true);
  }
  document.activities[0] = activity;
  const holidays = new Map(colombianHolidays(2026).map((item) => [item.date, item]));
  assert.equal(validatePlanningDate("2026-07-05", holidays).valid, false);
  assert.throws(() => assignQuarantineDate(document, activity.id, "2026-07-05", holidays), /domingo|laborable/i);
  assignQuarantineDate(document, activity.id, "2026-07-06", holidays, { now: "2026-07-02T04:00:00.000Z" });
  assert.equal(activity.date, "2026-07-06");
  assert.equal(activity.planningBucket, "calendar");
  assert.equal(activity.status, "scheduled");
  assert.equal(activity.seriesId, null);
});

test("documentos antiguos migran las actividades al Calendario y los inválidos se rechazan", () => {
  const legacy = createDefaultDocument("2026-07-01");
  legacy.schemaVersion = 3;
  legacy.activities.push({
    id: "old1", seriesId: null, date: "2026-07-02", clientId: null, siteId: null, city: null,
    responsibleIds: [], serviceType: "administrative", status: "scheduled", observations: "", history: []
  });
  const migrated = sanitizeDocument(legacy);
  assert.equal(migrated.schemaVersion, 4);
  assert.equal(migrated.activities[0].planningBucket, "calendar");
  assert.equal(migrated.activities[0].date, "2026-07-02");
  assert.throws(() => sanitizeDocument({
    ...migrated,
    activities: [{ ...migrated.activities[0], planningBucket: "quarantine", date: "2026-07-02" }]
  }), /cuarentena|sin fecha/i);
});

test("respaldos y combinación conservan cuarentena, y el CSV mensual la excluye", () => {
  const current = operationalDocument();
  const quarantine = createQuarantineActivity({
    clientId: "c1", siteId: "s1", city: "Pereira", serviceType: "diagnostic"
  }, { idFactory: () => "q1" });
  current.activities.push(quarantine);
  const envelope = createBackupEnvelope(current);
  const parsed = parseBackup(envelope);
  assert.equal(parsed.document.activities[0].planningBucket, "quarantine");
  const merged = mergeBackupDocument(createDefaultDocument("2026-07-01"), envelope.document);
  assert.equal(merged.document.activities.length, 1);
  assert.equal(merged.document.activities[0].date, null);
  assert.match(buildQuarantineCsv(current), /Pendiente/);
  assert.doesNotMatch(buildMonthlyCsv(current, 2026, 7), /q1/);
});

test("Excel acepta Bandeja nueva y archivos antiguos, y valida sus combinaciones", () => {
  const document = operationalDocument();
  const newPreview = parseProgrammingWorkbook(workbook([
    ["FechaInicio", "FechaFin", "Bandeja", "Cliente", "Sede", "Ciudad", "Responsables", "TipoServicio", "Estado", "Observaciones", "IncluirNoLaborables"],
    ["", "", "Pendiente", "Cliente Uno", "Sede Centro", "Pereira", "", "Diagnóstico", "Por programar", "Sin fecha", "No"]
  ]), document);
  assert.equal(newPreview.counts.valid, 1);
  const imported = applyProgrammingImport(document, newPreview, { idFactory: () => "excel-q" });
  assert.equal(imported.activities[0].planningBucket, "quarantine");
  assert.equal(imported.activities[0].status, "to_schedule");
  assert.equal(imported.activities[0].date, null);

  const legacyBucketPreview = parseProgrammingWorkbook(workbook([
    ["FechaInicio", "FechaFin", "Bandeja", "Cliente", "Sede", "Ciudad", "Responsables", "TipoServicio", "Estado", "Observaciones", "IncluirNoLaborables"],
    ["", "", "Cuarentena", "Cliente Uno", "Sede Centro", "Pereira", "", "Diagnóstico", "Por programar", "Etiqueta anterior", "No"]
  ]), document);
  assert.equal(legacyBucketPreview.counts.valid, 1);
  assert.equal(legacyBucketPreview.rows[0].input.planningBucket, "quarantine");

  const oldPreview = parseProgrammingWorkbook(workbook([
    ["FechaInicio", "FechaFin", "Cliente", "Sede", "Ciudad", "Responsables", "TipoServicio", "Estado", "Observaciones", "IncluirNoLaborables"],
    ["2026-07-06", "2026-07-06", "Cliente Uno", "Sede Centro", "Pereira", "Ana Técnica", "Garantía", "Programada", "Archivo antiguo", "No"]
  ]), document);
  assert.equal(oldPreview.counts.valid, 1);
  assert.equal(oldPreview.rows[0].input.planningBucket, "calendar");

  const invalidPreview = parseProgrammingWorkbook(workbook([
    ["FechaInicio", "FechaFin", "Bandeja", "Cliente", "Sede", "Ciudad", "Responsables", "TipoServicio", "Estado", "Observaciones", "IncluirNoLaborables"],
    ["2026-07-06", "", "Cuarentena", "Cliente Uno", "Sede Centro", "Pereira", "", "Diagnóstico", "Programada", "Inválida", "No"]
  ]), document);
  assert.equal(invalidPreview.counts.errors, 1);
  assert.match(invalidPreview.rows[0].errors.join(" "), /Cuarentena|Pendiente|Por programar/);
});
