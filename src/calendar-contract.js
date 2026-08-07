import {
  ACTIVITY_STATUSES,
  APP_VERSION,
  BULK_EDIT_FIELDS,
  HOLIDAY_RULESET_VERSION,
  PLANNING_BUCKETS,
  RESPONSIBLE_TYPES,
  SCHEMA_VERSION,
  SERVICE_TYPES,
  activityIdsForScope,
  activityMatchesFilters,
  addDaysISO,
  assignQuarantineDate,
  applyBulkEdit,
  applyStatus,
  buildMonthlyCsv,
  buildQuarantineCsv,
  colombianHolidays,
  compareActivityOrder,
  compareISODate,
  createActivitiesFromRange,
  createQuarantineActivity,
  deleteActivities,
  differenceInDays,
  duplicateActivities,
  extendActivity,
  holidayMapForRange,
  isNonWorkingDate,
  isQuarantineActivity,
  makeId,
  mergeBackupDocument,
  moveActivityToQuarantine,
  moveActivities,
  normalizeText,
  parseISODate,
  reorderActivities,
  safeText,
  sanitizeDocument,
  validateActivity,
  validateHolidayOverride
} from "./core.js";

export const CONTRACT_VERSION = 1;

export const CALENDAR_OPERATIONS = Object.freeze({
  "calendar.inspect": Object.freeze({ readOnly: true, destructive: false }),
  "calendar.export-csv": Object.freeze({ readOnly: true, destructive: false }),
  "activity.list": Object.freeze({ readOnly: true, destructive: false }),
  "activity.get": Object.freeze({ readOnly: true, destructive: false }),
  "activity.create": Object.freeze({ readOnly: false, destructive: false }),
  "activity.edit": Object.freeze({ readOnly: false, destructive: false }),
  "activity.move": Object.freeze({ readOnly: false, destructive: false }),
  "activity.reorder": Object.freeze({ readOnly: false, destructive: false }),
  "activity.quarantine": Object.freeze({ readOnly: false, destructive: false }),
  "activity.assign-date": Object.freeze({ readOnly: false, destructive: false }),
  "activity.duplicate": Object.freeze({ readOnly: false, destructive: false }),
  "activity.extend": Object.freeze({ readOnly: false, destructive: false }),
  "activity.status": Object.freeze({ readOnly: false, destructive: false }),
  "activity.bulk-edit": Object.freeze({ readOnly: false, destructive: false }),
  "activity.delete": Object.freeze({ readOnly: false, destructive: true }),
  "catalog.list": Object.freeze({ readOnly: true, destructive: false }),
  "catalog.upsert": Object.freeze({ readOnly: false, destructive: false }),
  "calendar.export-quarantine-csv": Object.freeze({ readOnly: true, destructive: false }),
  "holiday.list": Object.freeze({ readOnly: true, destructive: false }),
  "holiday.add": Object.freeze({ readOnly: false, destructive: false }),
  "holiday.delete": Object.freeze({ readOnly: false, destructive: true }),
  "backup.restore": Object.freeze({ readOnly: false, destructive: true }),
  "backup.merge": Object.freeze({ readOnly: false, destructive: false })
});

export class CalendarContractError extends Error {
  constructor(code, message, details = {}, options = {}) {
    super(message, options);
    this.name = "CalendarContractError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new CalendarContractError(code, message, details);
}

function ensureObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_REQUEST", `${label} debe ser un objeto.`);
  }
  return value;
}

function allowOnly(payload, allowed) {
  const unexpected = Object.keys(payload).filter((key) => !allowed.includes(key));
  if (unexpected.length) {
    fail("INVALID_REQUEST", `Campos no admitidos: ${unexpected.join(", ")}.`, { unexpected });
  }
}

function requireText(value, label, maxLength = 160) {
  const text = safeText(value, maxLength);
  if (!text) fail("VALIDATION_FAILED", `${label} es obligatorio.`);
  return text;
}

function requireUniqueIds(value, label = "activityIds") {
  if (!Array.isArray(value) || !value.length) {
    fail("INVALID_REQUEST", `${label} debe contener al menos un identificador.`);
  }
  const ids = value.map((item) => safeText(item, 160)).filter(Boolean);
  if (ids.length !== value.length || new Set(ids).size !== ids.length) {
    fail("INVALID_REQUEST", `${label} contiene identificadores vacíos o duplicados.`);
  }
  return ids;
}

function findActivityOrThrow(document, activityId) {
  const id = requireText(activityId, "activityId", 160);
  const activity = document.activities.find((item) => item.id === id);
  if (!activity) fail("NOT_FOUND", "No se encontró la actividad indicada.", { activityId: id });
  return activity;
}

function buildCatalogLookup(document) {
  return {
    clients: new Map(document.catalog.clients.map((item) => [item.id, item])),
    sites: new Map(document.catalog.sites.map((item) => [item.id, item])),
    responsibles: new Map(document.catalog.responsibles.map((item) => [item.id, item]))
  };
}

