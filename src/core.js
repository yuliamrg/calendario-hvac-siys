import {
  addDaysISO,
  compareISODate,
  dayOfWeek,
  differenceInDays,
  endOfMonthISO,
  isISODateString,
  makeISODate,
  mondayOnOrAfter,
  monthGridDates,
  parseISODate,
  startOfMondayWeek,
  todayInBogota,
  toISODate
} from "./domain/dates.js";
import { normalizeKey, normalizeText, safeText } from "./domain/text.js";
import {
  colombianHolidays,
  generateSeriesDates,
  holidayMapForRange,
  holidayMapForYears,
  isNonWorkingDate
} from "./domain/holidays.js";
import {
  ACTIVITY_STATUSES,
  PLANNING_BUCKETS,
  QUARANTINE_ALLOWED_STATUSES,
  RESPONSIBLE_TYPES,
  SERVICE_TYPES,
  STATUS_SCOPES
} from "./domain/calendar-enums.js";
import { compareActivityOrder } from "./domain/activity-order.js";
import { buildMonthlyCsv, buildQuarantineCsv } from "./domain/csv-export.js";
import {
  activityMatchesFilters,
  cleanStringArray,
  normalizeFilterArray
} from "./domain/activity-filters.js";
import { importDiff, mergeImportedItems } from "./domain/import-merge.js";
import { mergeBackupDocuments } from "./domain/backup-merge.js";
export {
  addDaysISO,
  compareISODate,
  dayOfWeek,
  differenceInDays,
  endOfMonthISO,
  isISODateString,
  makeISODate,
  mondayOnOrAfter,
  monthGridDates,
  parseISODate,
  startOfMondayWeek,
  todayInBogota,
  toISODate
} from "./domain/dates.js";
export { normalizeKey, normalizeText, safeText } from "./domain/text.js";
export {
  colombianHolidays,
  easterSunday,
  generateSeriesDates,
  holidayMapForRange,
  holidayMapForYears,
  isNonWorkingDate
} from "./domain/holidays.js";
export {
  ACTIVITY_STATUSES,
  PLANNING_BUCKETS,
  QUARANTINE_ALLOWED_STATUSES,
  RESPONSIBLE_TYPES,
  SERVICE_TYPES,
  STATUS_SCOPES
} from "./domain/calendar-enums.js";
export { compareActivityOrder } from "./domain/activity-order.js";
export { buildMonthlyCsv, buildQuarantineCsv } from "./domain/csv-export.js";
export { activityMatchesFilters, normalizeFilterArray } from "./domain/activity-filters.js";
export { importDiff, mergeImportedItems } from "./domain/import-merge.js";

export const APP_VERSION = "0.15.0-beta.6";
export const SCHEMA_VERSION = 4;
export const HOLIDAY_RULESET_VERSION = "CO-NATIONAL-2026-06-02";

export function runtimeChannelForLocation(locationLike = {}) {
  const pathname = String(locationLike.pathname ?? "");
  const protocol = String(locationLike.protocol ?? "").toLowerCase();
  const hostname = String(locationLike.hostname ?? "").toLowerCase();
  if (pathname.includes("/beta/")) return "beta";
  if (
    protocol === "file:" ||
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname) ||
    hostname.endsWith(".localhost")
  ) {
    return "local";
  }
  return "stable";
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
        cities: [],
        clients: [],
        sites: [],
        responsibles: [],
        serviceTypes: [],
        statuses: [],
        planningBuckets: []
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
    planningBucket: "calendar",
    clientId: input.clientId || null,
    siteId: input.siteId || null,
    city: safeText(input.city, 120) || null,
    responsibleIds,
    serviceType: input.serviceType,
    status: input.status,
    sortOrder: null,
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
    updatedAt: now,
    originalStart: input.date,
    originalEnd: endDate
  } : null;
  const errors = activities.flatMap((activity) => validateActivity(activity));
  if (errors.length) {
    throw new TypeError([...new Set(errors)].join(" "));
  }
  return { activities, series, omitted };
}

