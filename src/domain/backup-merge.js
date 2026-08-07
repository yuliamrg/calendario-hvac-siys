import { normalizeText, safeText } from "./text.js";

function mergeComparable(record) {
  if (!record || typeof record !== "object") return "";
  const copy = structuredClone(record);
  for (const field of ["id", "sourceKey", "createdAt", "updatedAt", "history"]) {
    delete copy[field];
  }
  const canonical = (value) => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.keys(value).sort().map((key) => [key, canonical(value[key])])
      );
    }
    return value;
  };
  return JSON.stringify(canonical(copy));
}

function timestampValue(value) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function mergeNaturalKey(collection, item) {
  if (collection === "cities" || collection === "clients") {
    return normalizeText(item.name);
  }
  if (collection === "sites") {
    return [
      item.clientId ?? "",
      normalizeText(item.name),
      normalizeText(item.city)
    ].join("|");
  }
  if (collection === "responsibles") {
    return [
      normalizeText(item.name),
      item.responsibleType ?? "",
      normalizeText(item.company)
    ].join("|");
  }
  if (collection === "holidayOverrides") {
    return `${item.date}|${item.type ?? (item.action === "remove" ? "allow-scheduling" : "manual-closure")}`;
  }
  return "";
}

export function mergeBackupDocuments(
  currentRaw,
  incomingRaw,
  {
    now = new Date().toISOString(),
    sanitizeDocument,
    validateActivity,
    makeId,
    schemaVersion,
    appVersion
  }
) {
  const current = sanitizeDocument(currentRaw);
  const incoming = sanitizeDocument(incomingRaw, current.settings.currentDate);
  const document = structuredClone(current);
  const counts = {
    added: 0,
    updated: 0,
    skipped: 0,
    conflicts: 0,
    byCollection: {}
  };
  const warnings = [];
  const details = [];
  const maps = {
    cities: new Map(),
    clients: new Map(),
    sites: new Map(),
    responsibles: new Map(),
    series: new Map()
  };

  const recordResult = (collection, result, label, reason = "") => {
    counts[result] += 1;
    counts.byCollection[collection] ??= { added: 0, updated: 0, skipped: 0, conflicts: 0 };
    counts.byCollection[collection][result] += 1;
    details.push({ collection, result, label: safeText(label, 240), reason: safeText(reason, 500) });
  };

  const mergeCollection = (
    collection,
    localItems,
    incomingItems,
    { transform = (item) => item, validate = () => null } = {}
  ) => {
    const mapping = maps[collection] ?? new Map();
    for (const rawItem of incomingItems) {
      const importedId = safeText(rawItem.id, 160);
      const item = transform(structuredClone(rawItem));
      const natural = mergeNaturalKey(collection, item);
      let match = importedId
        ? localItems.find((candidate) => candidate.id === importedId)
        : null;
      if (!match && item.sourceKey) {
        match = localItems.find((candidate) => candidate.sourceKey === item.sourceKey);
      }
      if (!match && natural) {
        match = localItems.find((candidate) => mergeNaturalKey(collection, candidate) === natural);
      }
      if (!match) {
        match = localItems.find((candidate) => mergeComparable(candidate) === mergeComparable(item));
      }

      const validationError = validate(item, match);
      if (validationError) {
        recordResult(collection, "conflicts", item.name || item.date || importedId, validationError);
        warnings.push(`${collection}: ${validationError}`);
        continue;
      }

      if (!match) {
        if (!item.id) item.id = makeId(collection.slice(0, -1) || "registro");
        item.updatedAt = safeText(item.updatedAt, 80) || now;
        localItems.push(item);
        if (importedId) mapping.set(importedId, item.id);
        recordResult(collection, "added", item.name || item.date || item.id);
        continue;
      }

      if (importedId) mapping.set(importedId, match.id);
      const candidate = { ...item, id: match.id };
      if (mergeComparable(match) === mergeComparable(candidate)) {
        recordResult(collection, "skipped", match.name || match.date || match.id, "Registro idéntico");
        continue;
      }
      const incomingTime = timestampValue(item.updatedAt);
      const currentTime = timestampValue(match.updatedAt);
      if (incomingTime > currentTime) {
        const index = localItems.indexOf(match);
        localItems[index] = candidate;
        recordResult(collection, "updated", match.name || match.date || match.id, "El registro importado es más reciente");
      } else {
        const reason = incomingTime === currentTime
          ? "Misma fecha de actualización; se conservó el registro actual"
          : "El registro actual es más reciente";
        recordResult(collection, "conflicts", match.name || match.date || match.id, reason);
      }
    }
    return mapping;
  };

  mergeCollection("cities", document.catalog.cities, incoming.catalog.cities);
  mergeCollection("clients", document.catalog.clients, incoming.catalog.clients);
  mergeCollection("sites", document.catalog.sites, incoming.catalog.sites, {
    transform: (item) => ({
      ...item,
      clientId: maps.clients.get(item.clientId) ?? item.clientId
    }),
    validate: (item) => (
      item.clientId && !document.catalog.clients.some((client) => client.id === item.clientId)
        ? `No se encontró el cliente relacionado con la sede ${item.name || item.id}.`
        : null
    )
  });
  mergeCollection("responsibles", document.catalog.responsibles, incoming.catalog.responsibles);
  mergeCollection("series", document.series, incoming.series);

  mergeCollection(
    "holidayOverrides",
    document.holidayOverrides,
    incoming.holidayOverrides,
    {
      validate: (item, match) => {
        const collision = document.holidayOverrides.find((candidate) => (
          candidate !== match &&
          candidate.active !== false &&
          item.active !== false &&
          candidate.date === item.date
        ));
        return collision ? `Ya existe una excepción activa para ${item.date}.` : null;
      }
    }
  );

  const activityFingerprint = (activity) => mergeComparable({
    ...activity,
    seriesId: activity.seriesId ?? null,
    responsibleIds: [...(activity.responsibleIds ?? [])].sort()
  });
  for (const rawActivity of incoming.activities) {
    const importedId = safeText(rawActivity.id, 160);
    const activity = {
      ...structuredClone(rawActivity),
      clientId: maps.clients.get(rawActivity.clientId) ?? rawActivity.clientId,
      siteId: maps.sites.get(rawActivity.siteId) ?? rawActivity.siteId,
      responsibleIds: (rawActivity.responsibleIds ?? []).map(
        (id) => maps.responsibles.get(id) ?? id
      ),
      seriesId: maps.series.get(rawActivity.seriesId) ?? rawActivity.seriesId
    };
    let match = document.activities.find((candidate) => candidate.id === importedId);
    if (!match) {
      match = document.activities.find(
        (candidate) => activityFingerprint(candidate) === activityFingerprint(activity)
      );
    }
    const missing = [];
    if (activity.clientId && !document.catalog.clients.some((item) => item.id === activity.clientId)) {
      missing.push("cliente");
    }
    if (activity.siteId && !document.catalog.sites.some((item) => item.id === activity.siteId)) {
      missing.push("sede");
    }
    if ((activity.responsibleIds ?? []).some(
      (id) => !document.catalog.responsibles.some((item) => item.id === id)
    )) {
      missing.push("responsable");
    }
    if (activity.seriesId && !document.series.some((item) => item.id === activity.seriesId)) {
      missing.push("serie");
    }
    const activityErrors = validateActivity(activity);
    if (missing.length || activityErrors.length) {
      const reason = [
        missing.length ? `Faltan referencias: ${missing.join(", ")}` : "",
        ...activityErrors
      ].filter(Boolean).join(". ");
      recordResult("activities", "conflicts", importedId || activity.date, reason);
      warnings.push(`Actividad ${importedId || activity.date}: ${reason}`);
      continue;
    }
    if (!match) {
      document.activities.push(activity);
      recordResult("activities", "added", activity.id);
      continue;
    }
    if (activityFingerprint(match) === activityFingerprint(activity)) {
      recordResult("activities", "skipped", match.id, "Actividad idéntica");
      continue;
    }
    if (timestampValue(activity.updatedAt) > timestampValue(match.updatedAt)) {
      const index = document.activities.indexOf(match);
      document.activities[index] = { ...activity, id: match.id };
      recordResult("activities", "updated", match.id, "La actividad importada es más reciente");
    } else {
      const reason = timestampValue(activity.updatedAt) === timestampValue(match.updatedAt)
        ? "Misma fecha de actualización; se conservó la actividad actual"
        : "La actividad actual es más reciente";
      recordResult("activities", "conflicts", match.id, reason);
    }
  }

  const usedSeries = new Set(document.activities.map((item) => item.seriesId).filter(Boolean));
  document.series = document.series.filter((item) => usedSeries.has(item.id));
  document.schemaVersion = schemaVersion;
  document.appVersion = appVersion;
  document.calendarMeta = structuredClone(current.calendarMeta);
  document.settings = structuredClone(current.settings);
  document.importMetadata = structuredClone(current.importMetadata);
  document.audit = structuredClone(current.audit);

  return {
    document: sanitizeDocument(document, current.settings.currentDate),
    counts,
    warnings,
    details
  };
}