function validateReferences(document, activity) {
  const maps = buildCatalogLookup(document);
  if (activity.clientId && !maps.clients.has(activity.clientId)) {
    fail("VALIDATION_FAILED", `El cliente ${activity.clientId} no existe en el catálogo.`, {
      field: "clientId",
      value: activity.clientId
    });
  }
  if (activity.siteId) {
    const site = maps.sites.get(activity.siteId);
    if (!site) {
      fail("VALIDATION_FAILED", `La sede ${activity.siteId} no existe en el catálogo.`, {
        field: "siteId",
        value: activity.siteId
      });
    }
    if (activity.clientId && site.clientId && site.clientId !== activity.clientId) {
      fail("VALIDATION_FAILED", "La sede no pertenece al cliente indicado.", {
        clientId: activity.clientId,
        siteId: activity.siteId
      });
    }
  }
  const missing = (activity.responsibleIds ?? []).filter((id) => !maps.responsibles.has(id));
  if (missing.length) {
    fail("VALIDATION_FAILED", `Responsables inexistentes: ${missing.join(", ")}.`, { missing });
  }
}

function buildActivityView(activity, maps) {
  return {
    id: activity.id,
    seriesId: activity.seriesId ?? null,
    date: activity.date,
    planningBucket: activity.planningBucket ?? "calendar",
    planningBucketLabel: PLANNING_BUCKETS[activity.planningBucket ?? "calendar"] ?? activity.planningBucket,
    clientId: activity.clientId ?? null,
    clientName: maps.clients.get(activity.clientId)?.name ?? null,
    siteId: activity.siteId ?? null,
    siteName: maps.sites.get(activity.siteId)?.name ?? null,
    city: activity.city ?? maps.sites.get(activity.siteId)?.city ?? null,
    responsibleIds: [...(activity.responsibleIds ?? [])],
    responsibleNames: (activity.responsibleIds ?? [])
      .map((id) => maps.responsibles.get(id)?.name)
      .filter(Boolean),
    serviceType: activity.serviceType,
    serviceLabel: SERVICE_TYPES[activity.serviceType] ?? activity.serviceType,
    status: activity.status,
    statusLabel: ACTIVITY_STATUSES[activity.status] ?? activity.status,
    sortOrder: activity.sortOrder === null || activity.sortOrder === undefined || activity.sortOrder === ""
      ? null
      : Number.isFinite(Number(activity.sortOrder)) ? Number(activity.sortOrder) : null,
    observations: activity.observations ?? "",
    createdAt: activity.createdAt ?? null,
    updatedAt: activity.updatedAt ?? null,
    completedAt: activity.completedAt ?? null
  };
}

function findNonWorkingDates(document, dates) {
  const unique = [...new Set(dates)].sort(compareISODate);
  if (!unique.length) return [];
  const holidays = holidayMapForRange(unique[0], unique.at(-1), document.holidayOverrides);
  return unique
    .filter((date) => isNonWorkingDate(date, holidays))
    .map((date) => ({
      date,
      reason: holidays.get(date)?.name ?? "Domingo"
    }));
}

function requireNonWorkingDecision(document, dates, allowed) {
  const warnings = findNonWorkingDates(document, dates);
  if (warnings.length && !allowed) {
    fail(
      "NON_WORKING_CONFIRMATION_REQUIRED",
      "La operación incluye domingos o festivos. Confirma explícitamente esas fechas.",
      { dates: warnings }
    );
  }
  return warnings.map((item) => ({
    code: "NON_WORKING_DATE",
    message: `${item.date}: ${item.reason}.`,
    details: item
  }));
}

function appendContractAudit(document, entry) {
  if (!entry) return;
  document.audit ??= [];
  document.audit.push(entry);
  if (document.audit.length > 500) document.audit.splice(0, document.audit.length - 500);
}

function finalizeMutation(source, draft, { operation, now, result, warnings, audit, revisionPolicy, appVersion }) {
  const changed = JSON.stringify(source) !== JSON.stringify(draft);
  if (!changed) {
    return {
      contractVersion: CONTRACT_VERSION,
      operation,
      changed: false,
      document: source,
      result: result ?? {},
      warnings: warnings ?? [],
      auditEntry: null
    };
  }

  if (revisionPolicy !== "preserve") {
    draft.appVersion = appVersion ?? APP_VERSION;
    draft.schemaVersion = SCHEMA_VERSION;
    draft.calendarMeta.revision = source.calendarMeta.revision + 1;
    draft.calendarMeta.updatedAt = now;
    draft.settings.holidayRuleSetVersion = HOLIDAY_RULESET_VERSION;
  }
  const auditEntry = audit
    ? { at: now, action: safeText(audit.action, 80), detail: safeText(audit.detail, 500) }
    : null;
  appendContractAudit(draft, auditEntry);
  const finalDocument = sanitizeDocument(draft, draft.settings.currentDate);
  return {
    contractVersion: CONTRACT_VERSION,
    operation,
    changed: true,
    document: finalDocument,
    result: result ?? {},
    warnings: warnings ?? [],
    auditEntry
  };
}

function inspectCalendar(document) {
  const dates = document.activities
    .map((item) => item.date)
    .filter((date) => typeof date === "string")
    .sort(compareISODate);
  return {
    calendar: structuredClone(document.calendarMeta),
    appVersion: document.appVersion,
    schemaVersion: document.schemaVersion,
    contractVersion: CONTRACT_VERSION,
    counts: {
      activities: document.activities.length,
      series: document.series.length,
      clients: document.catalog.clients.length,
      sites: document.catalog.sites.length,
      responsibles: document.catalog.responsibles.length,
      holidayOverrides: document.holidayOverrides.length
    },
    dateRange: dates.length ? { from: dates[0], to: dates.at(-1) } : null
  };
}

