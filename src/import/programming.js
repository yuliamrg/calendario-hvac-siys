import {
  ACTIVITY_STATUSES,
  PLANNING_BUCKETS,
  SERVICE_TYPES,
  createActivitiesFromRange,
  createQuarantineActivity,
  generateSeriesDates,
  holidayMapForRange,
  normalizeText,
  parseISODate,
  safeText
} from "../core.js";
import { findHeader, rowValue } from "./xlsx-table.js";
import {
  cleanLabel,
  isPresentCell,
  nonEmptyRows,
  sheetTable
} from "./workbook-table.js";

export const PROGRAMMING_COLUMNS = Object.freeze([
  "FechaInicio",
  "FechaFin",
  "Bandeja",
  "Cliente",
  "Sede",
  "Ciudad",
  "Responsables",
  "TipoServicio",
  "Estado",
  "Observaciones",
  "IncluirNoLaborables"
]);

const REQUIRED_PROGRAMMING_COLUMNS = Object.freeze(
  PROGRAMMING_COLUMNS.filter((column) => column !== "Bandeja")
);

function excelDateToISO(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return [
      value.getUTCFullYear(),
      String(value.getUTCMonth() + 1).padStart(2, "0"),
      String(value.getUTCDate()).padStart(2, "0")
    ].join("-");
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return excelDateToISO(new Date(Math.round((value - 25569) * 86400000)));
  }
  const text = safeText(value, 40);
  if (!text) return "";
  const latin = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  const iso = latin
    ? `${latin[3]}-${latin[2].padStart(2, "0")}-${latin[1].padStart(2, "0")}`
    : text.slice(0, 10);
  parseISODate(iso);
  return iso;
}

function exactMatches(items, label, predicate = () => true) {
  const key = normalizeText(label);
  return items.filter((item) => predicate(item) && [
    item.name,
    ...(item.aliases ?? [])
  ].some((candidate) => normalizeText(candidate) === key));
}

function enumValue(value, entries) {
  const key = normalizeText(value);
  return Object.entries(entries).find(([code, label]) =>
    normalizeText(code) === key || normalizeText(label) === key
  )?.[0] ?? null;
}

function planningBucketValue(value) {
  const key = normalizeText(value);
  if (["quarantine", "cuarentena", "sin fecha", "por programar", "pendiente"].includes(key)) return "quarantine";
  return enumValue(value, PLANNING_BUCKETS);
}

function truthyCell(value) {
  return ["si", "sí", "s", "true", "1", "x"].includes(normalizeText(value));
}

function programmingFingerprint(activity) {
  return [
    activity.planningBucket ?? (activity.date == null ? "quarantine" : "calendar"),
    activity.date,
    activity.clientId ?? "",
    activity.siteId ?? "",
    normalizeText(activity.city),
    [...(activity.responsibleIds ?? [])].sort().join("|"),
    activity.serviceType,
    normalizeText(activity.observations)
  ].join("::");
}

