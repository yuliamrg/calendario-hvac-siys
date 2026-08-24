import { SERVICE_TYPES } from "../domain/calendar-enums.js";
import { safeText } from "../domain/text.js";
import { SERVICE_CODES } from "./calendar-constants.js";
import {
  activityResponsiblePresentation,
  activityStatusPresentation
} from "./activity-presentation.js";

const EXPORT_TEXT_STYLES = Object.freeze({
  title: Object.freeze({ font: "700 17px Arial", lineHeight: 21 }),
  location: Object.freeze({ font: "14px Arial", lineHeight: 19 }),
  responsible: Object.freeze({ font: "14px Arial", lineHeight: 19 }),
  status: Object.freeze({ font: "12px Arial", lineHeight: 17 })
});

const DEFAULT_MAX_WIDTH = 1264;
const DEFAULT_MIN_HEIGHT = 122;
const DEFAULT_TOP_PADDING = 18;

function firstExportText(...values) {
  for (const value of values) {
    const text = safeText(value, 240);
    if (text) return text;
  }
  return "";
}

function namedText(value) {
  return safeText(typeof value === "string" ? value : value?.name, 180);
}

function measuredWidth(measureContext, value) {
  const result = measureContext.measureText(value);
  const width = Number(result?.width);
  if (!Number.isFinite(width)) throw new TypeError("measureText debe devolver un ancho numérico.");
  return width;
}

function splitLongWord(measureContext, word, maxWidth) {
  const chunks = [];
  let chunk = "";
  for (const character of word) {
    const candidate = chunk + character;
    if (chunk && measuredWidth(measureContext, candidate) > maxWidth) {
      chunks.push(chunk);
      chunk = character;
    } else {
      chunk = candidate;
    }
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

function validateWrapInput(measureContext, maxWidth) {
  if (!measureContext || typeof measureContext.measureText !== "function") {
    throw new TypeError("Se requiere un contexto con measureText().");
  }
  if (!Number.isFinite(maxWidth) || maxWidth <= 0) {
    throw new RangeError("maxWidth debe ser un número positivo.");
  }
}

export function wrapExportText(measureContext, text, maxWidth) {
  validateWrapInput(measureContext, maxWidth);
  const value = safeText(text, 1800);
  if (!value) return Object.freeze([]);

  const lines = [];
  const paragraphs = value.split(/\r?\n/);
  paragraphs.forEach((paragraph, paragraphIndex) => {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      if (paragraphIndex < paragraphs.length - 1) lines.push("");
      return;
    }

    let line = "";
    for (const word of words) {
      if (measuredWidth(measureContext, word) > maxWidth) {
        if (line) {
          lines.push(line);
          line = "";
        }
        const chunks = splitLongWord(measureContext, word, maxWidth);
        lines.push(...chunks.slice(0, -1));
        line = chunks.at(-1) ?? "";
        continue;
      }

      const candidate = line ? `${line} ${word}` : word;
      if (line && measuredWidth(measureContext, candidate) > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
  });

  return Object.freeze(lines);
}

export function buildExportActivityRow(activity = {}, options = {}) {
  const config = options ?? {};
  const clientName = firstExportText(config.clientName, namedText(config.client));
  const siteName = firstExportText(config.siteName, namedText(config.site));
  const city = safeText(activity?.city, 180);
  const serviceLabel = firstExportText(
    config.serviceLabel,
    SERVICE_TYPES[activity?.serviceType],
    activity?.serviceType
  );
  const serviceCode = SERVICE_CODES[activity?.serviceType] ?? "SV";
  const statusPresentation = activityStatusPresentation(activity?.status);
  const responsibles = activityResponsiblePresentation(
    activity,
    config.responsibles ?? config.maps?.responsibles ?? []
  );
  const responsibleNames = Object.freeze([...responsibles.fullNames]);
  const observations = safeText(activity?.observations, 500);

  return Object.freeze({
    activity,
    serviceCode,
    serviceLabel,
    title: `${serviceCode} · ${clientName || serviceLabel || "Actividad"}`,
    location: siteName || city || "Sin sede",
    responsibleNames,
    responsible: `Técnicos: ${responsibleNames.length ? responsibleNames.join(" · ") : "Sin responsable"}`,
    responsibleVariant: responsibles.visualVariant,
    statusPresentation,
    status: `${statusPresentation.icon} ${statusPresentation.label}${observations ? ` · ${observations}` : ""}`,
    observations
  });
}

function measureField(measureContext, text, maxWidth, style) {
  const previousFont = measureContext.font;
  measureContext.font = style.font;
  try {
    return wrapExportText(measureContext, text, maxWidth);
  } finally {
    measureContext.font = previousFont;
  }
}

export function layoutExportActivityRow(row, measureContext, options = {}) {
  if (!row || typeof row !== "object") throw new TypeError("row debe ser un objeto.");
  const config = options ?? {};
  const maxWidth = Number(config.maxWidth ?? DEFAULT_MAX_WIDTH);
  const minHeight = Number(config.minHeight ?? DEFAULT_MIN_HEIGHT);
  const topPadding = Number(config.topPadding ?? DEFAULT_TOP_PADDING);
  validateWrapInput(measureContext, maxWidth);
  if (!Number.isFinite(minHeight) || minHeight < 0) throw new RangeError("minHeight no es válido.");
  if (!Number.isFinite(topPadding) || topPadding < 0) throw new RangeError("topPadding no es válido.");

  const styles = config.styles ?? EXPORT_TEXT_STYLES;
  const lines = Object.freeze({
    title: measureField(measureContext, row.title, maxWidth, styles.title),
    location: measureField(measureContext, row.location, maxWidth, styles.location),
    responsible: measureField(measureContext, row.responsible, maxWidth, styles.responsible),
    status: measureField(measureContext, row.status, maxWidth, styles.status)
  });
  const contentHeight = topPadding
    + lines.title.length * styles.title.lineHeight
    + lines.location.length * styles.location.lineHeight
    + lines.responsible.length * styles.responsible.lineHeight
    + lines.status.length * styles.status.lineHeight;

  return Object.freeze({
    ...row,
    lines,
    height: Math.max(minHeight, contentHeight)
  });
}
