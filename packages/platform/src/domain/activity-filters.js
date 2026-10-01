import { ACTIVITY_STATUSES, PLANNING_BUCKETS, SERVICE_TYPES } from "./calendar-enums.js";
import { compareISODate } from "./dates.js";
import { normalizeText, safeText } from "./text.js";

export function cleanStringArray(value, maxLength = 160, maxItems = 200) {
  if (!Array.isArray(value)) return [];
  const cleaned = value
    .slice(0, maxItems)
    .filter((item) => typeof item === "string")
    .map((item) => safeText(item, maxLength))
    .filter(Boolean);
  return [...new Set(cleaned)];
}

export function normalizeFilterArray(value, legacyValue = null) {
  if (Array.isArray(value)) return cleanStringArray(value, 160, 500);
  const legacy = safeText(legacyValue, 160);
  return legacy && legacy !== "all" ? [legacy] : [];
}

export function activityMatchesFilters(activity, filters, maps) {
  const selected = {
    cities: normalizeFilterArray(filters?.cities),
    clients: normalizeFilterArray(filters?.clients),
    sites: normalizeFilterArray(filters?.sites),
    responsibles: normalizeFilterArray(filters?.responsibles),
    serviceTypes: normalizeFilterArray(filters?.serviceTypes),
    statuses: normalizeFilterArray(filters?.statuses),
    planningBuckets: normalizeFilterArray(filters?.planningBuckets)
  };
  const dateFrom = safeText(filters?.dateFrom, 10);
  const dateTo = safeText(filters?.dateTo, 10);
  if (dateFrom && (!activity.date || compareISODate(activity.date, dateFrom) < 0)) return false;
  if (dateTo && (!activity.date || compareISODate(activity.date, dateTo) > 0)) return false;
  if (selected.cities.length && !selected.cities.includes(activity.city ?? "")) return false;
  if (selected.clients.length && !selected.clients.includes(activity.clientId ?? "")) return false;
  if (selected.sites.length && !selected.sites.includes(activity.siteId ?? "")) return false;
  if (selected.responsibles.length && !selected.responsibles.some((id) => activity.responsibleIds?.includes(id))) return false;
  if (selected.serviceTypes.length && !selected.serviceTypes.includes(activity.serviceType)) return false;
  if (selected.statuses.length && !selected.statuses.includes(activity.status)) return false;
  if (selected.planningBuckets.length && !selected.planningBuckets.includes(activity.planningBucket ?? "calendar")) return false;
  const query = normalizeText(filters?.query);
  if (!query) return true;
  const client = maps?.clients?.get(activity.clientId);
  const site = maps?.sites?.get(activity.siteId);
  const responsibles = (activity.responsibleIds ?? []).map((id) => maps?.responsibles?.get(id)?.name ?? "");
  return normalizeText([
    client?.name,
    site?.name,
    site?.shoppingCenter,
    activity.city,
    SERVICE_TYPES[activity.serviceType],
    ACTIVITY_STATUSES[activity.status],
    PLANNING_BUCKETS[activity.planningBucket ?? "calendar"],
    activity.observations,
    ...responsibles
  ].filter(Boolean).join(" ")).includes(query);
}