function listActivities(document, payload) {
  allowOnly(payload, [
    "from", "to", "clientId", "siteId", "city", "responsibleIds", "serviceTypes", "statuses", "planningBuckets", "query"
  ]);
  if (payload.from) parseISODate(payload.from);
  if (payload.to) parseISODate(payload.to);
  if (payload.from && payload.to && compareISODate(payload.to, payload.from) < 0) {
    fail("VALIDATION_FAILED", "La fecha final no puede ser anterior a la inicial.");
  }
  const maps = buildCatalogLookup(document);
  const filters = {
    query: payload.query ?? "",
    cities: payload.city ? [payload.city] : [],
    clients: payload.clientId ? [payload.clientId] : [],
    sites: payload.siteId ? [payload.siteId] : [],
    responsibles: payload.responsibleIds ?? [],
    serviceTypes: payload.serviceTypes ?? [],
    statuses: payload.statuses ?? [],
    planningBuckets: payload.planningBuckets ?? []
  };
  return document.activities
    .filter((activity) => !payload.from || (typeof activity.date === "string" && compareISODate(activity.date, payload.from) >= 0))
    .filter((activity) => !payload.to || (typeof activity.date === "string" && compareISODate(activity.date, payload.to) <= 0))
    .filter((activity) => activityMatchesFilters(activity, filters, maps))
    .sort((a, b) => {
      if (a.date === null && b.date !== null) return 1;
      if (a.date !== null && b.date === null) return -1;
      return compareISODate(a.date ?? "", b.date ?? "") || compareActivityOrder(a, b);
    })
    .map((activity) => buildActivityView(activity, maps));
}

function createActivity(document, payload, context) {
  allowOnly(payload, [
    "date", "endDate", "planningBucket", "clientId", "siteId", "city", "responsibleIds", "serviceType", "status",
    "observations", "includeNonWorking", "forceIncludeDates"
  ]);
  const planningBucket = payload.planningBucket ?? "calendar";
  if (!Object.hasOwn(PLANNING_BUCKETS, planningBucket)) {
    fail("VALIDATION_FAILED", "La bandeja de planificación no es válida.");
  }
  const input = {
    date: planningBucket === "quarantine" ? null : payload.date,
    endDate: planningBucket === "quarantine" ? null : (payload.endDate || payload.date),
    planningBucket,
    clientId: payload.clientId || null,
    siteId: payload.siteId || null,
    city: safeText(payload.city, 120) || null,
    responsibleIds: [...new Set((payload.responsibleIds ?? []).map(String).filter(Boolean))],
    serviceType: payload.serviceType,
    status: payload.status ?? (planningBucket === "quarantine" ? "to_schedule" : "scheduled"),
    observations: safeText(payload.observations, 5000),
    includeNonWorking: Boolean(payload.includeNonWorking),
    forceIncludeDates: payload.forceIncludeDates ?? []
  };
  if (planningBucket === "quarantine") {
    if (payload.date !== undefined && payload.date !== null) {
      fail("VALIDATION_FAILED", "Una actividad Pendiente debe crearse sin fecha.");
    }
    if (payload.endDate !== undefined && payload.endDate !== null) {
      fail("VALIDATION_FAILED", "Una actividad Pendiente debe crearse sin fecha final.");
    }
    if (input.status !== "to_schedule") {
      fail("VALIDATION_FAILED", "Una actividad Pendiente debe tener estado Por programar.");
    }
    const referenceCandidate = { ...input, date: null, endDate: null, status: "to_schedule" };
    const errors = validateActivity(referenceCandidate);
    if (errors.length) fail("VALIDATION_FAILED", [...new Set(errors)].join(" "));
    validateReferences(document, referenceCandidate);
    const activity = createQuarantineActivity(input, context);
    document.activities.push(activity);
    return {
      result: { activityIds: [activity.id], seriesId: null, omittedDates: [] },
      warnings: [],
      audit: { action: "activity_created", detail: "Pendiente creado" }
    };
  }
  const referenceCandidate = { ...input, date: input.date };
  const errors = validateActivity(referenceCandidate);
  if (errors.length) fail("VALIDATION_FAILED", [...new Set(errors)].join(" "));
  validateReferences(document, referenceCandidate);
  const holidays = holidayMapForRange(input.date, input.endDate, document.holidayOverrides);
  const generated = createActivitiesFromRange(input, holidays, context);
  if (!generated.activities.length) {
    fail("VALIDATION_FAILED", "El rango no contiene fechas programables.", { omitted: generated.omitted });
  }
  document.activities.push(...generated.activities);
  if (generated.series) document.series.push(generated.series);
  return {
    result: {
      activityIds: generated.activities.map((item) => item.id),
      seriesId: generated.series?.id ?? null,
      omittedDates: generated.omitted
    },
    warnings: generated.omitted.map((item) => ({
      code: "NON_WORKING_DATE_OMITTED",
      message: `${item.date}: ${item.reason}.`,
      details: item
    })),
    audit: {
      action: "activity_created",
      detail: `${generated.activities.length} tarjeta(s) creada(s)`
    }
  };
}

