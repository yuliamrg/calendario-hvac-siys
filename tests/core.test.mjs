import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVITY_STATUSES,
  APP_VERSION,
  SCHEMA_VERSION,
  activityMatchesFilters,
  addDaysISO,
  applyBulkEdit,
  applyStatus,
  buildMonthlyCsv,
  colombianHolidays,
  createActivitiesFromRange,
  createBackupEnvelope,
  createDefaultDocument,
  deleteActivities,
  duplicateActivities,
  easterSunday,
  extendActivity,
  generateSeriesDates,
  holidayMapForYears,
  holidayMapForRange,
  isNonWorkingDate,
  mondayOnOrAfter,
  monthGridDates,
  mergeBackupDocument,
  moveActivities,
  normalizeFilterArray,
  parseBackup,
  sanitizeDocument,
  startOfMondayWeek
} from "../src/core.js";

test("el calendario mensual siempre inicia lunes y contiene 42 días", () => {
  const grid = monthGridDates(2026, 7);
  assert.equal(grid.length, 42);
  assert.equal(grid[0], "2026-06-29");
  assert.equal(grid.at(-1), "2026-08-09");
  assert.equal(startOfMondayWeek("2026-08-01"), "2026-07-27");
});

test("el cálculo gregoriano de Pascua cubre años normales y bisiestos", () => {
  assert.equal(easterSunday(2025), "2025-04-20");
  assert.equal(easterSunday(2026), "2026-04-05");
  assert.equal(easterSunday(2027), "2027-03-28");
  assert.equal(easterSunday(2028), "2028-04-16");
});

test("los festivos colombianos incluyen traslados, Semana Santa y la Ley 2578 desde 2026", () => {
  const holidays2025 = new Map(colombianHolidays(2025).map((item) => [item.date, item]));
  const holidays2026 = new Map(colombianHolidays(2026).map((item) => [item.date, item]));
  assert.equal(holidays2025.get("2025-01-06")?.name, "Día de los Reyes Magos");
  assert.equal(holidays2025.get("2025-04-17")?.name, "Jueves Santo");
  assert.equal(holidays2025.has("2025-07-14"), false);
  assert.match(holidays2026.get("2026-07-13")?.name ?? "", /Chiquinquirá/);
  assert.equal(holidays2026.get("2026-07-13")?.movedFrom, "2026-07-09");
  assert.equal(mondayOnOrAfter("2026-07-09"), "2026-07-13");
});

test("los festivos nacionales 2025 a 2028 coinciden exactamente por fecha y ocurrencia", () => {
  const expected = {
    2025: [
      "2025-01-01", "2025-01-06", "2025-03-24", "2025-04-17", "2025-04-18",
      "2025-05-01", "2025-06-02", "2025-06-23", "2025-06-30", "2025-07-20",
      "2025-08-07", "2025-08-18", "2025-10-13", "2025-11-03", "2025-11-17",
      "2025-12-08", "2025-12-25"
    ],
    2026: [
      "2026-01-01", "2026-01-12", "2026-03-23", "2026-04-02", "2026-04-03",
      "2026-05-01", "2026-05-18", "2026-06-08", "2026-06-15", "2026-06-29",
      "2026-07-13", "2026-07-20", "2026-08-07", "2026-08-17", "2026-10-12",
      "2026-11-02", "2026-11-16", "2026-12-08", "2026-12-25"
    ],
    2027: [
      "2027-01-01", "2027-01-11", "2027-03-22", "2027-03-25", "2027-03-26",
      "2027-05-01", "2027-05-10", "2027-05-31", "2027-06-07", "2027-07-05",
      "2027-07-12", "2027-07-20", "2027-08-07", "2027-08-16", "2027-10-18",
      "2027-11-01", "2027-11-15", "2027-12-08", "2027-12-25"
    ],
    2028: [
      "2028-01-01", "2028-01-10", "2028-03-20", "2028-04-13", "2028-04-14",
      "2028-05-01", "2028-05-29", "2028-06-19", "2028-06-26", "2028-07-03",
      "2028-07-10", "2028-07-20", "2028-08-07", "2028-08-21", "2028-10-16",
      "2028-11-06", "2028-11-13", "2028-12-08", "2028-12-25"
    ]
  };
  const expectedOccurrences = { 2025: 18, 2026: 19, 2027: 19, 2028: 19 };

  for (const year of [2025, 2026, 2027, 2028]) {
    const holidays = colombianHolidays(year);
    assert.deepEqual(holidays.map((holiday) => holiday.date), expected[year]);
    assert.equal(
      holidays.reduce((total, holiday) => total + holiday.occurrences.length, 0),
      expectedOccurrences[year]
    );
  }
});

