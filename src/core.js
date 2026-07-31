export const APP_VERSION = "0.2.0";
export const SCHEMA_VERSION = 2;
export const HOLIDAY_RULESET_VERSION = "CO-NATIONAL-2026-06-02";

export const SERVICE_TYPES = Object.freeze({
  preventive: "Mantenimiento preventivo",
  corrective: "Mantenimiento correctivo",
  emergency: "Llamada de emergencia",
  administrative: "Administrativo"
});

export const ACTIVITY_STATUSES = Object.freeze({
  scheduled: "Programada",
  confirmed: "Confirmada",
  in_progress: "En ejecución",
  completed: "Terminada",
  not_executed: "No ejecutada",
  cancelled: "Cancelada"
});

export const RESPONSIBLE_TYPES = Object.freeze({
  payroll: "Personal de nómina",
  contractor: "Contratista"
});

export const STATUS_SCOPES = Object.freeze({
  single: "Solo este día",
  future: "Este día y siguientes",
  series: "Toda la actividad"
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function normalizeKey(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function safeText(value, maxLength = 5000) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, maxLength);
}

export function parseISODate(value) {
  if (!DATE_RE.test(String(value))) {
    throw new TypeError(`Fecha inválida: ${value}`);
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new TypeError(`Fecha inexistente: ${value}`);
  }
  return date;
}

export function toISODate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function makeISODate(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new TypeError("La fecha debe contener números enteros.");
  }
  const value = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  parseISODate(value);
  return value;
}

export function addDaysISO(value, days) {
  const date = parseISODate(value);
  date.setUTCDate(date.getUTCDate() + Number(days));
  return toISODate(date);
}

export function differenceInDays(from, to) {
  return Math.round((parseISODate(to) - parseISODate(from)) / 86400000);
}

export function compareISODate(a, b) {
  return String(a).localeCompare(String(b));
}

export function dayOfWeek(value) {
  return parseISODate(value).getUTCDay();
}

export function mondayOnOrAfter(value) {
  const weekday = dayOfWeek(value);
  const delta = weekday === 1 ? 0 : (8 - weekday) % 7;
  return addDaysISO(value, delta);
}

export function startOfMondayWeek(value) {
  const weekday = dayOfWeek(value);
  const delta = weekday === 0 ? -6 : 1 - weekday;
  return addDaysISO(value, delta);
}

export function endOfMonthISO(year, month) {
  return toISODate(new Date(Date.UTC(year, month, 0)));
}

export function monthGridDates(year, month) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError("Mes o año inválido.");
  }
  const first = makeISODate(year, month, 1);
  const start = startOfMondayWeek(first);
  return Array.from({ length: 42 }, (_, index) => addDaysISO(start, index));
}

