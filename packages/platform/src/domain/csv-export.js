import { compareActivityOrder } from "./activity-order.js";
import { ACTIVITY_STATUSES, PLANNING_BUCKETS, SERVICE_TYPES } from "./calendar-enums.js";
import { compareISODate } from "./dates.js";

function buildCsvCatalogLookup(document) {
  return {
    clients: new Map(document.catalog.clients.map((item) => [item.id, item])),
    sites: new Map(document.catalog.sites.map((item) => [item.id, item])),
    responsibles: new Map(document.catalog.responsibles.map((item) => [item.id, item]))
  };
}

function assignedNamesByType(activity, responsibles, responsibleType) {
  return (activity.responsibleIds ?? [])
    .map((id) => responsibles.get(id))
    .filter((responsible) => responsible?.responsibleType === responsibleType)
    .map((responsible) => responsible.name)
    .join(" | ");
}

function serializeCsv(header, rows) {
  const escapeCell = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return "\uFEFF" + [header, ...rows]
    .map((row) => row.map(escapeCell).join(","))
    .join("\r\n");
}

export function buildMonthlyCsv(document, year, month) {
  const { clients, sites, responsibles } = buildCsvCatalogLookup(document);
  const monthPrefix = `${year}-${String(month).padStart(2, "0")}`;
  const rows = document.activities
    .filter((activity) => (
      (activity.planningBucket ?? "calendar") === "calendar" &&
      typeof activity.date === "string" &&
      activity.date.startsWith(monthPrefix)
    ))
    .sort((left, right) => compareISODate(left.date, right.date) || compareActivityOrder(left, right))
    .map((activity) => [
      activity.date,
      clients.get(activity.clientId)?.name ?? "",
      sites.get(activity.siteId)?.name ?? "",
      activity.city ?? sites.get(activity.siteId)?.city ?? "",
      assignedNamesByType(activity, responsibles, "payroll"),
      assignedNamesByType(activity, responsibles, "contractor"),
      SERVICE_TYPES[activity.serviceType] ?? activity.serviceType,
      ACTIVITY_STATUSES[activity.status] ?? activity.status,
      activity.observations ?? "",
      activity.id,
      activity.seriesId ?? ""
    ]);
  return serializeCsv([
    "Fecha", "Cliente", "Sede", "Ciudad", "Responsables nómina", "Responsables contratistas",
    "Tipo de servicio", "Estado", "Observaciones", "ID actividad", "ID serie"
  ], rows);
}

export function buildQuarantineCsv(document) {
  const { clients, sites, responsibles } = buildCsvCatalogLookup(document);
  const rows = document.activities
    .filter((activity) => (activity.planningBucket ?? "calendar") === "quarantine")
    .sort((left, right) => (
      (left.updatedAt ?? "").localeCompare(right.updatedAt ?? "") || left.id.localeCompare(right.id)
    ))
    .map((activity) => [
      "",
      PLANNING_BUCKETS.quarantine,
      clients.get(activity.clientId)?.name ?? "",
      sites.get(activity.siteId)?.name ?? "",
      activity.city ?? sites.get(activity.siteId)?.city ?? "",
      assignedNamesByType(activity, responsibles, "payroll"),
      assignedNamesByType(activity, responsibles, "contractor"),
      SERVICE_TYPES[activity.serviceType] ?? activity.serviceType,
      ACTIVITY_STATUSES[activity.status] ?? activity.status,
      activity.observations ?? "",
      activity.id
    ]);
  return serializeCsv([
    "Fecha", "Bandeja", "Cliente", "Sede", "Ciudad", "Responsables nómina",
    "Responsables contratistas", "Tipo de servicio", "Estado", "Observaciones", "ID actividad"
  ], rows);
}