test("Chiquinquirá sólo rige desde 2026 y conserva fecha nominal y traslado Emiliani", () => {
  assert.equal(
    colombianHolidays(2025).some((holiday) =>
      holiday.occurrences.some((occurrence) => occurrence.ruleId === "chiquinquira")),
    false
  );
  const expectedObservedDates = {
    2026: "2026-07-13",
    2027: "2027-07-12",
    2028: "2028-07-10"
  };
  for (const [year, observedDate] of Object.entries(expectedObservedDates)) {
    const holiday = colombianHolidays(Number(year)).find((item) =>
      item.occurrences.some((occurrence) => occurrence.ruleId === "chiquinquira"));
    const occurrence = holiday.occurrences.find((item) => item.ruleId === "chiquinquira");
    assert.equal(holiday.date, observedDate);
    assert.equal(occurrence.nominalDate, `${year}-07-09`);
    assert.equal(occurrence.shiftPolicy, "next-or-same-monday");
    assert.equal(occurrence.sourceId, "Ley 2578 de 2026");
  }
});

test("los ajustes manuales pueden agregar o retirar un festivo", () => {
  const holidays = new Map(colombianHolidays(2026, [
    { id: "o1", date: "2026-07-20", action: "remove", name: "Operación autorizada", reason: "Prueba" },
    { id: "o2", date: "2026-07-21", action: "add", name: "Cierre operativo", reason: "Prueba" }
  ]).map((item) => [item.date, item]));
  assert.equal(holidays.get("2026-07-20")?.allowScheduling, true);
  assert.equal(holidays.get("2026-07-21")?.kind, "manual");
  assert.equal(isNonWorkingDate("2026-07-20", holidays), false);
});

test("las colisiones legales conservan todas las ocurrencias", () => {
  const holidays = new Map(colombianHolidays(2025).map((item) => [item.date, item]));
  assert.equal(holidays.get("2025-06-30")?.occurrences.length, 2);
  assert.match(holidays.get("2025-06-30")?.name ?? "", /Sagrado Corazón/);
  assert.match(holidays.get("2025-06-30")?.name ?? "", /San Pedro/);
});

test("los rangos excluyen domingos y festivos por defecto pero conservan sábados", () => {
  const holidayMap = holidayMapForYears([2026]);
  const range = generateSeriesDates("2026-07-18", "2026-07-21", holidayMap, false);
  assert.deepEqual(range.included, ["2026-07-18", "2026-07-21"]);
  assert.deepEqual(range.omitted.map((item) => item.date), ["2026-07-19", "2026-07-20"]);
});

test("un rango permite incluir sólo una fecha no laborable específica", () => {
  const holidayMap = holidayMapForYears([2026]);
  const range = generateSeriesDates("2026-07-09", "2026-07-14", holidayMap, {
    forceIncludeDates: ["2026-07-13"]
  });
  assert.deepEqual(range.included, [
    "2026-07-09", "2026-07-10", "2026-07-11", "2026-07-13", "2026-07-14"
  ]);
  assert.deepEqual(range.omitted.map((item) => item.date), ["2026-07-12"]);
  assert.equal(range.omitted[0].reasons[0].type, "sunday");
});