export function todayInBogota(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

export function easterSunday(year) {
  // Algoritmo gregoriano de Meeus/Jones/Butcher.
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return makeISODate(year, month, day);
}

function addHoliday(map, date, name, metadata = {}) {
  const occurrence = {
    ruleId: metadata.ruleId ?? normalizeKey(name),
    label: name,
    nominalDate: metadata.nominalDate ?? date,
    observedDate: date,
    shifted: (metadata.nominalDate ?? date) !== date,
    shiftPolicy: metadata.shiftPolicy ?? "none",
    effectiveFrom: metadata.effectiveFrom ?? null,
    sourceId: metadata.source ?? "Ley 51 de 1983"
  };
  const current = map.get(date);
  if (current) {
    const names = new Set([...current.name.split(" · "), name]);
    current.name = [...names].join(" · ");
    current.sources = [...new Set([...(current.sources ?? []), metadata.source].filter(Boolean))];
    current.occurrences.push(occurrence);
    return;
  }
  map.set(date, {
    date,
    name,
    kind: metadata.kind ?? "national",
    movedFrom: metadata.movedFrom ?? null,
    source: metadata.source ?? "Ley 51 de 1983",
    sources: metadata.source ? [metadata.source] : ["Ley 51 de 1983"],
    occurrences: [occurrence],
    manualClosure: false,
    allowScheduling: false
  });
}

export function colombianHolidays(year, overrides = []) {
  const holidays = new Map();
  const law51 = "Ley 51 de 1983";

  const fixed = [
    ["new_year", 1, 1, "Año Nuevo"],
    ["labor_day", 5, 1, "Día del Trabajo"],
    ["independence_day", 7, 20, "Día de la Independencia"],
    ["boyaca_battle", 8, 7, "Batalla de Boyacá"],
    ["immaculate_conception", 12, 8, "Inmaculada Concepción"],
    ["christmas", 12, 25, "Navidad"]
  ];
  for (const [ruleId, month, day, name] of fixed) {
    const nominalDate = makeISODate(year, month, day);
    addHoliday(holidays, nominalDate, name, { source: law51, ruleId, nominalDate });
  }

  const moved = [
    ["epiphany", 1, 6, "Día de los Reyes Magos"],
    ["saint_joseph", 3, 19, "Día de San José"],
    ["saints_peter_paul", 6, 29, "San Pedro y San Pablo"],
    ["assumption", 8, 15, "Asunción de la Virgen"],
    ["october_12", 10, 12, "Día de la Raza"],
    ["all_saints", 11, 1, "Todos los Santos"],
    ["cartagena_independence", 11, 11, "Independencia de Cartagena"]
  ];
  for (const [ruleId, month, day, name] of moved) {
    const original = makeISODate(year, month, day);
    addHoliday(holidays, mondayOnOrAfter(original), name, {
      source: law51,
      movedFrom: original,
      ruleId,
      nominalDate: original,
      shiftPolicy: "next-or-same-monday"
    });
  }

  const easter = easterSunday(year);
  const holyThursday = addDaysISO(easter, -3);
  const goodFriday = addDaysISO(easter, -2);
  addHoliday(holidays, holyThursday, "Jueves Santo", {
    source: law51,
    ruleId: "holy_thursday",
    nominalDate: holyThursday
  });
  addHoliday(holidays, goodFriday, "Viernes Santo", {
    source: law51,
    ruleId: "good_friday",
    nominalDate: goodFriday
  });

  const relativeMoved = [
    ["ascension", 39, "Ascensión del Señor"],
    ["corpus_christi", 60, "Corpus Christi"],
    ["sacred_heart", 68, "Sagrado Corazón de Jesús"]
  ];
  for (const [ruleId, offset, name] of relativeMoved) {
    const original = addDaysISO(easter, offset);
    addHoliday(holidays, mondayOnOrAfter(original), name, {
      source: law51,
      movedFrom: original,
      ruleId,
      nominalDate: original,
      shiftPolicy: "next-or-same-monday"
    });
  }

  if (year >= 2026) {
    const original = makeISODate(year, 7, 9);
    addHoliday(holidays, mondayOnOrAfter(original), "Nuestra Señora del Rosario de Chiquinquirá", {
      source: "Ley 2578 de 2026",
      movedFrom: original,
      ruleId: "chiquinquira",
      nominalDate: original,
      shiftPolicy: "next-or-same-monday",
      effectiveFrom: "2026-06-02"
    });
  }

  for (const override of overrides) {
    if (
      !override ||
      override.active === false ||
      !DATE_RE.test(String(override.date)) ||
      Number(override.date.slice(0, 4)) !== year
    ) {
      continue;
    }
    try {
      parseISODate(override.date);
    } catch {
      continue;
    }
    const type = override.type ?? (override.action === "remove" ? "allow-scheduling" : "manual-closure");
    if (!["allow-scheduling", "manual-closure"].includes(type)) continue;
    if (type === "allow-scheduling") {
      const current = holidays.get(override.date) ?? {
        date: override.date,
        name: safeText(override.name, 120) || "Programación habilitada manualmente",
        kind: "manual",
        movedFrom: null,
        source: "Ajuste manual",
        sources: ["Ajuste manual"],
        occurrences: [],
        manualClosure: false,
        allowScheduling: false
      };
      current.allowScheduling = true;
      current.overrideLabel = safeText(override.name, 120) || "Programación habilitada manualmente";
      holidays.set(override.date, current);
      continue;
    }
    addHoliday(holidays, override.date, safeText(override.name, 120) || "Festivo manual", {
      kind: "manual",
      source: "Ajuste manual",
      ruleId: `manual_${override.id ?? normalizeKey(override.name)}`,
      nominalDate: override.date
    });
    holidays.get(override.date).manualClosure = true;
  }

  return [...holidays.values()].sort((a, b) => compareISODate(a.date, b.date));
}

export function holidayMapForYears(years, overrides = []) {
  const map = new Map();
  for (const year of new Set(years)) {
    for (const holiday of colombianHolidays(year, overrides)) {
      map.set(holiday.date, holiday);
    }
  }
  return map;
}

export function holidayMapForRange(startDate, endDate, overrides = []) {
  parseISODate(startDate);
  parseISODate(endDate);
  if (compareISODate(endDate, startDate) < 0) {
    throw new RangeError("La fecha final no puede ser anterior a la inicial.");
  }
  const firstYear = Number(startDate.slice(0, 4));
  const lastYear = Number(endDate.slice(0, 4));
  const years = [];
  for (let year = firstYear; year <= lastYear; year += 1) years.push(year);
  return holidayMapForYears(years, overrides);
}

export function isNonWorkingDate(date, holidayMap) {
  const holiday = holidayMap.get(date);
  const hasHoliday = Boolean(holiday?.occurrences?.length || holiday?.manualClosure);
  return (dayOfWeek(date) === 0 || hasHoliday) && !holiday?.allowScheduling;
}

export function generateSeriesDates(startDate, endDate, holidayMap, options = false) {
  parseISODate(startDate);
  parseISODate(endDate);
  if (compareISODate(endDate, startDate) < 0) {
    throw new RangeError("La fecha final no puede ser anterior a la inicial.");
  }
  const normalizedOptions = typeof options === "boolean"
    ? { includeAllNonWorking: options, forceIncludeDates: [] }
    : {
      includeAllNonWorking: Boolean(options?.includeAllNonWorking ?? options?.includeNonWorking),
      forceIncludeDates: Array.isArray(options?.forceIncludeDates) ? options.forceIncludeDates : []
    };
  const forceInclude = new Set(normalizedOptions.forceIncludeDates);
  for (const date of forceInclude) parseISODate(date);
  const included = [];
  const omitted = [];
  for (let date = startDate; compareISODate(date, endDate) <= 0; date = addDaysISO(date, 1)) {
    const holiday = holidayMap.get(date);
    const sunday = dayOfWeek(date) === 0;
    const nonWorking = isNonWorkingDate(date, holidayMap);
    if (!normalizedOptions.includeAllNonWorking && !forceInclude.has(date) && nonWorking) {
      const reasons = [];
      if (sunday) reasons.push({ type: "sunday", label: "Domingo" });
      for (const occurrence of holiday?.occurrences ?? []) {
        reasons.push({
          type: occurrence.sourceId === "Ajuste manual" ? "manual-closure" : "legal-holiday",
          ruleId: occurrence.ruleId,
          label: occurrence.label
        });
      }
      omitted.push({
        date,
        reason: reasons.map((item) => item.label).join(" · ") || "Día no laborable",
        reasons
      });
    } else {
      included.push(date);
    }
  }
  return { included, omitted };
}

export function makeId(prefix = "id", idFactory = () => crypto.randomUUID()) {
  return `${prefix}_${idFactory()}`;
}

export function createDefaultDocument(today = todayInBogota(), now = new Date().toISOString()) {
  return {
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    calendarMeta: {
      id: "calendario_principal",
      name: "Cronograma HVAC",
      coordinator: "",
      revision: 0,
      createdAt: now,
      updatedAt: now
    },
    catalog: {
      cities: [],
      clients: [],
      sites: [],
      responsibles: []
    },
    activities: [],
    series: [],
    settings: {
      currentDate: today,
      backupReminderDays: 7,
      lastBackupAt: null,
      backupReminderDismissed: null,
      holidayRuleSetVersion: HOLIDAY_RULESET_VERSION,
      filters: {
        query: "",
        status: "all",
        serviceType: "all",
        responsible: "all"
      }
    },
    holidayOverrides: [],
    importMetadata: null,
    audit: []
  };
}

export function createActivitiesFromRange(
  input,
  holidayMap,
  { idFactory = () => crypto.randomUUID(), now = new Date().toISOString() } = {}
) {
  const endDate = input.endDate || input.date;
  const { included, omitted } = generateSeriesDates(
    input.date,
    endDate,
    holidayMap,
    {
      includeAllNonWorking: Boolean(input.includeNonWorking),
      forceIncludeDates: input.forceIncludeDates ?? []
    }
  );
  if (!included.length) {
    return { activities: [], series: null, omitted };
  }
  const hasRange = endDate !== input.date;
  const seriesId = hasRange ? makeId("serie", idFactory) : null;
  const responsibleIds = [...new Set((input.responsibleIds ?? []).map(String).filter(Boolean))];
  const activities = included.map((date) => ({
    id: makeId("actividad", idFactory),
    seriesId,
    date,
    clientId: input.clientId || null,
    siteId: input.siteId || null,
    city: safeText(input.city, 120) || null,
    responsibleIds,
    serviceType: input.serviceType,
    status: input.status,
    observations: safeText(input.observations, 5000),
    createdAt: now,
    updatedAt: now,
    completedAt: input.status === "completed" ? now : null,
    history: [{
      at: now,
      action: "created",
      detail: hasRange ? "Creada desde un rango de fechas" : "Actividad creada"
    }]
  }));
  const series = hasRange ? {
    id: seriesId,
    createdAt: now,
    originalStart: input.date,
    originalEnd: endDate
  } : null;
  const errors = activities.flatMap((activity) => validateActivity(activity));
  if (errors.length) {
    throw new TypeError([...new Set(errors)].join(" "));
  }
  return { activities, series, omitted };
}

export function validateActivity(activity) {
  const errors = [];
  try {
    parseISODate(activity.date);
  } catch {
    errors.push("La fecha no es válida.");
  }
  if (!Object.hasOwn(SERVICE_TYPES, activity.serviceType)) {
    errors.push("Selecciona un tipo de servicio válido.");
  }
  if (!Object.hasOwn(ACTIVITY_STATUSES, activity.status)) {
    errors.push("Selecciona un estado válido.");
  }
  if (
    activity.serviceType !== "administrative" &&
    (!activity.clientId || !activity.siteId || !safeText(activity.city, 120))
  ) {
    errors.push("Cliente, sede y ciudad son obligatorios para servicios operativos.");
  }
  const responsibleIds = (activity.responsibleIds ?? []).map(String).filter(Boolean);
  if (activity.status === "confirmed" && !responsibleIds.length) {
    errors.push("Una actividad confirmada debe tener al menos un responsable.");
  }
  return errors;
}

export function activityIdsForScope(document, activityId, scope) {
  const activity = document.activities.find((item) => item.id === activityId);
  if (!activity) return [];
  if (scope === "single" || !activity.seriesId) return [activityId];
  const seriesItems = document.activities.filter((item) => item.seriesId === activity.seriesId);
  if (scope === "future") {
    return seriesItems
      .filter((item) => compareISODate(item.date, activity.date) >= 0)
      .map((item) => item.id);
  }
  if (scope === "series") return seriesItems.map((item) => item.id);
  return [activityId];
}

export function applyStatus(document, activityId, status, scope = "single", now = new Date().toISOString()) {
  if (!Object.hasOwn(ACTIVITY_STATUSES, status)) {
    throw new TypeError("Estado inválido.");
  }
  const ids = new Set(activityIdsForScope(document, activityId, scope));
  if (!ids.size) throw new TypeError("No se encontró la actividad.");
  if (status === "confirmed") {
    const invalid = document.activities.filter(
      (activity) => ids.has(activity.id) && !(activity.responsibleIds ?? []).map(String).filter(Boolean).length
    );
    if (invalid.length) {
      throw new TypeError("No se puede confirmar una actividad sin responsables.");
    }
  }
  for (const activity of document.activities) {
    if (!ids.has(activity.id)) continue;
    const previous = activity.status;
    activity.status = status;
    activity.updatedAt = now;
    activity.completedAt = status === "completed" ? (activity.completedAt || now) : null;
    activity.history ??= [];
    activity.history.push({
      at: now,
      action: "status_changed",
      detail: `${ACTIVITY_STATUSES[previous] ?? previous} → ${ACTIVITY_STATUSES[status]}`,
      scope
    });
  }
  return [...ids];
}

export function moveActivities(
  document,
  activityIds,
  targetDate,
  { anchorId = activityIds[0], mode = "preserve", now = new Date().toISOString() } = {}
) {
  parseISODate(targetDate);
  if (!["preserve", "same"].includes(mode)) {
    throw new TypeError("Modo de movimiento inválido.");
  }
  if (!Array.isArray(activityIds) || !activityIds.length || new Set(activityIds).size !== activityIds.length) {
    throw new TypeError("La selección de actividades no es válida.");
  }
  const ids = new Set(activityIds);
  const foundIds = new Set(document.activities.filter((item) => ids.has(item.id)).map((item) => item.id));
  if (foundIds.size !== ids.size) {
    throw new TypeError("Una o más actividades seleccionadas no existen.");
  }
  const anchor = document.activities.find((item) => item.id === anchorId);
  if (!anchor || !ids.has(anchor.id)) {
    throw new TypeError("No se encontró la actividad de referencia.");
  }
  const delta = differenceInDays(anchor.date, targetDate);
  const moved = [];
  for (const activity of document.activities) {
    if (!ids.has(activity.id)) continue;
    const previousDate = activity.date;
    activity.date = mode === "same" ? targetDate : addDaysISO(activity.date, delta);
    activity.updatedAt = now;
    activity.history ??= [];
    activity.history.push({
      at: now,
      action: "rescheduled",
      detail: `${previousDate} → ${activity.date}`,
      mode
    });
    moved.push({ id: activity.id, from: previousDate, to: activity.date });
  }
  return moved;
}

export const BULK_EDIT_FIELDS = Object.freeze({
  serviceType: "Tipo de servicio",
  status: "Estado",
  responsibleIds: "Responsables",
  city: "Ciudad",
  observations: "Observaciones"
});

export function applyBulkEdit(
  document,
  activityIds,
  field,
  value,
  { mode = "replace", now = new Date().toISOString() } = {}
) {
  if (!Object.hasOwn(BULK_EDIT_FIELDS, field)) {
    throw new TypeError("Campo de edición múltiple inválido.");
  }
  if (!Array.isArray(activityIds) || !activityIds.length || new Set(activityIds).size !== activityIds.length) {
    throw new TypeError("La selección de actividades no es válida.");
  }
  const ids = new Set(activityIds.map(String));
  const selected = document.activities.filter((activity) => ids.has(activity.id));
  if (selected.length !== ids.size) {
    throw new TypeError("Una o más actividades seleccionadas no existen.");
  }
  const draft = selected.map((activity) => structuredClone(activity));
  for (const activity of draft) {
    let detail = "";
    if (field === "serviceType") {
      if (!Object.hasOwn(SERVICE_TYPES, value)) throw new TypeError("Tipo de servicio inválido.");
      detail = `${SERVICE_TYPES[activity.serviceType] ?? activity.serviceType} → ${SERVICE_TYPES[value]}`;
      activity.serviceType = value;
    } else if (field === "status") {
      if (!Object.hasOwn(ACTIVITY_STATUSES, value)) throw new TypeError("Estado inválido.");
      detail = `${ACTIVITY_STATUSES[activity.status] ?? activity.status} → ${ACTIVITY_STATUSES[value]}`;
      activity.status = value;
      activity.completedAt = value === "completed" ? (activity.completedAt || now) : null;
    } else if (field === "responsibleIds") {
      if (!["replace", "add", "remove"].includes(mode)) throw new TypeError("Modo de responsables inválido.");
      const incoming = [...new Set((Array.isArray(value) ? value : []).map(String).filter(Boolean))];
      const current = [...new Set((activity.responsibleIds ?? []).map(String).filter(Boolean))];
      activity.responsibleIds = mode === "add"
        ? [...new Set([...current, ...incoming])]
        : mode === "remove"
          ? current.filter((id) => !incoming.includes(id))
          : incoming;
      detail = `${mode}: ${incoming.length} responsable(s)`;
    } else if (field === "city") {
      if (!["replace", "clear"].includes(mode)) throw new TypeError("Modo de ciudad inválido.");
      const city = mode === "clear" ? "" : safeText(value, 120);
      detail = `${activity.city || "Sin ciudad"} → ${city || "Sin ciudad"}`;
      activity.city = city || null;
    } else if (field === "observations") {
      if (!["replace", "append", "clear"].includes(mode)) throw new TypeError("Modo de observaciones inválido.");
      const incoming = safeText(value, 5000);
      activity.observations = mode === "clear"
        ? ""
        : mode === "append"
          ? safeText([activity.observations, incoming].filter(Boolean).join("\n"), 5000)
          : incoming;
      detail = mode === "clear" ? "Observaciones eliminadas" : `${mode}: observaciones`;
    }
    activity.updatedAt = now;
    activity.history ??= [];
    activity.history.push({
      at: now,
      action: "bulk_edited",
      detail: `${BULK_EDIT_FIELDS[field]} · ${detail}`,
      mode
    });
    const errors = validateActivity(activity);
    if (errors.length) throw new TypeError(errors.join(" "));
  }
  const byId = new Map(draft.map((activity) => [activity.id, activity]));
  document.activities = document.activities.map((activity) => byId.get(activity.id) ?? activity);
  return [...ids];
}

export function deleteActivities(document, activityIds) {
  if (!Array.isArray(activityIds) || !activityIds.length || new Set(activityIds).size !== activityIds.length) {
    throw new TypeError("La selección de actividades no es válida.");
  }
  const ids = new Set(activityIds.map(String));
  const found = document.activities.filter((activity) => ids.has(activity.id));
  if (found.length !== ids.size) throw new TypeError("Una o más actividades seleccionadas no existen.");
  document.activities = document.activities.filter((activity) => !ids.has(activity.id));
  return found;
}

export function createBackupEnvelope(document, {
  exportedAt = new Date().toISOString(),
  origin = "local"
} = {}) {
  const clean = sanitizeDocument(document);
  return {
    format: "calendario-hvac-siys-backup",
    formatVersion: 1,
    exportedAt,
    appVersion: APP_VERSION,
    origin: safeText(origin, 120) || "local",
    revision: clean.calendarMeta.revision,
    document: clean
  };
}

export function parseBackup(raw, today = todayInBogota()) {
  if (raw?.format === "calendario-hvac-siys-backup") {
    if (Number(raw.formatVersion) !== 1 || !raw.document) {
      throw new TypeError("El formato del respaldo no es compatible.");
    }
    return {
      envelope: true,
      exportedAt: safeText(raw.exportedAt, 80) || null,
      origin: safeText(raw.origin, 120) || "desconocido",
      revision: Number.isSafeInteger(raw.revision) && raw.revision >= 0 ? raw.revision : 0,
      document: sanitizeDocument(raw.document, today)
    };
  }
  const document = sanitizeDocument(raw, today);
  return {
    envelope: false,
    exportedAt: null,
    origin: "respaldo heredado",
    revision: document.calendarMeta.revision,
    document
  };
}

function keepAllowed(source, fields) {
  const target = {};
  for (const field of fields) {
    if (source?.[field] !== undefined) target[field] = source[field];
  }
  return target;
}

function cleanStringArray(value, maxLength = 160, maxItems = 200) {
  if (!Array.isArray(value)) return [];
  const cleaned = value
    .slice(0, maxItems)
    .filter((item) => typeof item === "string")
    .map((item) => safeText(item, maxLength))
    .filter(Boolean);
  return [...new Set(cleaned)];
}

function cleanSafeCount(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function cleanCoverageHints(value) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 200)
    .filter((hint) => hint && typeof hint === "object" && !Array.isArray(hint))
    .map((hint) => {
      const source = typeof hint.source === "string" ? safeText(hint.source, 80) : "";
      const sourceKey = typeof hint.sourceKey === "string" ? safeText(hint.sourceKey, 200) : "";
      const subsidiaryId = typeof hint.subsidiaryId === "string"
        ? safeText(hint.subsidiaryId, 160)
        : null;
      const subsidiaryName = typeof hint.subsidiaryName === "string"
        ? safeText(hint.subsidiaryName, 240)
        : "";
      return {
        ...(source ? { source } : {}),
        ...(sourceKey ? { sourceKey } : {}),
        ...(subsidiaryId ? { subsidiaryId } : {}),
        ...(subsidiaryName ? { subsidiaryName } : {}),
        equipmentCount: cleanSafeCount(hint.equipmentCount) ?? 0,
        responsibleGroups: cleanStringArray(hint.responsibleGroups, 160),
        frequencies: cleanStringArray(hint.frequencies, 120),
        scheduledMonths: cleanStringArray(hint.scheduledMonths, 20, 12)
      };
    })
    .filter((hint) => hint.sourceKey || hint.subsidiaryName);
}