export function parseProgrammingWorkbook(workbook, document) {
  if (!document?.catalog || !Array.isArray(document.activities)) {
    throw new TypeError("Se requiere el documento activo para validar la programación.");
  }
  const warnings = [];
  const table = sheetTable(workbook, "Programacion", warnings);
  const indexes = {};
  const structuralErrors = [];
  for (const column of REQUIRED_PROGRAMMING_COLUMNS) {
    indexes[column] = findHeader(table.headers, [column]);
    if (indexes[column] < 0) structuralErrors.push(`Falta la columna ${column}.`);
  }
  indexes.Bandeja = findHeader(table.headers, ["Bandeja", "PlanningBucket", "Bucket"]);
  if (structuralErrors.length) {
    return { rows: [], structuralErrors, warnings, counts: { valid: 0, errors: 0, duplicates: 0, omitted: 0 } };
  }
  const existingFingerprints = new Set(document.activities.map(programmingFingerprint));
  const fileFingerprints = new Set();
  const rows = [];
  let omittedCount = 0;
  for (const { row, rowNumber } of nonEmptyRows(table.rows)) {
    const errors = [];
    const rowWarnings = [];
    const bucketValue = indexes.Bandeja >= 0 ? rowValue(row, indexes.Bandeja) : "calendar";
    const planningBucket = planningBucketValue(bucketValue || "calendar");
    if (!planningBucket) errors.push("Bandeja debe ser Calendario o Pendiente.");

    let startDate = "";
    let endDate = "";
    if (planningBucket === "quarantine") {
      if (isPresentCell(rowValue(row, indexes.FechaInicio)) || isPresentCell(rowValue(row, indexes.FechaFin))) {
        errors.push("Las filas Pendiente deben venir sin FechaInicio ni FechaFin.");
      }
    } else {
      try {
        startDate = excelDateToISO(rowValue(row, indexes.FechaInicio));
        if (!startDate) throw new TypeError("FechaInicio está vacía.");
      } catch (error) {
        errors.push(`FechaInicio: ${error.message}`);
      }
      try {
        endDate = excelDateToISO(rowValue(row, indexes.FechaFin)) || startDate;
      } catch (error) {
        errors.push(`FechaFin: ${error.message}`);
      }
    }

    const clientLabel = cleanLabel(rowValue(row, indexes.Cliente), 200);
    const siteLabel = cleanLabel(rowValue(row, indexes.Sede), 240);
    const cityLabel = cleanLabel(rowValue(row, indexes.Ciudad), 120);
    const serviceType = enumValue(rowValue(row, indexes.TipoServicio), SERVICE_TYPES);
    const status = enumValue(rowValue(row, indexes.Estado), ACTIVITY_STATUSES);
    if (!serviceType) errors.push("TipoServicio no coincide con el catálogo permitido.");
    if (!status) errors.push("Estado no coincide con el catálogo permitido.");
    if (planningBucket === "quarantine" && status && status !== "to_schedule") {
      errors.push("Las filas Pendiente deben tener estado Por programar.");
    }
    if (planningBucket === "calendar" && status === "to_schedule") {
      errors.push("Las filas de Calendario no pueden tener estado Por programar.");
    }

    let clientId = null;
    let siteId = null;
    let city = cityLabel;
    if (clientLabel) {
      const matches = exactMatches(document.catalog.clients, clientLabel);
      if (matches.length === 1) clientId = matches[0].id;
      else errors.push(matches.length ? "Cliente ambiguo." : "Cliente no existe en el catálogo.");
    }
    if (siteLabel) {
      const matches = exactMatches(
        document.catalog.sites,
        siteLabel,
        (site) => !clientId || site.clientId === clientId
      );
      if (matches.length === 1) {
        siteId = matches[0].id;
        clientId ||= matches[0].clientId;
        city ||= matches[0].city ?? "";
      } else {
        errors.push(matches.length ? "Sede ambigua." : "Sede no existe para el cliente indicado.");
      }
    }
    if (serviceType && serviceType !== "administrative" && (!clientId || !siteId || !city)) {
      errors.push("Cliente, Sede y Ciudad son obligatorios para servicios operativos.");
    }

    const responsibleIds = [];
    const responsibleLabels = safeText(rowValue(row, indexes.Responsables), 2000)
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean);
    for (const label of responsibleLabels) {
      const matches = exactMatches(document.catalog.responsibles, label);
      if (matches.length === 1) responsibleIds.push(matches[0].id);
      else errors.push(matches.length ? `Responsable ambiguo: ${label}.` : `Responsable no existe: ${label}.`);
    }
    if (status === "confirmed" && !responsibleIds.length) {
      errors.push("Una actividad confirmada debe tener responsables.");
    }

    const includeNonWorking = truthyCell(rowValue(row, indexes.IncluirNoLaborables));
    const observations = safeText(rowValue(row, indexes.Observaciones), 5000);
    let dates = [];
    let omitted = [];
    if (planningBucket === "calendar" && startDate && endDate) {
      try {
        const holidays = holidayMapForRange(startDate, endDate, document.holidayOverrides);
        ({ included: dates, omitted } = generateSeriesDates(startDate, endDate, holidays, includeNonWorking));
        omittedCount += omitted.length;
        if (omitted.length) rowWarnings.push(`${omitted.length} fecha(s) no laborable(s) se omitirán.`);
        if (!dates.length) errors.push("El rango no contiene fechas laborables para importar.");
      } catch (error) {
        errors.push(error.message);
      }
    }

    const input = {
      date: planningBucket === "quarantine" ? null : startDate,
      endDate: planningBucket === "quarantine" ? null : endDate,
      planningBucket,
      clientId,
      siteId,
      city,
      responsibleIds: [...new Set(responsibleIds)],
      serviceType,
      status,
      observations,
      includeNonWorking
    };
    const fingerprintDates = planningBucket === "quarantine" ? [null] : dates;
    const fingerprints = fingerprintDates.map((date) => programmingFingerprint({ ...input, date }));
    const duplicate = fingerprints.length > 0 && fingerprints.every((fingerprint) =>
      existingFingerprints.has(fingerprint) || fileFingerprints.has(fingerprint)
    );
    if (duplicate) rowWarnings.push("La fila duplica programación existente o anterior en el archivo.");
    for (const fingerprint of fingerprints) fileFingerprints.add(fingerprint);
    rows.push({
      rowNumber,
      input,
      dates,
      omitted,
      duplicate,
      errors: [...new Set(errors)],
      warnings: [...new Set(rowWarnings)]
    });
  }
  return {
    rows,
    structuralErrors,
    warnings,
    counts: {
      valid: rows.filter((item) => !item.errors.length && !item.duplicate).length,
      errors: rows.filter((item) => item.errors.length).length,
      duplicates: rows.filter((item) => item.duplicate && !item.errors.length).length,
      omitted: omittedCount
    }
  };
}

export function applyProgrammingImport(
  document,
  preview,
  { includeDuplicates = false, now = new Date().toISOString(), idFactory = () => crypto.randomUUID() } = {}
) {
  if (preview?.structuralErrors?.length) throw new TypeError(preview.structuralErrors.join(" "));
  const candidates = (preview?.rows ?? []).filter((row) =>
    !row.errors.length && (includeDuplicates || !row.duplicate)
  );
  if (!candidates.length) throw new TypeError("No hay filas válidas para importar.");
  const result = structuredClone(document);
  const created = [];
  for (const row of candidates) {
    if (row.input.planningBucket === "quarantine") {
      const activity = createQuarantineActivity(row.input, { idFactory, now });
      result.activities.push(activity);
      created.push(activity);
    } else {
      const holidays = holidayMapForRange(row.input.date, row.input.endDate, result.holidayOverrides);
      const generated = createActivitiesFromRange(row.input, holidays, { idFactory, now });
      result.activities.push(...generated.activities);
      if (generated.series) result.series.push(generated.series);
      created.push(...generated.activities);
    }
  }
  result.audit ??= [];
  result.audit.push({
    at: now,
    action: "programming_imported",
    detail: `${created.length} tarjetas importadas desde ${candidates.length} filas`
  });
  return { document: result, activities: created, rowsApplied: candidates.length };
}