test("un rango entre años calcula los festivos de ambos años", () => {
  const map = holidayMapForRange("2026-12-24", "2027-01-02");
  const range = generateSeriesDates("2026-12-24", "2027-01-02", map);
  assert.equal(range.included.includes("2026-12-25"), false);
  assert.equal(range.included.includes("2027-01-01"), false);
  assert.equal(range.included.includes("2026-12-27"), false);
});

test("una actividad multidía genera tarjetas independientes enlazadas", () => {
  let counter = 0;
  const idFactory = () => String(++counter).padStart(4, "0");
  const result = createActivitiesFromRange({
    date: "2026-07-18",
    endDate: "2026-07-21",
    includeNonWorking: false,
    clientId: "cliente_1",
    siteId: "sede_1",
    city: "Pereira",
    responsibleIds: ["responsable_1"],
    serviceType: "preventive",
    status: "confirmed",
    observations: ""
  }, holidayMapForYears([2026]), { idFactory, now: "2026-07-01T12:00:00.000Z" });
  assert.equal(result.activities.length, 2);
  assert.equal(result.omitted.length, 2);
  assert.ok(result.series);
  assert.equal(new Set(result.activities.map((item) => item.seriesId)).size, 1);
  assert.notEqual(result.activities[0].id, result.activities[1].id);
});

test("el cambio de estado puede aplicarse a un día, futuro o serie completa", () => {
  const doc = createDefaultDocument("2026-07-01");
  doc.activities = ["01", "02", "03"].map((day, index) => ({
    id: `a${index + 1}`,
    seriesId: "s1",
    date: `2026-07-${day}`,
    clientId: "c1",
    siteId: "s1",
    city: "Pereira",
    responsibleIds: [],
    serviceType: "preventive",
    status: "scheduled",
    observations: "",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    completedAt: null,
    history: []
  }));
  const changed = applyStatus(doc, "a2", "completed", "future", "2026-07-02T00:00:00.000Z");
  assert.deepEqual(changed.sort(), ["a2", "a3"]);
  assert.equal(doc.activities[0].status, "scheduled");
  assert.equal(doc.activities[1].status, "completed");
  assert.ok(doc.activities[2].completedAt);
});

test("confirmar sin responsables falla de forma atómica", () => {
  const doc = createDefaultDocument("2026-07-01");
  doc.activities = [
    {
      id: "a1", seriesId: "s1", date: "2026-07-01", responsibleIds: ["r1"],
      status: "scheduled", history: []
    },
    {
      id: "a2", seriesId: "s1", date: "2026-07-02", responsibleIds: [],
      status: "scheduled", history: []
    }
  ];
  assert.throws(() => applyStatus(doc, "a1", "confirmed", "series"), /sin responsables/);
  assert.deepEqual(doc.activities.map((item) => item.status), ["scheduled", "scheduled"]);
});

test("mover varias tarjetas conserva el espaciado relativo o las reúne", () => {
  const doc = createDefaultDocument("2026-07-01");
  doc.activities = [
    { id: "a1", date: "2026-07-01", history: [] },
    { id: "a2", date: "2026-07-03", history: [] }
  ];
  moveActivities(doc, ["a1", "a2"], "2026-07-10", { anchorId: "a1", mode: "preserve" });
  assert.deepEqual(doc.activities.map((item) => item.date), ["2026-07-10", "2026-07-12"]);
  moveActivities(doc, ["a1", "a2"], "2026-07-15", { anchorId: "a1", mode: "same" });
  assert.deepEqual(doc.activities.map((item) => item.date), ["2026-07-15", "2026-07-15"]);
});

test("mover a la misma fecha es una operación nula sin historial", () => {
  const doc = createDefaultDocument("2026-07-01");
  doc.activities = [{ id: "a1", date: "2026-07-01", updatedAt: "antes", history: [] }];
  const result = moveActivities(doc, ["a1"], "2026-07-01", { anchorId: "a1", mode: "preserve" });
  assert.deepEqual(result, []);
  assert.equal(doc.activities[0].updatedAt, "antes");
  assert.deepEqual(doc.activities[0].history, []);
});