const IMPORT_SHEET_NAMES = Object.freeze([
  "dm_ciudad",
  "dm_clientes",
  "dm_sede",
  "dm_directorio_siys",
  "dm_equipo_cronograma"
]);

const IMPORT_COUNT_FIELDS = Object.freeze([
  "sourceRows",
  "imported",
  "skipped",
  "hints"
]);

function cleanSheetCounts(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const sheetName of IMPORT_SHEET_NAMES) {
    const rawCounts = value[sheetName];
    if (!rawCounts || typeof rawCounts !== "object" || Array.isArray(rawCounts)) continue;
    const counts = {};
    for (const field of IMPORT_COUNT_FIELDS) {
      const count = cleanSafeCount(rawCounts[field]);
      if (count !== null) counts[field] = count;
    }
    if (Object.keys(counts).length) result[sheetName] = counts;
  }
  return result;
}

function cleanImportWarnings(value) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 1000)
    .filter((warning) => warning && typeof warning === "object" && !Array.isArray(warning))
    .map((warning) => {
      const code = typeof warning.code === "string" ? safeText(warning.code, 80) : "";
      const message = typeof warning.message === "string" ? safeText(warning.message, 500) : "";
      const sheet = typeof warning.sheet === "string" ? safeText(warning.sheet, 80) : "";
      const row = cleanSafeCount(warning.row);
      return {
        ...(code ? { code } : {}),
        ...(message ? { message } : {}),
        ...(sheet ? { sheet } : {}),
        ...(row !== null ? { row } : {})
      };
    })
    .filter((warning) => warning.code || warning.message);
}

function cleanImportMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = {};
  if (typeof value.fileName === "string") {
    const fileName = safeText(value.fileName, 260);
    if (fileName) result.fileName = fileName;
  }
  const fileSize = cleanSafeCount(value.fileSize);
  if (fileSize !== null) result.fileSize = fileSize;
  if (typeof value.lastModified === "string") {
    const lastModified = safeText(value.lastModified, 80);
    if (lastModified) result.lastModified = lastModified;
  }
  if (typeof value.sha256 === "string") {
    const sha256 = safeText(value.sha256, 64).toUpperCase();
    if (/^[A-F0-9]{64}$/.test(sha256)) result.sha256 = sha256;
  }
  if (typeof value.importedAt === "string") {
    const importedAt = safeText(value.importedAt, 80);
    if (importedAt) result.importedAt = importedAt;
  }
  result.sheetCounts = cleanSheetCounts(value.sheetCounts);
  result.warnings = cleanImportWarnings(value.warnings);
  return result;
}

function cleanHistory(history) {
  return Array.isArray(history)
    ? history.slice(-200).map((item) => ({
      at: safeText(item?.at, 40),
      action: safeText(item?.action, 40),
      detail: safeText(item?.detail, 500),
      ...(item?.scope ? { scope: safeText(item.scope, 20) } : {}),
      ...(item?.mode ? { mode: safeText(item.mode, 20) } : {})
    }))
    : [];
}