function editActivity(document, payload, now) {
  allowOnly(payload, ["activityId", "patch", "commonScope", "statusScope", "allowNonWorking"]);
  const existing = findActivityOrThrow(document, payload.activityId);
  const patch = ensureObject(payload.patch, "patch");
  allowOnly(patch, [
    "date", "planningBucket", "clientId", "siteId", "city", "responsibleIds", "serviceType", "status", "observations"
  ]);
  if (!Object.keys(patch).length) fail("INVALID_REQUEST", "patch no contiene cambios.");
  const commonScope = payload.commonScope ?? "single";
  const statusScope = payload.statusScope ?? "single";
  if (!["single", "series"].includes(commonScope)) fail("INVALID_REQUEST", "commonScope no es válido.");
  if (!["single", "future", "series"].includes(statusScope)) fail("INVALID_REQUEST", "statusScope no es válido.");
  if (!existing.seriesId && (commonScope !== "single" || statusScope !== "single")) {
    fail("INVALID_REQUEST", "Una actividad sin serie solo admite alcance single.");
  }

  const targetBucket = patch.planningBucket ?? existing.planningBucket ?? "calendar";
  if (!Object.hasOwn(PLANNING_BUCKETS, targetBucket)) {
    fail("VALIDATION_FAILED", "La bandeja de planificación no es válida.");
  }
  if (targetBucket === "quarantine") {
    if (existing.seriesId) {
      fail("INVALID_REQUEST", "Una actividad de varios días debe enviarse a Pendiente desde su acción específica.");
    }
    if (patch.date !== undefined && patch.date !== null) {
      fail("VALIDATION_FAILED", "Una actividad Pendiente debe quedar sin fecha.");
    }
    if (patch.status !== undefined && patch.status !== "to_schedule") {
      fail("VALIDATION_FAILED", "Una actividad Pendiente debe tener estado Por programar.");
    }
  }
  const targetDate = Object.hasOwn(patch, "date") ? patch.date : existing.date;
  const warnings = targetBucket === "calendar" && targetDate
    ? requireNonWorkingDecision(document, [targetDate], payload.allowNonWorking)
    : [];
  const commonFields = ["clientId", "siteId", "city", "responsibleIds", "serviceType", "observations"];
  const commonPatch = Object.fromEntries(commonFields.filter((field) => Object.hasOwn(patch, field)).map((field) => [field, patch[field]]));
  if (Object.hasOwn(commonPatch, "city")) commonPatch.city = safeText(commonPatch.city, 120) || null;
  if (Object.hasOwn(commonPatch, "observations")) commonPatch.observations = safeText(commonPatch.observations, 5000);
  if (Object.hasOwn(commonPatch, "responsibleIds")) {
    commonPatch.responsibleIds = [...new Set((commonPatch.responsibleIds ?? []).map(String).filter(Boolean))];
  }
  const commonIds = new Set(activityIdsForScope(document, existing.id, commonScope));
  const statusIds = new Set(activityIdsForScope(document, existing.id, statusScope));
  const drafts = document.activities.map((activity) => {
    const draft = structuredClone(activity);
    if (commonIds.has(activity.id)) Object.assign(draft, commonPatch);
    if (activity.id === existing.id) {
      if (Object.hasOwn(patch, "date")) draft.date = patch.date;
      if (Object.hasOwn(patch, "planningBucket")) draft.planningBucket = targetBucket;
      if (targetBucket === "quarantine") {
        draft.date = null;
        draft.planningBucket = "quarantine";
        draft.status = "to_schedule";
        draft.seriesId = null;
        draft.completedAt = null;
      } else if (existing.planningBucket === "quarantine") {
        draft.planningBucket = "calendar";
        draft.seriesId = null;
        if (!Object.hasOwn(patch, "status")) draft.status = "scheduled";
        draft.completedAt = draft.status === "completed" ? (draft.completedAt || now) : null;
      }
    }
    if (statusIds.has(activity.id) && Object.hasOwn(patch, "status")) {
      draft.status = patch.status;
      draft.completedAt = patch.status === "completed" ? (draft.completedAt || now) : null;
    }
    return draft;
  });
  for (const draft of drafts) {
    const errors = validateActivity(draft);
    if (errors.length) fail("VALIDATION_FAILED", errors.join(" "), { activityId: draft.id });
    if (commonIds.has(draft.id) || draft.id === existing.id) validateReferences(document, draft);
  }
  const changedIds = [];
  for (let index = 0; index < document.activities.length; index += 1) {
    const activity = document.activities[index];
    const draft = drafts[index];
    const previousDate = activity.date;
    const previousStatus = activity.status;
    const previousBucket = activity.planningBucket ?? "calendar";
    const commonChanged = commonIds.has(activity.id) && commonFields.some(
      (field) => JSON.stringify(activity[field] ?? null) !== JSON.stringify(draft[field] ?? null)
    );
    const dateChanged = activity.id === existing.id && previousDate !== draft.date;
    const statusChanged = statusIds.has(activity.id) && previousStatus !== draft.status;
    const bucketChanged = activity.id === existing.id && previousBucket !== draft.planningBucket;
    if (!commonChanged && !dateChanged && !statusChanged && !bucketChanged) continue;
    Object.assign(activity, draft, { updatedAt: now });
    activity.history ??= [];
    if (commonChanged) activity.history.push({
      at: now,
      action: "edited",
      detail: commonScope === "series" ? "Datos comunes editados en toda la actividad" : "Datos editados sólo para este día",
      scope: commonScope
    });
    if (bucketChanged) activity.history.push({
      at: now,
      action: "planning_bucket_changed",
      detail: `${PLANNING_BUCKETS[previousBucket]} → ${PLANNING_BUCKETS[draft.planningBucket]}`,
      scope: "single"
    });
    if (dateChanged) activity.history.push({
      at: now,
      action: "rescheduled",
      detail: `${previousDate} → ${draft.date}`,
      mode: "single"
    });
    if (statusChanged) activity.history.push({
      at: now,
      action: "status_changed",
      detail: `${ACTIVITY_STATUSES[previousStatus]} → ${ACTIVITY_STATUSES[draft.status]}`,
      scope: statusScope
    });
    changedIds.push(activity.id);
  }
  return {
    result: { activityIds: changedIds, fields: Object.keys(patch) },
    warnings,
    audit: { action: "activity_edited", detail: `${changedIds.length} tarjeta(s) actualizada(s)` }
  };
}