test("duplicar crea tarjetas independientes programadas y conserva distancias", () => {
  const doc = createDefaultDocument("2026-07-01");
  doc.activities = [
    {
      id: "a1", seriesId: "serie-original", date: "2026-07-01", responsibleIds: [],
      serviceType: "administrative", status: "completed", observations: "Uno",
      completedAt: "2026-07-01T12:00:00.000Z", history: []
    },
    {
      id: "a2", seriesId: "serie-original", date: "2026-07-03", responsibleIds: [],
      serviceType: "administrative", status: "scheduled", observations: "Dos", history: []
    }
  ];
  let sequence = 0;
  const copies = duplicateActivities(doc, ["a1", "a2"], "2026-07-10", {
    anchorId: "a1",
    idFactory: () => `copy-${++sequence}`,
    now: "2026-07-05T00:00:00.000Z"
  });
  assert.deepEqual(copies.map((item) => item.date), ["2026-07-10", "2026-07-12"]);
  assert.ok(copies.every((item) => item.seriesId === null && item.status === "scheduled"));
  assert.ok(copies.every((item) => item.completedAt === null));
  assert.equal(new Set(doc.activities.map((item) => item.id)).size, 4);
});

test("ampliar enlaza días mediante seriesId con IDs independientes", () => {
  const doc = createDefaultDocument("2026-07-01");
  doc.activities = [{
    id: "a1", seriesId: null, date: "2026-07-01", responsibleIds: [],
    serviceType: "administrative", status: "completed", observations: "Visita",
    completedAt: "2026-07-01T12:00:00.000Z", history: []
  }];
  let sequence = 0;
  const extended = extendActivity(doc, "a1", "2026-07-02", {
    idFactory: () => `new-${++sequence}`,
    now: "2026-07-01T13:00:00.000Z"
  });
  assert.notEqual(extended.id, "a1");
  assert.equal(extended.seriesId, doc.activities[0].seriesId);
  assert.equal(extended.status, "scheduled");
  assert.equal(extended.completedAt, null);
  assert.equal(doc.series.length, 1);
  assert.throws(() => extendActivity(doc, "a1", "2026-07-02"), /ya tiene una tarjeta/);
});

test("el respaldo saneado elimina campos no autorizados y valida confirmados", () => {
  const doc = createDefaultDocument("2026-07-01");
  doc.catalog.responsibles.push({
    id: "r1",
    sourceKey: "r1",
    name: "Técnico Uno",
    responsibleType: "payroll",
    phone: "NO DEBE QUEDAR"
  });
  const clean = sanitizeDocument(doc);
  assert.equal("phone" in clean.catalog.responsibles[0], false);
});