export function sanitizeDocument(raw, today = todayInBogota()) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TypeError("El respaldo no contiene un documento válido.");
  }
  if (Number(raw.schemaVersion ?? 1) > SCHEMA_VERSION) {
    throw new RangeError("El respaldo fue creado por una versión más reciente de la herramienta.");
  }
  const base = createDefaultDocument(today);
  const rawOverrides = Array.isArray(raw.holidayOverrides)
    ? raw.holidayOverrides.map((item) => keepAllowed(item, [
      "id", "date", "name", "reason", "type", "active", "createdAt", "action"
    ]))
    : [];
  const overrideIds = new Set();
  const activeDates = new Set();
  for (const override of rawOverrides) {
    const errors = validateHolidayOverride(override);
    if (errors.length) throw new TypeError(`Excepción de festivo: ${errors.join(" ")}`);
    if (overrideIds.has(override.id)) throw new TypeError("Hay excepciones de festivo con ID duplicado.");
    overrideIds.add(override.id);
    if (override.active !== false) {
      if (activeDates.has(override.date)) {
        throw new TypeError("Sólo puede existir una excepción activa por fecha.");
      }
      activeDates.add(override.date);
    }
  }
  const result = {
    ...base,
    schemaVersion: SCHEMA_VERSION,
    appVersion: safeText(raw.appVersion, 30) || APP_VERSION,
    calendarMeta: {
      id: safeText(raw.calendarMeta?.id, 120) || base.calendarMeta.id,
      name: safeText(raw.calendarMeta?.name, 160) || base.calendarMeta.name,
      coordinator: safeText(raw.calendarMeta?.coordinator, 160),
      revision: Number.isSafeInteger(raw.calendarMeta?.revision) && raw.calendarMeta.revision >= 0
        ? raw.calendarMeta.revision
        : 0,
      createdAt: safeText(raw.calendarMeta?.createdAt, 80) || base.calendarMeta.createdAt,
      updatedAt: safeText(raw.calendarMeta?.updatedAt, 80) || base.calendarMeta.updatedAt
    },
    catalog: {
      cities: Array.isArray(raw.catalog?.cities) ? raw.catalog.cities.map((item) => keepAllowed(item, [
        "id", "sourceKey", "name", "zone", "active", "source"
      ])) : [],
      clients: Array.isArray(raw.catalog?.clients) ? raw.catalog.clients.map((item) => ({
        ...keepAllowed(item, ["id", "sourceKey", "name", "active", "source"]),
        aliases: cleanStringArray(item?.aliases, 160)
      })) : [],
      sites: Array.isArray(raw.catalog?.sites) ? raw.catalog.sites.map((item) => ({
        ...keepAllowed(item, [
          "id", "sourceKey", "clientId", "name", "city", "zone", "shoppingCenter", "address",
          "entryConditions", "requiresApp", "active", "source"
        ]),
        aliases: cleanStringArray(item?.aliases, 160),
        coverageHints: cleanCoverageHints(item?.coverageHints)
      })) : [],
      responsibles: Array.isArray(raw.catalog?.responsibles) ? raw.catalog.responsibles.map((item) => ({
        ...keepAllowed(item, [
          "id", "sourceKey", "name", "initials", "company", "responsibleType", "baseCity",
          "group", "heights", "courses", "active", "source", "favorite"
        ]),
        coverage: cleanStringArray(item?.coverage, 160),
        aliases: cleanStringArray(item?.aliases, 160)
      })) : []
    },
    activities: Array.isArray(raw.activities) ? raw.activities.map((item) => ({
      ...keepAllowed(item, [
        "id", "seriesId", "date", "clientId", "siteId", "city", "responsibleIds",
        "serviceType", "status", "observations", "createdAt", "updatedAt", "completedAt"
      ]),
      responsibleIds: Array.isArray(item.responsibleIds) ? [...new Set(item.responsibleIds.map(String))] : [],
      observations: safeText(item.observations, 5000),
      history: cleanHistory(item.history)
    })) : [],
    series: Array.isArray(raw.series) ? raw.series.map((item) => keepAllowed(item, [
      "id", "createdAt", "originalStart", "originalEnd"
    ])) : [],
    settings: {
      ...base.settings,
      ...keepAllowed(raw.settings, [
        "currentDate", "backupReminderDays", "lastBackupAt", "backupReminderDismissed"
      ]),
      holidayRuleSetVersion: HOLIDAY_RULESET_VERSION,
      filters: {
        ...base.settings.filters,
        ...keepAllowed(raw.settings?.filters, ["query", "status", "serviceType", "responsible"])
      }
    },
    holidayOverrides: rawOverrides,
    importMetadata: cleanImportMetadata(raw.importMetadata),
    audit: Array.isArray(raw.audit)
      ? raw.audit.slice(-500).map((item) => keepAllowed(item, ["at", "action", "detail"]))
      : []
  };

  const activityIds = new Set();
  for (const activity of result.activities) {
    if (!activity.id || activityIds.has(activity.id)) {
      throw new TypeError("El respaldo contiene actividades sin identificador único.");
    }
    activityIds.add(activity.id);
    const errors = validateActivity(activity);
    if (errors.length) {
      throw new TypeError(`Actividad ${activity.id}: ${errors.join(" ")}`);
    }
  }
  if (
    raw.settings?.holidayRuleSetVersion &&
    raw.settings.holidayRuleSetVersion !== HOLIDAY_RULESET_VERSION
  ) {
    result.audit.push({
      at: new Date().toISOString(),
      action: "holiday_rules_migrated",
      detail: `${safeText(raw.settings.holidayRuleSetVersion, 80)} → ${HOLIDAY_RULESET_VERSION}`
    });
  }
  return result;
}

