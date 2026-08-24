import {
  ACTIVITY_STATUSES,
  RESPONSIBLE_TYPES,
  SERVICE_TYPES
} from "../domain/calendar-enums.js";
import { safeText } from "../domain/text.js";
import { STATUS_ICONS } from "./calendar-constants.js";
import { displayInitialsFor } from "./presentation.js";

const STATUS_VARIANT = (status) => status.replaceAll("_", "-");

function createStatusPresentation(key, label) {
  return Object.freeze({
    key,
    label,
    icon: STATUS_ICONS[key] ?? "•",
    accessibleLabel: `Estado: ${label}`,
    variant: STATUS_VARIANT(key)
  });
}

export const ACTIVITY_STATUS_PRESENTATION = Object.freeze({
  scheduled: createStatusPresentation("scheduled", ACTIVITY_STATUSES.scheduled),
  confirmed: createStatusPresentation("confirmed", ACTIVITY_STATUSES.confirmed),
  in_progress: createStatusPresentation("in_progress", ACTIVITY_STATUSES.in_progress),
  completed: createStatusPresentation("completed", ACTIVITY_STATUSES.completed),
  not_executed: createStatusPresentation("not_executed", ACTIVITY_STATUSES.not_executed),
  cancelled: createStatusPresentation("cancelled", ACTIVITY_STATUSES.cancelled),
  to_schedule: createStatusPresentation("to_schedule", ACTIVITY_STATUSES.to_schedule)
});

export function activityStatusPresentation(status) {
  const key = safeText(status, 80);
  if (ACTIVITY_STATUS_PRESENTATION[key]) return ACTIVITY_STATUS_PRESENTATION[key];

  const fallbackKey = key || "unknown";
  return createStatusPresentation(fallbackKey, key || "Estado desconocido");
}

export function activityObservationsTooltip(activity = {}) {
  const observations = safeText(activity?.observations, 500);
  return observations ? `Observaciones: ${observations}` : "Sin observaciones registradas";
}

function responsibleCatalogMap(catalog) {
  if (catalog instanceof Map) return catalog;
  if (Array.isArray(catalog)) {
    return new Map(
      catalog
        .filter((item) => item && item.id !== undefined && item.id !== null)
        .map((item) => [item.id, item])
    );
  }
  if (!catalog || typeof catalog !== "object") return new Map();
  if (Object.hasOwn(catalog, "responsibles")) return responsibleCatalogMap(catalog.responsibles);
  return new Map(
    Object.entries(catalog).filter(([, item]) => item && typeof item === "object")
  );
}

function responsibleEntry(item, fallbackId) {
  const name = safeText(item?.name, 180);
  if (!name) return null;

  const responsibleType = safeText(item.responsibleType, 40);
  const visualVariant = responsibleType === "contractor"
    ? "contractor"
    : responsibleType === "payroll"
      ? "payroll"
      : "unknown";
  const initials = safeText(item.initials || displayInitialsFor(name), 6).replace(/\s+/g, "");

  return Object.freeze({
    id: safeText(item.id ?? fallbackId, 160),
    name,
    initials,
    responsibleType,
    typeLabel: RESPONSIBLE_TYPES[responsibleType] ?? responsibleType,
    visualVariant
  });
}

export function activityResponsiblePresentation(activity = {}, catalog = []) {
  const maps = responsibleCatalogMap(catalog);
  const entries = (Array.isArray(activity?.responsibleIds) ? activity.responsibleIds : [])
    .map((id) => {
      const item = maps.get(id) ?? maps.get(String(id));
      return item ? responsibleEntry(item, id) : null;
    })
    .filter(Boolean);
  const fullNames = Object.freeze(entries.map((entry) => entry.name));
  const initials = Object.freeze(entries.map((entry) => entry.initials));
  const summary = fullNames.length ? fullNames.join(" · ") : "Sin responsable";
  const variants = new Set(entries.map((entry) => entry.visualVariant));
  const visualVariant = !entries.length
    ? "unassigned"
    : variants.size > 1
      ? "mixed"
      : entries[0].visualVariant;

  return Object.freeze({
    count: entries.length,
    entries: Object.freeze(entries),
    fullNames,
    initials,
    summary,
    accessibleLabel: fullNames.length ? `Técnicos: ${summary}` : "Sin responsable",
    visualVariant
  });
}

function firstText(...values) {
  for (const value of values) {
    const text = safeText(value, 240);
    if (text) return text;
  }
  return "";
}

function accessibleActivityLabel(activity, {
  status,
  responsibles,
  title,
  siteName,
  serviceLabel,
  rescheduled
}) {
  const observationSummary = safeText(activity?.observations, 240);
  return [
    title,
    siteName ? `sede: ${siteName}` : "",
    responsibles.fullNames.length ? `técnicos: ${responsibles.summary}` : "sin responsable",
    serviceLabel ? `tipo de servicio: ${serviceLabel}` : "",
    `estado: ${status.label}`,
    rescheduled ? "reprogramada" : "",
    observationSummary ? `observaciones: ${observationSummary}` : ""
  ].filter(Boolean).join(", ");
}

export function buildActivityPresentation(activity = {}, options = {}) {
  const config = options ?? {};
  const status = activityStatusPresentation(activity?.status);
  const responsibles = activityResponsiblePresentation(
    activity,
    config.responsibles ?? config.maps?.responsibles ?? []
  );
  const serviceLabel = firstText(
    config.serviceLabel,
    activity?.serviceLabel,
    SERVICE_TYPES[activity?.serviceType],
    activity?.serviceType
  );
  const title = firstText(
    config.title,
    config.clientName,
    activity?.title,
    activity?.clientName,
    activity?.serviceType === "administrative" ? "Administrativo" : "",
    serviceLabel || "Cliente sin catálogo"
  );
  const siteName = firstText(config.siteName, activity?.siteName);
  const history = Array.isArray(activity?.history) ? activity.history : [];
  const rescheduled = config.rescheduled ?? history.some(
    (item) => item?.action === "rescheduled"
  );

  return Object.freeze({
    status,
    observationsTooltip: activityObservationsTooltip(activity),
    responsibles,
    accessibleLabel: accessibleActivityLabel(activity, {
      status,
      responsibles,
      title,
      siteName,
      serviceLabel,
      rescheduled
    })
  });
}