test("el respaldo sanea profundamente aliases, cobertura y pistas de sede", () => {
  const doc = createDefaultDocument("2026-07-01");
  doc.catalog.clients.push({
    id: "c1",
    name: "Cliente",
    aliases: ["  Alias uno  ", "", "Alias uno", { cedula_nit: "sensible" }, 99]
  });
  doc.catalog.sites.push({
    id: "s1",
    clientId: "c1",
    name: "Sede",
    aliases: [" Centro ", { contacto: "sensible" }],
    coverageHints: [
      {
        source: " dm_equipo_cronograma ",
        sourceKey: "equipo-1",
        subsidiaryId: " sub-1 ",
        subsidiaryName: " Sede ",
        equipmentCount: 3,
        responsibleGroups: [" Grupo A ", "Grupo A", { correo: "sensible" }],
        frequencies: [" Trimestral ", null],
        scheduledMonths: ["ene", "feb", { arbitrary: true }],
        candidateSiteSourceKeys: ["no debe sobrevivir"],
        match: "exact",
        cedula_nit: "sensible",
        nested: { arbitrary: true }
      },
      { nested: { arbitrary: true } }
    ]
  });
  doc.catalog.responsibles.push({
    id: "r1",
    name: "Responsable",
    aliases: [" Técnico ", { phone: "sensible" }],
    coverage: [" Pereira ", "Pereira", { email: "sensible" }]
  });

  const clean = sanitizeDocument(doc);
  assert.deepEqual(clean.catalog.clients[0].aliases, ["Alias uno"]);
  assert.deepEqual(clean.catalog.sites[0].aliases, ["Centro"]);
  assert.deepEqual(clean.catalog.responsibles[0].aliases, ["Técnico"]);
  assert.deepEqual(clean.catalog.responsibles[0].coverage, ["Pereira"]);
  assert.deepEqual(clean.catalog.sites[0].coverageHints, [{
    source: "dm_equipo_cronograma",
    sourceKey: "equipo-1",
    subsidiaryId: "sub-1",
    subsidiaryName: "Sede",
    equipmentCount: 3,
    responsibleGroups: ["Grupo A"],
    frequencies: ["Trimestral"],
    scheduledMonths: ["ene", "feb"]
  }]);
  assert.equal(JSON.stringify(clean).includes("sensible"), false);
  assert.equal(JSON.stringify(clean).includes("arbitrary"), false);
  assert.equal(JSON.stringify(clean).includes("candidateSiteSourceKeys"), false);
});

test("los metadatos de importación conservan sólo advertencias y conteos seguros", () => {
  const doc = createDefaultDocument("2026-07-01");
  doc.importMetadata = {
    fileName: " Base_operativa.xlsx ",
    fileSize: 12345,
    lastModified: "2026-07-30T00:00:00.000Z",
    importedAt: "2026-07-30T12:00:00.000Z",
    sha256: "a".repeat(64),
    arbitrary: { contacto: "sensible" },
    sheetCounts: {
      dm_ciudad: {
        sourceRows: 8,
        imported: 8,
        skipped: 0,
        hints: -1,
        floating: 1.5,
        textCount: "8",
        nested: { cedula_nit: "sensible" }
      },
      dm_sede: { sourceRows: Number.MAX_SAFE_INTEGER, imported: Infinity },
      hoja_inventada: { sourceRows: 999, arbitrary: true }
    },
    warnings: [
      {
        code: " warning_code ",
        message: " Mensaje ",
        sheet: " dm_sede ",
        row: 12,
        correo: "sensible",
        nested: { arbitrary: true }
      },
      { code: "sin_fila", message: "Fila inválida", row: -1 },
      { arbitrary: true }
    ]
  };

  const clean = sanitizeDocument(doc).importMetadata;
  assert.deepEqual(clean, {
    fileName: "Base_operativa.xlsx",
    fileSize: 12345,
    lastModified: "2026-07-30T00:00:00.000Z",
    sha256: "A".repeat(64),
    importedAt: "2026-07-30T12:00:00.000Z",
    sheetCounts: {
      dm_ciudad: { sourceRows: 8, imported: 8, skipped: 0 },
      dm_sede: { sourceRows: Number.MAX_SAFE_INTEGER }
    },
    warnings: [
      { code: "warning_code", message: "Mensaje", sheet: "dm_sede", row: 12 },
      { code: "sin_fila", message: "Fila inválida" }
    ]
  });
  assert.equal(JSON.stringify(clean).includes("sensible"), false);
  assert.equal(JSON.stringify(clean).includes("arbitrary"), false);
  assert.equal(JSON.stringify(clean).includes("hoja_inventada"), false);
});