export function validateHolidayOverride(override) {
  const errors = [];
  if (!safeText(override?.id, 120)) errors.push("Falta el identificador.");
  try {
    parseISODate(override?.date);
  } catch {
    errors.push("La fecha no es válida.");
  }
  const type = override?.type ?? (override?.action === "remove" ? "allow-scheduling" : "manual-closure");
  if (!["manual-closure", "allow-scheduling"].includes(type)) {
    errors.push("El tipo de excepción no es válido.");
  }
  if (!safeText(override?.name, 120)) errors.push("Falta el nombre.");
  if (!safeText(override?.reason, 500)) errors.push("Falta el motivo.");
  return errors;
}

export function buildMonthlyCsv(document, year, month) {
  const clients = new Map(document.catalog.clients.map((item) => [item.id, item]));
  const sites = new Map(document.catalog.sites.map((item) => [item.id, item]));
  const responsibles = new Map(document.catalog.responsibles.map((item) => [item.id, item]));
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  const rows = document.activities
    .filter((activity) => activity.date.startsWith(prefix))
    .sort((a, b) => compareISODate(a.date, b.date) || a.id.localeCompare(b.id))
    .map((activity) => {
      const assigned = activity.responsibleIds.map((id) => responsibles.get(id)).filter(Boolean);
      return [
        activity.date,
        clients.get(activity.clientId)?.name ?? "",
        sites.get(activity.siteId)?.name ?? "",
        activity.city ?? sites.get(activity.siteId)?.city ?? "",
        assigned.filter((item) => item.responsibleType === "payroll").map((item) => item.name).join(" | "),
        assigned.filter((item) => item.responsibleType === "contractor").map((item) => item.name).join(" | "),
        SERVICE_TYPES[activity.serviceType] ?? activity.serviceType,
        ACTIVITY_STATUSES[activity.status] ?? activity.status,
        activity.observations ?? "",
        activity.id,
        activity.seriesId ?? ""
      ];
    });
  const header = [
    "Fecha", "Cliente", "Sede", "Ciudad", "Responsables nómina", "Responsables contratistas",
    "Tipo de servicio", "Estado", "Observaciones", "ID actividad", "ID serie"
  ];
  const escape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return "\uFEFF" + [header, ...rows].map((row) => row.map(escape).join(",")).join("\r\n");
}