function movementDates(document, ids, targetDate, anchorId, mode) {
  const selected = document.activities.filter((item) => ids.includes(item.id));
  if (selected.length !== ids.length) fail("NOT_FOUND", "Una o más actividades no existen.");
  const anchor = selected.find((item) => item.id === anchorId);
  if (!anchor) fail("INVALID_REQUEST", "La actividad de referencia no pertenece a la selección.");
  const delta = differenceInDays(anchor.date, targetDate);
  return selected.map((item) => mode === "same" ? targetDate : addDaysISO(item.date, delta));
}

function listCatalog(document, payload) {
  allowOnly(payload, ["type", "active", "query"]);
  const type = payload.type;
  const collectionName = type === "client" ? "clients" : type === "site" ? "sites" : type === "responsible" ? "responsibles" : null;
  if (!collectionName) fail("INVALID_REQUEST", "type debe ser client, site o responsible.");
  const query = normalizeText(payload.query);
  return document.catalog[collectionName]
    .filter((item) => payload.active === undefined || (item.active !== false) === Boolean(payload.active))
    .filter((item) => !query || normalizeText(Object.values(item).flat().join(" ")).includes(query))
    .sort((a, b) => safeText(a.name).localeCompare(safeText(b.name), "es"))
    .map((item) => structuredClone(item));
}