test("el CSV mensual separa nómina y contratistas", () => {
  const doc = createDefaultDocument("2026-07-01");
  doc.catalog.clients.push({ id: "c1", name: "Cliente" });
  doc.catalog.sites.push({ id: "s1", name: "Sede", city: "Pereira" });
  doc.catalog.responsibles.push(
    { id: "r1", name: "Nómina Uno", responsibleType: "payroll" },
    { id: "r2", name: "Contratista Uno", responsibleType: "contractor" }
  );
  doc.activities.push({
    id: "a1",
    seriesId: null,
    date: "2026-07-30",
    clientId: "c1",
    siteId: "s1",
    city: "Pereira",
    responsibleIds: ["r1", "r2"],
    serviceType: "emergency",
    status: "in_progress",
    observations: "Prueba",
    history: []
  });
  const csv = buildMonthlyCsv(doc, 2026, 7);
  assert.match(csv, /Nómina Uno/);
  assert.match(csv, /Contratista Uno/);
  assert.match(csv, new RegExp(ACTIVITY_STATUSES.in_progress));
  assert.equal(buildMonthlyCsv(doc, 2026, 8).split("\r\n").length, 1);
});

test("un documento heredado migra al esquema vigente sin perder actividades", () => {
  const legacy = createDefaultDocument("2026-07-01", "2026-07-01T00:00:00.000Z");
  delete legacy.calendarMeta;
  legacy.schemaVersion = 1;
  legacy.appVersion = "1.0.0";
  legacy.activities.push({
    id: "a1",
    seriesId: null,
    date: "2026-07-30",
    clientId: null,
    siteId: null,
    city: null,
    responsibleIds: [],
    serviceType: "administrative",
    status: "scheduled",
    observations: "Dato heredado",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    completedAt: null,
    history: []
  });
  const migrated = sanitizeDocument(legacy, "2026-07-30");
  assert.equal(migrated.schemaVersion, SCHEMA_VERSION);
  assert.equal(migrated.calendarMeta.name, "Cronograma HVAC");
  assert.equal(migrated.calendarMeta.revision, 0);
  assert.equal(migrated.activities[0].observations, "Dato heredado");
});

test("el respaldo versionado conserva metadatos y admite el formato heredado", () => {
  const doc = createDefaultDocument("2026-07-30", "2026-07-30T10:00:00.000Z");
  doc.calendarMeta.name = "Cronograma Eje Cafetero";
  doc.calendarMeta.coordinator = "Coordinación Uno";
  doc.calendarMeta.revision = 7;
  const envelope = createBackupEnvelope(doc, {
    exportedAt: "2026-07-30T12:00:00.000Z",
    origin: "archivo local",
    channel: "beta"
  });
  assert.equal(envelope.appVersion, APP_VERSION);
  assert.equal(envelope.revision, 7);
  assert.equal(envelope.document.calendarMeta.name, "Cronograma Eje Cafetero");
  assert.equal(envelope.channel, "beta");
  const parsed = parseBackup(envelope);
  assert.equal(parsed.envelope, true);
  assert.equal(parsed.document.calendarMeta.coordinator, "Coordinación Uno");
  assert.equal(parsed.channel, "beta");
  const legacy = parseBackup(doc);
  assert.equal(legacy.envelope, false);
  assert.equal(legacy.document.calendarMeta.revision, 7);
});

test("el esquema 2 migra registros maestros con updatedAt de respaldo", () => {
  const legacy = createDefaultDocument("2026-07-01", "2026-07-01T00:00:00.000Z");
  legacy.schemaVersion = 2;
  legacy.calendarMeta.updatedAt = "2026-07-02T03:00:00.000Z";
  legacy.catalog.clients.push({ id: "c1", name: "Cliente heredado" });
  legacy.series.push({
    id: "serie1",
    createdAt: "2026-07-01T00:00:00.000Z",
    originalStart: "2026-07-01",
    originalEnd: "2026-07-02"
  });
  const migrated = sanitizeDocument(legacy);
  assert.equal(migrated.schemaVersion, 4);
  assert.equal(migrated.catalog.clients[0].updatedAt, legacy.calendarMeta.updatedAt);
  assert.equal(migrated.series[0].updatedAt, legacy.calendarMeta.updatedAt);
});