export function createQuarantineActivity(
  input,
  { idFactory = () => crypto.randomUUID(), now = new Date().toISOString() } = {}
) {
  const activity = {
    id: makeId("actividad", idFactory),
    seriesId: null,
    date: null,
    planningBucket: "quarantine",
    clientId: input.clientId || null,
    siteId: input.siteId || null,
    city: safeText(input.city, 120) || null,
    responsibleIds: [...new Set((input.responsibleIds ?? []).map(String).filter(Boolean))],
    serviceType: input.serviceType,
    status: "to_schedule",
    sortOrder: null,
    observations: safeText(input.observations, 5000),
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    history: [{
      at: now,
      action: "created",
      detail: "Creada directamente en la bandeja Pendiente"
    }]
  };
  const errors = validateActivity(activity);
  if (errors.length) throw new TypeError([...new Set(errors)].join(" "));
  return activity;
}

export function validateActivity(activity) {
  const errors = [];
  const planningBucket = activity?.planningBucket ?? "calendar";
  if (!Object.hasOwn(PLANNING_BUCKETS, planningBucket)) {
    errors.push("La bandeja de planificación no es válida.");
  } else if (planningBucket === "quarantine") {
    if (activity.date !== null) errors.push("Una actividad de la bandeja Pendiente debe quedar sin fecha.");
    if (activity.status !== "to_schedule") errors.push("Una actividad de la bandeja Pendiente debe tener estado Por programar.");
    if (activity.seriesId) errors.push("Una actividad de la bandeja Pendiente no puede conservar una serie.");
  } else {
    try {
      parseISODate(activity.date);
    } catch {
      errors.push("La fecha no es válida.");
    }
    if (activity.status === "to_schedule") {
      errors.push("Una actividad del calendario no puede estar Por programar.");
    }
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

export function isQuarantineActivity(activity) {
  return activity?.planningBucket === "quarantine";
}

export function validatePlanningDate(date, holidayMap = new Map()) {
  try {
    parseISODate(date);
  } catch {
    return { valid: false, reason: "La fecha no es válida." };
  }
  if (isNonWorkingDate(date, holidayMap)) {
    const holiday = holidayMap.get(date);
    return {
      valid: false,
      reason: holiday?.name
        ? `${holiday.name}. La fecha no es laborable.`
        : "La fecha es domingo y no es laborable.",
      holiday: holiday ?? null
    };
  }
  return { valid: true, reason: "" };
}

export function assignQuarantineDate(
  document,
  activityId,
  targetDate,
  holidayMap = new Map(),
  { allowNonWorking = false, now = new Date().toISOString() } = {}
) {
  const activity = document.activities.find((item) => item.id === activityId);
  if (!activity) throw new TypeError("No se encontró la actividad.");
  if (!isQuarantineActivity(activity)) {
    throw new TypeError("Sólo se puede asignar fecha a una actividad Pendiente.");
  }
  try {
    parseISODate(targetDate);
  } catch {
    throw new TypeError("La fecha no es válida.");
  }
  const dateValidation = validatePlanningDate(targetDate, holidayMap);
  if (!dateValidation.valid && !allowNonWorking) {
    throw new TypeError(dateValidation.reason);
  }
  const previousStatus = activity.status;
  activity.date = targetDate;
  activity.planningBucket = "calendar";
  activity.status = "scheduled";
  activity.sortOrder = null;
  activity.seriesId = null;
  activity.completedAt = null;
  activity.updatedAt = now;
  activity.history ??= [];
  activity.history.push({
    at: now,
    action: "scheduled_from_quarantine",
    detail: `${PLANNING_BUCKETS.quarantine} · ${ACTIVITY_STATUSES[previousStatus] ?? previousStatus} → ${ACTIVITY_STATUSES.scheduled}`
  });
  return activity;
}

export function moveActivityToQuarantine(
  document,
  activityId,
  scope = "single",
  now = new Date().toISOString()
) {
  if (!Object.hasOwn(STATUS_SCOPES, scope) || !["single", "series"].includes(scope)) {
    throw new TypeError("El alcance de Pendiente no es válido.");
  }
  const source = document.activities.find((item) => item.id === activityId);
  if (!source) throw new TypeError("No se encontró la actividad.");
  if (isQuarantineActivity(source)) return { activity: source, removed: [], scope };
  const ids = scope === "series" && source.seriesId
    ? document.activities
      .filter((item) => item.seriesId === source.seriesId)
      .map((item) => item.id)
    : [source.id];
  const selected = document.activities.filter((item) => ids.includes(item.id));
  const blocked = selected.filter((item) => !QUARANTINE_ALLOWED_STATUSES.includes(item.status));
  if (blocked.length) {
    throw new TypeError(
      `No se puede enviar a Pendiente una actividad ${ACTIVITY_STATUSES[blocked[0].status] ?? blocked[0].status}. Sólo se permiten Programada o Confirmada.`
    );
  }

  const seriesId = source.seriesId;
  const removed = scope === "series" && seriesId
    ? selected.filter((item) => item.id !== source.id)
    : [];
  if (removed.length) {
    const removedIds = new Set(removed.map((item) => item.id));
    document.activities = document.activities.filter((item) => !removedIds.has(item.id));
  }
  const representative = document.activities.find((item) => item.id === source.id);
  if (!representative) throw new TypeError("No se encontró la tarjeta representante.");
  representative.date = null;
  representative.planningBucket = "quarantine";
  representative.status = "to_schedule";
  representative.sortOrder = null;
  representative.seriesId = null;
  representative.completedAt = null;
  representative.updatedAt = now;
  representative.history ??= [];
  representative.history.push({
    at: now,
    action: "moved_to_quarantine",
    detail: scope === "series"
      ? "Toda la actividad pasó a Pendiente; las demás fechas fueron retiradas"
      : "Sólo esta fecha pasó a Pendiente",
    scope
  });
  if (seriesId) {
    const remaining = document.activities.filter((item) => item.seriesId === seriesId);
    if (remaining.length < 2) {
      for (const item of remaining) item.seriesId = null;
      document.series = document.series.filter((item) => item.id !== seriesId);
    }
  }
  return { activity: representative, removed, scope };
}

export const sendActivityToQuarantine = moveActivityToQuarantine;

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
  const selected = document.activities.filter((activity) => ids.has(activity.id));
  if (selected.some((activity) => isQuarantineActivity(activity) && status !== "to_schedule")) {
    throw new TypeError("Una actividad Pendiente debe permanecer en esa bandeja hasta asignarle fecha.");
  }
  if (status === "to_schedule" && selected.some((activity) => !isQuarantineActivity(activity))) {
    throw new TypeError("Por programar sólo se puede usar en la bandeja Pendiente.");
  }
  if (status === "confirmed") {
    const invalid = selected.filter(
      (activity) => !(activity.responsibleIds ?? []).map(String).filter(Boolean).length
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
  if (mode === "preserve" && delta === 0) return [];
  const moved = [];
  for (const activity of document.activities) {
    if (!ids.has(activity.id)) continue;
    const previousDate = activity.date;
    const nextDate = mode === "same" ? targetDate : addDaysISO(activity.date, delta);
    if (nextDate === previousDate) continue;
    activity.date = nextDate;
    activity.sortOrder = null;
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

export function reorderActivities(
  document,
  activityIds,
  {
    targetId = null,
    targetDate = null,
    position = "after",
    now = new Date().toISOString()
  } = {}
) {
  if (!Array.isArray(activityIds) || !activityIds.length || new Set(activityIds).size !== activityIds.length) {
    throw new TypeError("La selección de actividades no es válida.");
  }
  if (!["first", "last", "before", "after"].includes(position)) {
    throw new TypeError("La posición de orden no es válida.");
  }
  const ids = new Set(activityIds.map(String));
  const selected = document.activities.filter((activity) => ids.has(activity.id));
  if (selected.length !== ids.size) {
    throw new TypeError("Una o más actividades seleccionadas no existen.");
  }
  if (selected.some((activity) => isQuarantineActivity(activity) || !activity.date)) {
    throw new TypeError("Sólo se pueden ordenar tarjetas del calendario.");
  }
  const date = selected[0].date;
  if (selected.some((activity) => activity.date !== date)) {
    throw new TypeError("Las tarjetas seleccionadas deben pertenecer al mismo día.");
  }
  if (targetDate !== null && targetDate !== undefined && targetDate !== date) {
    throw new TypeError("La tarjeta sólo puede ordenarse dentro de su día.");
  }
  if (targetId && ids.has(targetId)) {
    throw new TypeError("La tarjeta de destino no puede pertenecer a la selección.");
  }

  const current = document.activities
    .filter((activity) => !isQuarantineActivity(activity) && activity.date === date)
    .sort(compareActivityOrder);
  const moving = current.filter((activity) => ids.has(activity.id));
  const remaining = current.filter((activity) => !ids.has(activity.id));
  if (moving.length !== ids.size) {
    throw new TypeError("No se pudieron ordenar todas las tarjetas seleccionadas.");
  }

  let insertionIndex = remaining.length;
  if (position === "first") {
    insertionIndex = 0;
  } else if (position === "last") {
    insertionIndex = remaining.length;
  } else {
    const targetIndex = remaining.findIndex((activity) => activity.id === targetId);
    if (targetIndex < 0) throw new TypeError("No se encontró la tarjeta de destino en ese día.");
    insertionIndex = targetIndex + (position === "after" ? 1 : 0);
  }
  const ordered = [
    ...remaining.slice(0, insertionIndex),
    ...moving,
    ...remaining.slice(insertionIndex)
  ];
  if (ordered.every((activity, index) => activity.id === current[index]?.id)) return [];

  const movingDetails = new Map(moving.map((activity) => [activity.id, {
    previous: current.findIndex((candidate) => candidate.id === activity.id),
    next: ordered.findIndex((candidate) => candidate.id === activity.id)
  }]));
  for (const [index, activity] of ordered.entries()) {
    activity.sortOrder = index;
    if (!ids.has(activity.id)) continue;
    activity.updatedAt = now;
    activity.history ??= [];
    const detail = movingDetails.get(activity.id);
    activity.history.push({
      at: now,
      action: "reordered",
      detail: `Orden del día ${detail.previous + 1} → ${detail.next + 1}`
    });
  }
  return ordered.map((activity) => activity.id);
}

export function duplicateActivities(
  document,
  activityIds,
  targetDate,
  {
    anchorId = activityIds[0],
    idFactory = () => crypto.randomUUID(),
    now = new Date().toISOString()
  } = {}
) {
  parseISODate(targetDate);
  if (!Array.isArray(activityIds) || !activityIds.length || new Set(activityIds).size !== activityIds.length) {
    throw new TypeError("La selección de actividades no es válida.");
  }
  const ids = new Set(activityIds.map(String));
  const selected = document.activities.filter((item) => ids.has(item.id));
  if (selected.length !== ids.size) throw new TypeError("Una o más actividades seleccionadas no existen.");
  const anchor = selected.find((item) => item.id === anchorId);
  if (!anchor) throw new TypeError("No se encontró la actividad de referencia.");
  const delta = differenceInDays(anchor.date, targetDate);
  const copies = selected.map((activity) => ({
    ...structuredClone(activity),
    id: makeId("actividad", idFactory),
    seriesId: null,
    date: addDaysISO(activity.date, delta),
    status: "scheduled",
    sortOrder: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    history: [{
      at: now,
      action: "duplicated",
      detail: `Duplicada desde ${activity.id}`
    }]
  }));
  const errors = copies.flatMap((activity) => validateActivity(activity));
  if (errors.length) throw new TypeError([...new Set(errors)].join(" "));
  document.activities.push(...copies);
  return copies;
}

export function extendActivity(
  document,
  activityId,
  targetDate,
  {
    idFactory = () => crypto.randomUUID(),
    now = new Date().toISOString()
  } = {}
) {
  parseISODate(targetDate);
  const source = document.activities.find((item) => item.id === activityId);
  if (!source) throw new TypeError("No se encontró la actividad.");
  if (source.date === targetDate) return null;

  let seriesId = source.seriesId;
  if (!seriesId) {
    seriesId = makeId("serie", idFactory);
    source.seriesId = seriesId;
    source.updatedAt = now;
    source.history ??= [];
    source.history.push({
      at: now,
      action: "series_created",
      detail: "Actividad convertida en programación ampliada"
    });
    document.series.push({
      id: seriesId,
      createdAt: now,
      updatedAt: now,
      originalStart: source.date,
      originalEnd: targetDate
    });
  } else {
    const series = document.series.find((item) => item.id === seriesId);
    if (series) series.updatedAt = now;
  }
  if (document.activities.some((item) => item.seriesId === seriesId && item.date === targetDate)) {
    throw new TypeError("Esta actividad ya tiene una tarjeta en la fecha de destino.");
  }

  const extended = {
    ...structuredClone(source),
    id: makeId("actividad", idFactory),
    seriesId,
    date: targetDate,
    status: "scheduled",
    sortOrder: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    history: [{
      at: now,
      action: "extended",
      detail: `Actividad ampliada desde ${source.date}`
    }]
  };
  const errors = validateActivity(extended);
  if (errors.length) throw new TypeError([...new Set(errors)].join(" "));
  document.activities.push(extended);
  return extended;
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
  origin = "local",
  channel = "local"
} = {}) {
  const clean = sanitizeDocument(document);
  return {
    format: "calendario-hvac-siys-backup",
    formatVersion: 1,
    exportedAt,
    appVersion: APP_VERSION,
    origin: safeText(origin, 120) || "local",
    channel: ["local", "stable", "beta"].includes(channel) ? channel : "local",
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
      channel: ["local", "stable", "beta"].includes(raw.channel) ? raw.channel : null,
      revision: Number.isSafeInteger(raw.revision) && raw.revision >= 0 ? raw.revision : 0,
      document: sanitizeDocument(raw.document, today)
    };
  }
  const document = sanitizeDocument(raw, today);
  return {
    envelope: false,
    exportedAt: null,
    origin: "respaldo heredado",
    channel: null,
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

function sanitizeHolidayOverrides(rawOverrides, legacyUpdatedAt) {
  const overrides = Array.isArray(rawOverrides)
    ? rawOverrides.map((item) => ({
      ...keepAllowed(item, [
        "id", "date", "name", "reason", "type", "active", "createdAt", "updatedAt", "action"
      ]),
      updatedAt: safeText(item?.updatedAt, 80) || legacyUpdatedAt
    }))
    : [];
  const overrideIds = new Set();
  const activeDates = new Set();
  for (const override of overrides) {
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
  return overrides;
}

function sanitizeCatalog(rawCatalog, legacyUpdatedAt) {
  return {
    cities: Array.isArray(rawCatalog?.cities) ? rawCatalog.cities.map((item) => ({
      ...keepAllowed(item, ["id", "sourceKey", "name", "zone", "active", "source", "updatedAt"]),
      updatedAt: safeText(item?.updatedAt, 80) || legacyUpdatedAt
    })) : [],
    clients: Array.isArray(rawCatalog?.clients) ? rawCatalog.clients.map((item) => ({
      ...keepAllowed(item, ["id", "sourceKey", "name", "active", "source", "updatedAt"]),
      updatedAt: safeText(item?.updatedAt, 80) || legacyUpdatedAt,
      aliases: cleanStringArray(item?.aliases, 160)
    })) : [],
    sites: Array.isArray(rawCatalog?.sites) ? rawCatalog.sites.map((item) => ({
      ...keepAllowed(item, [
        "id", "sourceKey", "clientId", "name", "city", "zone", "shoppingCenter", "address",
        "entryConditions", "requiresApp", "active", "source", "updatedAt"
      ]),
      updatedAt: safeText(item?.updatedAt, 80) || legacyUpdatedAt,
      aliases: cleanStringArray(item?.aliases, 160),
      coverageHints: cleanCoverageHints(item?.coverageHints)
    })) : [],
    responsibles: Array.isArray(rawCatalog?.responsibles) ? rawCatalog.responsibles.map((item) => ({
      ...keepAllowed(item, [
        "id", "sourceKey", "name", "initials", "company", "responsibleType", "baseCity",
        "group", "heights", "courses", "active", "source", "favorite", "updatedAt"
      ]),
      updatedAt: safeText(item?.updatedAt, 80) || legacyUpdatedAt,
      coverage: cleanStringArray(item?.coverage, 160),
      aliases: cleanStringArray(item?.aliases, 160)
    })) : []
  };
}

function planningBucketForSanitizedActivity(activity, sourceSchemaVersion) {
  if (typeof activity?.planningBucket === "string") return activity.planningBucket;
  if (sourceSchemaVersion < 4) return "calendar";
  return activity?.status === "to_schedule" || activity?.date === null
    ? "quarantine"
    : "calendar";
}

function sanitizeActivities(rawActivities, sourceSchemaVersion) {
  if (!Array.isArray(rawActivities)) return [];
  return rawActivities.map((item) => ({
    ...keepAllowed(item, [
      "id", "seriesId", "date", "planningBucket", "clientId", "siteId", "city", "responsibleIds",
      "serviceType", "status", "sortOrder", "observations", "createdAt", "updatedAt", "completedAt"
    ]),
    planningBucket: planningBucketForSanitizedActivity(item, sourceSchemaVersion),
    date: Object.hasOwn(item ?? {}, "date") ? item.date : null,
    seriesId: Object.hasOwn(item ?? {}, "seriesId") ? item.seriesId : null,
    sortOrder: item?.sortOrder === null || item?.sortOrder === undefined || item?.sortOrder === ""
      ? null
      : Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : null,
    responsibleIds: Array.isArray(item.responsibleIds) ? [...new Set(item.responsibleIds.map(String))] : [],
    observations: safeText(item.observations, 5000),
    history: cleanHistory(item.history)
  }));
}

function sanitizeSettings(rawSettings, baseSettings) {
  return {
    ...baseSettings,
    ...keepAllowed(rawSettings, [
      "currentDate", "backupReminderDays", "lastBackupAt", "backupReminderDismissed"
    ]),
    holidayRuleSetVersion: HOLIDAY_RULESET_VERSION,
    filters: {
      ...baseSettings.filters,
      query: safeText(rawSettings?.filters?.query, 500),
      cities: normalizeFilterArray(rawSettings?.filters?.cities),
      clients: normalizeFilterArray(rawSettings?.filters?.clients),
      sites: normalizeFilterArray(rawSettings?.filters?.sites),
      responsibles: normalizeFilterArray(
        rawSettings?.filters?.responsibles,
        rawSettings?.filters?.responsible
      ),
      serviceTypes: normalizeFilterArray(
        rawSettings?.filters?.serviceTypes,
        rawSettings?.filters?.serviceType
      ),
      statuses: normalizeFilterArray(
        rawSettings?.filters?.statuses,
        rawSettings?.filters?.status
      ),
      planningBuckets: normalizeFilterArray(
        rawSettings?.filters?.planningBuckets,
        rawSettings?.filters?.planningBucket
      )
    }
  };
}

function validateSanitizedActivities(activities) {
  const activityIds = new Set();
  for (const activity of activities) {
    if (!activity.id || activityIds.has(activity.id)) {
      throw new TypeError("El respaldo contiene actividades sin identificador único.");
    }
    activityIds.add(activity.id);
    const errors = validateActivity(activity);
    if (errors.length) {
      throw new TypeError(`Actividad ${activity.id}: ${errors.join(" ")}`);
    }
  }
}

export function sanitizeDocument(raw, today = todayInBogota()) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TypeError("El respaldo no contiene un documento válido.");
  }
  if (Number(raw.schemaVersion ?? 1) > SCHEMA_VERSION) {
    throw new RangeError("El respaldo fue creado por una versión más reciente de la herramienta.");
  }
  const sourceSchemaVersion = Number(raw.schemaVersion ?? 1);
  const base = createDefaultDocument(today);
  const legacyUpdatedAt = safeText(raw.calendarMeta?.updatedAt, 80) || base.calendarMeta.updatedAt;
  const holidayOverrides = sanitizeHolidayOverrides(raw.holidayOverrides, legacyUpdatedAt);
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
    catalog: sanitizeCatalog(raw.catalog, legacyUpdatedAt),
    activities: sanitizeActivities(raw.activities, sourceSchemaVersion),
    series: Array.isArray(raw.series) ? raw.series.map((item) => keepAllowed(item, [
      "id", "createdAt", "updatedAt", "originalStart", "originalEnd"
    ])).map((item) => ({
      ...item,
      updatedAt: safeText(item.updatedAt, 80) || legacyUpdatedAt
    })) : [],
    settings: sanitizeSettings(raw.settings, base.settings),
    holidayOverrides,
    importMetadata: cleanImportMetadata(raw.importMetadata),
    audit: Array.isArray(raw.audit)
      ? raw.audit.slice(-500).map((item) => keepAllowed(item, ["at", "action", "detail"]))
      : []
  };

  validateSanitizedActivities(result.activities);
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

export function mergeBackupDocument(currentRaw, incomingRaw, options = {}) {
  return mergeBackupDocuments(currentRaw, incomingRaw, {
    ...options,
    sanitizeDocument,
    validateActivity,
    makeId,
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION
  });
}