function contractInitialsFor(name) {
  return safeText(name, 160)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function upsertCatalog(document, payload, context) {
  allowOnly(payload, ["type", "id", "values"]);
  const values = ensureObject(payload.values, "values");
  const now = context.now;
  const config = payload.type === "client"
    ? { collection: "clients", prefix: "cliente", fields: ["name", "active"] }
    : payload.type === "site"
      ? { collection: "sites", prefix: "sede", fields: ["clientId", "name", "city", "zone", "shoppingCenter", "address", "entryConditions", "requiresApp", "active"] }
      : payload.type === "responsible"
        ? { collection: "responsibles", prefix: "responsable", fields: ["name", "responsibleType", "company", "baseCity", "group", "initials", "coverage", "favorite", "active"] }
        : null;
  if (!config) fail("INVALID_REQUEST", "type debe ser client, site o responsible.");
  allowOnly(values, config.fields);
  const collection = document.catalog[config.collection];
  const existing = payload.id ? collection.find((item) => item.id === payload.id) : null;
  if (payload.id && !existing) fail("NOT_FOUND", "No se encontró el registro del catálogo.", { id: payload.id });
  const id = existing?.id ?? makeId(config.prefix, context.idFactory);
  const next = existing ? structuredClone(existing) : {
    id,
    sourceKey: `manual:${id}`,
    source: "manual",
    active: true
  };
  if (payload.type === "client") {
    if (Object.hasOwn(values, "name") || !existing) next.name = requireText(values.name ?? next.name, "name");
    if (Object.hasOwn(values, "active")) next.active = Boolean(values.active);
  } else if (payload.type === "site") {
    if (Object.hasOwn(values, "clientId") || !existing) {
      next.clientId = requireText(values.clientId ?? next.clientId, "clientId");
      if (!document.catalog.clients.some((item) => item.id === next.clientId)) {
        fail("VALIDATION_FAILED", "El cliente indicado para la sede no existe.", { clientId: next.clientId });
      }
    }
    if (Object.hasOwn(values, "name") || !existing) next.name = requireText(values.name ?? next.name, "name");
    for (const [field, maxLength] of [["city", 120], ["zone", 120], ["shoppingCenter", 160], ["address", 240], ["entryConditions", 1000]]) {
      if (Object.hasOwn(values, field)) next[field] = safeText(values[field], maxLength) || null;
    }
    if (Object.hasOwn(values, "requiresApp")) next.requiresApp = Boolean(values.requiresApp);
    if (Object.hasOwn(values, "active")) next.active = Boolean(values.active);
  } else {
    if (Object.hasOwn(values, "name") || !existing) next.name = requireText(values.name ?? next.name, "name");
    if (Object.hasOwn(values, "responsibleType") || !existing) {
      next.responsibleType = values.responsibleType ?? next.responsibleType ?? "payroll";
      if (!Object.hasOwn(RESPONSIBLE_TYPES, next.responsibleType)) fail("VALIDATION_FAILED", "responsibleType no es válido.");
    }
    for (const [field, maxLength] of [["company", 160], ["baseCity", 120], ["group", 120]]) {
      if (Object.hasOwn(values, field)) next[field] = safeText(values[field], maxLength) || null;
    }
    if (Object.hasOwn(values, "initials") || !existing) {
      next.initials = safeText(values.initials, 5).toUpperCase() || contractInitialsFor(next.name);
    }
    if (Object.hasOwn(values, "coverage")) {
      next.coverage = [...new Set((values.coverage ?? []).map((item) => safeText(item, 120)).filter(Boolean))];
    }
    if (Object.hasOwn(values, "favorite")) next.favorite = Boolean(values.favorite);
    if (Object.hasOwn(values, "active")) next.active = Boolean(values.active);
  }
  const comparableCurrent = existing ? { ...existing, updatedAt: null } : null;
  const comparableNext = { ...next, updatedAt: null };
  if (existing && JSON.stringify(comparableCurrent) === JSON.stringify(comparableNext)) {
    return { result: { type: payload.type, itemId: id, created: false, item: structuredClone(existing) } };
  }
  next.updatedAt = now;
  if (existing) Object.assign(existing, next);
  else collection.push(next);
  return {
    result: { type: payload.type, itemId: id, created: !existing, item: structuredClone(next) },
    audit: { action: "catalog_saved", detail: existing ? "Registro del catálogo actualizado" : "Registro agregado al catálogo" }
  };
}

function listHolidays(document, payload) {
  allowOnly(payload, ["year", "from", "to"]);
  if (payload.year !== undefined) {
    const year = Number(payload.year);
    if (!Number.isInteger(year) || year < 1900 || year > 9999) fail("VALIDATION_FAILED", "year no es válido.");
    return colombianHolidays(year, document.holidayOverrides);
  }
  if (!payload.from || !payload.to) fail("INVALID_REQUEST", "Indica year o el rango from/to.");
  const map = holidayMapForRange(payload.from, payload.to, document.holidayOverrides);
  return [...map.values()].filter((item) => compareISODate(item.date, payload.from) >= 0 && compareISODate(item.date, payload.to) <= 0);
}

function executeCalendarHandler(operation, document, payload) {
  if (operation === "calendar.inspect") return { result: inspectCalendar(document) };
  if (operation === "calendar.export-csv") {
    allowOnly(payload, ["year", "month"]);
    const year = Number(payload.year);
    const month = Number(payload.month);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      fail("VALIDATION_FAILED", "El año o mes no es válido.");
    }
    return {
      result: {
        content: buildMonthlyCsv(document, year, month),
        mimeType: "text/csv;charset=utf-8",
        fileName: `${year}-${String(month).padStart(2, "0")}_programacion.csv`
      }
    };
  }
  if (operation === "calendar.export-quarantine-csv") {
    allowOnly(payload, []);
    return {
      result: {
        content: buildQuarantineCsv(document),
        mimeType: "text/csv;charset=utf-8",
        fileName: "pendientes.csv"
      }
    };
  }
}