test("añadir JSON remapea referencias y gana el registro más reciente", () => {
  const current = createDefaultDocument("2026-07-01", "2026-07-01T00:00:00.000Z");
  current.catalog.clients.push({
    id: "cliente_local",
    sourceKey: "cliente:uno",
    name: "Cliente Uno",
    active: true,
    updatedAt: "2026-07-01T00:00:00.000Z"
  });
  current.catalog.sites.push({
    id: "sede_local",
    sourceKey: "sede:uno",
    clientId: "cliente_local",
    name: "Sede Principal",
    city: "Pereira",
    active: true,
    updatedAt: "2026-07-01T00:00:00.000Z"
  });
  const incoming = createDefaultDocument("2026-08-01", "2026-08-01T00:00:00.000Z");
  incoming.calendarMeta.name = "No debe reemplazar el cronograma actual";
  incoming.catalog.clients.push({
    id: "cliente_remoto",
    sourceKey: "cliente:uno",
    name: "Cliente Uno actualizado",
    active: true,
    updatedAt: "2026-08-01T00:00:00.000Z"
  });
  incoming.catalog.sites.push({
    id: "sede_remota",
    sourceKey: "sede:uno",
    clientId: "cliente_remoto",
    name: "Sede Principal",
    city: "Pereira",
    active: true,
    updatedAt: "2026-08-01T00:00:00.000Z"
  });
  incoming.activities.push({
    id: "actividad_remota",
    seriesId: null,
    date: "2026-08-05",
    clientId: "cliente_remoto",
    siteId: "sede_remota",
    city: "Pereira",
    responsibleIds: [],
    serviceType: "preventive",
    status: "scheduled",
    observations: "Importada",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    completedAt: null,
    history: []
  });
  const result = mergeBackupDocument(current, incoming);
  assert.equal(result.document.calendarMeta.name, current.calendarMeta.name);
  assert.equal(result.document.catalog.clients.length, 1);
  assert.equal(result.document.catalog.clients[0].id, "cliente_local");
  assert.equal(result.document.catalog.clients[0].name, "Cliente Uno actualizado");
  assert.equal(result.document.activities[0].clientId, "cliente_local");
  assert.equal(result.document.activities[0].siteId, "sede_local");
  assert.equal(result.counts.updated, 1);
  assert.equal(result.counts.skipped, 1);
  assert.equal(result.counts.added, 1);
});

test("añadir JSON no elimina ausentes y conserva el actual en empate o si es más nuevo", () => {
  const current = createDefaultDocument("2026-07-01", "2026-07-01T00:00:00.000Z");
  current.catalog.clients.push(
    { id: "c1", name: "Conservar", active: true, updatedAt: "2026-08-02T00:00:00.000Z" },
    { id: "c2", name: "Ausente", active: true, updatedAt: "2026-08-02T00:00:00.000Z" }
  );
  const incoming = createDefaultDocument("2026-07-01", "2026-07-01T00:00:00.000Z");
  incoming.catalog.clients.push({
    id: "c1",
    name: "Intento antiguo",
    active: true,
    updatedAt: "2026-08-01T00:00:00.000Z"
  });
  const result = mergeBackupDocument(current, incoming);
  assert.equal(result.document.catalog.clients.length, 2);
  assert.equal(result.document.catalog.clients.find((item) => item.id === "c1").name, "Conservar");
  assert.equal(result.counts.conflicts, 1);
});

test("la edición múltiple aplica modos operativos y deja historial", () => {
  const doc = createDefaultDocument("2026-07-30");
  doc.activities = ["a1", "a2"].map((id) => ({
    id,
    seriesId: null,
    date: "2026-07-30",
    clientId: "c1",
    siteId: "s1",
    city: "Pereira",
    responsibleIds: ["r1"],
    serviceType: "preventive",
    status: "scheduled",
    observations: "Inicial",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    completedAt: null,
    history: []
  }));
  applyBulkEdit(doc, ["a1", "a2"], "responsibleIds", ["r2"], {
    mode: "add",
    now: "2026-07-30T12:00:00.000Z"
  });
  applyBulkEdit(doc, ["a1", "a2"], "observations", "Segunda nota", {
    mode: "append",
    now: "2026-07-30T12:01:00.000Z"
  });
  assert.deepEqual(doc.activities[0].responsibleIds, ["r1", "r2"]);
  assert.equal(doc.activities[1].observations, "Inicial\nSegunda nota");
  assert.equal(doc.activities[0].history.at(-1).action, "bulk_edited");
});