export function importDiff(existing, incoming, fields) {
  const seenIncomingKeys = new Set();
  for (const item of incoming) {
    if (!item.sourceKey || seenIncomingKeys.has(item.sourceKey)) {
      throw new TypeError("La importación contiene claves de origen vacías o duplicadas.");
    }
    seenIncomingKeys.add(item.sourceKey);
  }
  const existingByKey = new Map(existing.filter((item) => item.sourceKey).map((item) => [item.sourceKey, item]));
  const incomingKeys = new Set();
  const result = { newItems: [], updated: [], unchanged: [], missing: [] };
  for (const item of incoming) {
    incomingKeys.add(item.sourceKey);
    const current = existingByKey.get(item.sourceKey);
    if (!current) {
      result.newItems.push(item);
      continue;
    }
    const changedFields = fields.filter((field) => JSON.stringify(current[field] ?? null) !== JSON.stringify(item[field] ?? null));
    if (changedFields.length) {
      result.updated.push({ current, incoming: item, changedFields });
    } else {
      result.unchanged.push(current);
    }
  }
  result.missing = existing.filter((item) => item.source === "base-operativa" && !incomingKeys.has(item.sourceKey));
  return result;
}

export function mergeImportedItems(existing, incoming, sourceFields, preservedFields = []) {
  const byKey = new Map(existing.filter((item) => item.sourceKey).map((item) => [item.sourceKey, item]));
  const merged = [...existing];
  for (const item of incoming) {
    const current = byKey.get(item.sourceKey);
    if (!current) {
      merged.push(item);
      byKey.set(item.sourceKey, item);
      continue;
    }
    for (const field of sourceFields) current[field] = item[field];
    for (const field of preservedFields) {
      if (current[field] === undefined && item[field] !== undefined) current[field] = item[field];
    }
  }
  return merged;
}