function executeActivityHandler(operation, document, payload, context) {
  if (operation === "activity.list") return { result: { items: listActivities(document, payload) } };
  if (operation === "activity.get") {
    allowOnly(payload, ["activityId"]);
    return {
      result: buildActivityView(
        findActivityOrThrow(document, payload.activityId),
        buildCatalogLookup(document)
      )
    };
  }
  if (operation === "activity.create") return createActivity(document, payload, context);
  if (operation === "activity.edit") return editActivity(document, payload, context.now);
  if (operation === "activity.quarantine") {
    allowOnly(payload, ["activityId", "scope"]);
    const scope = payload.scope ?? "single";
    const moved = moveActivityToQuarantine(document, payload.activityId, scope, context.now);
    return {
      result: {
        activityId: moved.activity.id,
        removedActivityIds: moved.removed.map((item) => item.id),
        scope: moved.scope
      },
      audit: {
        action: "activity_quarantined",
        detail: scope === "series" ? "Toda la actividad pasó a Pendiente" : "Una fecha pasó a Pendiente"
      }
    };
  }
  if (operation === "activity.assign-date") {
    allowOnly(payload, ["activityId", "targetDate", "allowNonWorking"]);
    const targetDate = requireText(payload.targetDate, "targetDate", 10);
    parseISODate(targetDate);
    const holidays = holidayMapForRange(targetDate, targetDate, document.holidayOverrides);
    const warnings = requireNonWorkingDecision(document, [targetDate], payload.allowNonWorking);
    const assigned = assignQuarantineDate(document, payload.activityId, targetDate, holidays, {
      allowNonWorking: Boolean(payload.allowNonWorking),
      now: context.now
    });
    return {
      result: { activityId: assigned.id, date: assigned.date, status: assigned.status },
      warnings,
      audit: { action: "quarantine_assigned", detail: "Pendiente devuelto al calendario" }
    };
  }
  if (operation === "activity.reorder") {
    allowOnly(payload, ["activityIds", "targetId", "targetDate", "position"]);
    const ids = requireUniqueIds(payload.activityIds);
    const position = payload.position ?? "after";
    if (!["first", "last", "before", "after"].includes(position)) {
      fail("INVALID_REQUEST", "position no es válida.");
    }
    const targetId = payload.targetId ? requireText(payload.targetId, "targetId", 160) : null;
    const targetDate = payload.targetDate ? requireText(payload.targetDate, "targetDate", 10) : null;
    if (targetDate) parseISODate(targetDate);
    const orderedIds = reorderActivities(document, ids, {
      targetId,
      targetDate,
      position,
      now: context.now
    });
    return {
      result: {
        activityIds: ids,
        date: document.activities.find((activity) => ids.includes(activity.id))?.date ?? targetDate,
        order: orderedIds
      },
      audit: { action: "activities_reordered", detail: `${ids.length} tarjeta(s) reordenada(s)` }
    };
  }
  if (operation === "activity.move" || operation === "activity.duplicate") {
    allowOnly(payload, operation === "activity.move"
      ? ["activityIds", "targetDate", "anchorId", "mode", "allowNonWorking"]
      : ["activityIds", "targetDate", "anchorId", "allowNonWorking"]);
    const ids = requireUniqueIds(payload.activityIds);
    const targetDate = requireText(payload.targetDate, "targetDate", 10);
    parseISODate(targetDate);
    const mode = operation === "activity.move" ? (payload.mode ?? "preserve") : "preserve";
    if (!['preserve', 'same'].includes(mode)) fail("INVALID_REQUEST", "mode no es válido.");
    const anchorId = payload.anchorId ?? ids[0];
    if (document.activities.some((activity) => ids.includes(activity.id) && isQuarantineActivity(activity))) {
      fail("VALIDATION_FAILED", "Una actividad Pendiente debe asignarse desde la bandeja antes de moverla.");
    }
    const dates = movementDates(document, ids, targetDate, anchorId, mode);
    const warnings = requireNonWorkingDecision(document, dates, payload.allowNonWorking);
    if (operation === "activity.move") {
      const moves = moveActivities(document, ids, targetDate, { anchorId, mode, now: context.now });
      return {
        result: { moves },
        warnings,
        audit: { action: "activities_moved", detail: `${moves.length} tarjeta(s) movida(s)` }
      };
    }
    const copies = duplicateActivities(document, ids, targetDate, {
      anchorId,
      idFactory: context.idFactory,
      now: context.now
    });
    return {
      result: { activityIds: copies.map((item) => item.id) },
      warnings,
      audit: { action: "activities_duplicated", detail: `${copies.length} tarjeta(s) duplicada(s)` }
    };
  }
  if (operation === "activity.extend") {
    allowOnly(payload, ["activityId", "targetDate", "allowNonWorking"]);
    const targetDate = requireText(payload.targetDate, "targetDate", 10);
    parseISODate(targetDate);
    findActivityOrThrow(document, payload.activityId);
    const warnings = requireNonWorkingDecision(document, [targetDate], payload.allowNonWorking);
    const extended = extendActivity(document, payload.activityId, targetDate, context);
    return {
      result: { activityId: extended?.id ?? null, seriesId: extended?.seriesId ?? null },
      warnings,
      audit: { action: "activity_extended", detail: extended ? "Actividad ampliada a otro día" : "Sin cambios" }
    };
  }
  if (operation === "activity.status") {
    allowOnly(payload, ["activityId", "status", "scope"]);
    const targetIds = activityIdsForScope(document, payload.activityId, payload.scope ?? "single");
    if (!targetIds.length) fail("NOT_FOUND", "No se encontró la actividad indicada.");
    if (targetIds.every((id) => document.activities.find((item) => item.id === id)?.status === payload.status)) {
      return { result: { activityIds: [], status: payload.status } };
    }
    const ids = applyStatus(document, payload.activityId, payload.status, payload.scope ?? "single", context.now);
    return {
      result: { activityIds: ids, status: payload.status },
      audit: { action: "status_changed", detail: `Estado actualizado en ${ids.length} tarjeta(s)` }
    };
  }
  if (operation === "activity.bulk-edit") {
    allowOnly(payload, ["activityIds", "field", "value", "mode"]);
    const ids = requireUniqueIds(payload.activityIds);
    const before = structuredClone(document.activities);
    applyBulkEdit(document, ids, payload.field, payload.value, { mode: payload.mode ?? "replace", now: context.now });
    const businessValue = (activity) => {
      const copy = structuredClone(activity);
      delete copy.updatedAt;
      delete copy.history;
      return copy;
    };
    const byIdBefore = new Map(before.map((item) => [item.id, item]));
    const hasBusinessChange = ids.some((id) => JSON.stringify(businessValue(byIdBefore.get(id))) !== JSON.stringify(
      businessValue(document.activities.find((item) => item.id === id))
    ));
    if (!hasBusinessChange) document.activities = before;
    return {
      result: { activityIds: ids, field: payload.field, mode: payload.mode ?? "replace" },
      audit: { action: "activities_bulk_edited", detail: `${BULK_EDIT_FIELDS[payload.field]} actualizado en ${ids.length} tarjeta(s)` }
    };
  }
  if (operation === "activity.delete") {
    allowOnly(payload, ["activityIds"]);
    const removed = deleteActivities(document, requireUniqueIds(payload.activityIds));
    return {
      result: { activityIds: removed.map((item) => item.id) },
      audit: { action: "activities_deleted", detail: `${removed.length} tarjeta(s) eliminada(s)` }
    };
  }
}