test("la edición múltiple revierte todo si una tarjeta queda inválida", () => {
  const doc = createDefaultDocument("2026-07-30");
  doc.activities = [
    {
      id: "a1", date: "2026-07-30", clientId: "c1", siteId: "s1", city: "Pereira",
      responsibleIds: ["r1"], serviceType: "preventive", status: "confirmed",
      observations: "", history: []
    },
    {
      id: "a2", date: "2026-07-31", clientId: "c1", siteId: "s1", city: "Pereira",
      responsibleIds: ["r1", "r2"], serviceType: "preventive", status: "confirmed",
      observations: "", history: []
    }
  ];
  const before = structuredClone(doc.activities);
  assert.throws(
    () => applyBulkEdit(doc, ["a1", "a2"], "responsibleIds", ["r1", "r2"], { mode: "remove" }),
    /responsable/
  );
  assert.deepEqual(doc.activities, before);
});

test("la eliminación múltiple exige IDs existentes y devuelve lo eliminado", () => {
  const doc = createDefaultDocument("2026-07-30");
  doc.activities = [{ id: "a1" }, { id: "a2" }, { id: "a3" }];
  const removed = deleteActivities(doc, ["a1", "a3"]);
  assert.deepEqual(removed.map((item) => item.id), ["a1", "a3"]);
  assert.deepEqual(doc.activities.map((item) => item.id), ["a2"]);
  assert.throws(() => deleteActivities(doc, ["missing"]), /no existen/);
});

test("los filtros permiten OR dentro de una categoría y AND entre categorías", () => {
  const maps = {
    clients: new Map([["c1", { name: "Cliente Uno" }], ["c2", { name: "Cliente Dos" }]]),
    sites: new Map([["s1", { name: "Sede Centro" }], ["s2", { name: "Sede Norte" }]]),
    responsibles: new Map([["r1", { name: "Ana" }], ["r2", { name: "Carlos" }]])
  };
  const activities = [
    { clientId: "c1", siteId: "s1", city: "Pereira", responsibleIds: ["r1"], serviceType: "preventive", status: "scheduled", observations: "" },
    { clientId: "c2", siteId: "s2", city: "Armenia", responsibleIds: ["r2"], serviceType: "corrective", status: "completed", observations: "" }
  ];
  const filters = {
    query: "",
    cities: ["Pereira", "Armenia"],
    clients: ["c1"],
    sites: [],
    responsibles: [],
    serviceTypes: ["preventive", "emergency"],
    statuses: []
  };
  assert.equal(activityMatchesFilters(activities[0], filters, maps), true);
  assert.equal(activityMatchesFilters(activities[1], filters, maps), false);
  filters.query = "ana";
  assert.equal(activityMatchesFilters(activities[0], filters, maps), true);
  filters.query = "norte";
  assert.equal(activityMatchesFilters(activities[0], filters, maps), false);
});

test("la migración transforma filtros simples heredados en selecciones múltiples", () => {
  assert.deepEqual(normalizeFilterArray(undefined, "completed"), ["completed"]);
  assert.deepEqual(normalizeFilterArray(undefined, "all"), []);
  const legacy = createDefaultDocument("2026-07-30");
  legacy.settings.filters = {
    query: "",
    status: "completed",
    serviceType: "preventive",
    responsible: "r1"
  };
  const migrated = sanitizeDocument(legacy);
  assert.deepEqual(migrated.settings.filters.statuses, ["completed"]);
  assert.deepEqual(migrated.settings.filters.serviceTypes, ["preventive"]);
  assert.deepEqual(migrated.settings.filters.responsibles, ["r1"]);
});