function executeCatalogHandler(operation, document, payload, context) {
  if (operation === "catalog.list") return { result: { items: listCatalog(document, payload) } };
  if (operation === "catalog.upsert") return upsertCatalog(document, payload, context);
}

function executeHolidayHandler(operation, document, payload, context) {
  if (operation === "holiday.list") return { result: { items: listHolidays(document, payload) } };
  if (operation === "holiday.add") {
    allowOnly(payload, ["date", "type", "name", "reason"]);
    const override = {
      id: makeId("festivo", context.idFactory),
      date: payload.date,
      type: payload.type,
      name: safeText(payload.name, 120),
      reason: safeText(payload.reason, 500),
      active: true,
      createdAt: context.now,
      updatedAt: context.now
    };
    const errors = validateHolidayOverride(override);
    if (errors.length) fail("VALIDATION_FAILED", errors.join(" "));
    if (document.holidayOverrides.some((item) => item.active !== false && item.date === override.date)) {
      fail("CONFLICT", "Ya existe una excepción activa para esta fecha.", { date: override.date });
    }
    document.holidayOverrides.push(override);
    return {
      result: { overrideId: override.id },
      audit: { action: "holiday_override_added", detail: "Excepción de calendario agregada" }
    };
  }
  if (operation === "holiday.delete") {
    allowOnly(payload, ["overrideId"]);
    const id = requireText(payload.overrideId, "overrideId");
    const found = document.holidayOverrides.find((item) => item.id === id);
    if (!found) fail("NOT_FOUND", "No se encontró la excepción indicada.", { overrideId: id });
    document.holidayOverrides = document.holidayOverrides.filter((item) => item.id !== id);
    return {
      result: { overrideId: id },
      audit: { action: "holiday_override_deleted", detail: "Excepción eliminada" }
    };
  }
}

function executeBackupHandler(operation, document, payload) {
  if (operation === "backup.restore") {
    allowOnly(payload, ["document"]);
    const restored = sanitizeDocument(payload.document);
    Object.keys(document).forEach((key) => delete document[key]);
    Object.assign(document, restored);
    return {
      result: { sourceRevision: restored.calendarMeta.revision, counts: inspectCalendar(restored).counts },
      audit: { action: "backup_restored", detail: "Respaldo JSON restaurado" },
      revisionPolicy: "preserve"
    };
  }
  if (operation === "backup.merge") {
    allowOnly(payload, ["document"]);
    const merged = mergeBackupDocument(document, payload.document);
    Object.keys(document).forEach((key) => delete document[key]);
    Object.assign(document, merged.document);
    return {
      result: { counts: merged.counts, details: merged.details },
      warnings: merged.warnings.map((message) => ({ code: "MERGE_WARNING", message, details: {} })),
      audit: {
        action: "backup_merged",
        detail: `${merged.counts.added} registros añadidos y ${merged.counts.updated} actualizados desde JSON`
      }
    };
  }
}

function executeOperationHandler(operation, document, payload, context) {
  const handlers = {
    calendar: executeCalendarHandler,
    activity: executeActivityHandler,
    catalog: executeCatalogHandler,
    holiday: executeHolidayHandler,
    backup: executeBackupHandler
  };
  const handler = handlers[operation.split(".", 1)[0]];
  if (!handler) fail("INVALID_REQUEST", `Operación no implementada: ${operation}.`);
  return handler(operation, document, payload, context);
}

export function executeCalendarOperation(document, request, options = {}) {
  let documentValidated = false;
  try {
    const normalizedRequest = ensureObject(request, "request");
    allowOnly(normalizedRequest, ["operation", "payload"]);
    const operation = requireText(normalizedRequest.operation, "operation", 80);
    const definition = CALENDAR_OPERATIONS[operation];
    if (!definition) fail("INVALID_REQUEST", `Operación desconocida: ${operation}.`);
    const payload = normalizedRequest.payload === undefined ? {} : ensureObject(normalizedRequest.payload, "payload");
    const source = sanitizeDocument(document);
    documentValidated = true;
    const draft = structuredClone(source);
    const context = {
      now: options.now ?? new Date().toISOString(),
      idFactory: options.idFactory ?? (() => crypto.randomUUID())
    };
    const outcome = executeOperationHandler(operation, draft, payload, context);
    if (definition.readOnly) {
      return {
        contractVersion: CONTRACT_VERSION,
        operation,
        changed: false,
        document: source,
        result: outcome.result ?? {},
        warnings: outcome.warnings ?? [],
        auditEntry: null
      };
    }
    return finalizeMutation(source, draft, {
      operation,
      now: context.now,
      result: outcome.result,
      warnings: outcome.warnings,
      audit: outcome.audit,
      revisionPolicy: outcome.revisionPolicy,
      appVersion: options.appVersion
    });
  } catch (error) {
    if (error instanceof CalendarContractError) throw error;
    if (error instanceof TypeError || error instanceof RangeError || error instanceof SyntaxError) {
      const unsupported = /versi[oó]n|schema/i.test(error.message);
      const code = !documentValidated
        ? (unsupported ? "UNSUPPORTED_SCHEMA" : "INVALID_DOCUMENT")
        : "VALIDATION_FAILED";
      throw new CalendarContractError(code, error.message, {}, { cause: error });
    }
    throw new CalendarContractError("INTERNAL_ERROR", "La operación no pudo completarse.", {}, { cause: error });
  }
}
