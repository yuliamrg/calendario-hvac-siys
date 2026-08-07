import { normalizeText, safeText } from "../domain/text.js";
import { findHeader, worksheetRows } from "./xlsx-table.js";

export function isPresentCell(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

export function cleanLabel(value, maxLength = 240) {
  return safeText(value, maxLength).replace(/\s+/g, " ");
}

export function textOrNull(value, maxLength = 5000) {
  const text = safeText(value, maxLength);
  return text || null;
}

export function makeWarning(code, message, sheet = null, row = null) {
  return {
    code,
    message: safeText(message, 500),
    ...(sheet ? { sheet } : {}),
    ...(Number.isInteger(row) ? { row } : {})
  };
}

function resolveSheet(workbook, expectedName, warnings, optional = false) {
  const sheets = workbook?.Sheets;
  if (!sheets || typeof sheets !== "object") {
    throw new TypeError("El libro no tiene una colección SheetJS Sheets válida.");
  }
  if (sheets[expectedName]) return sheets[expectedName];
  const alternate = Object.keys(sheets).find(
    (name) => normalizeText(name) === normalizeText(expectedName)
  );
  if (alternate) {
    warnings.push(makeWarning(
      "sheet_name_variation",
      `Se usó la hoja ${alternate} como equivalente de ${expectedName}.`,
      alternate
    ));
    return sheets[alternate];
  }
  warnings.push(makeWarning(
    optional ? "optional_sheet_missing" : "required_sheet_missing",
    `No se encontró la hoja ${expectedName}.`,
    expectedName
  ));
  return null;
}

export function sheetTable(workbook, name, warnings, optional = false) {
  const worksheet = resolveSheet(workbook, name, warnings, optional);
  const rows = worksheetRows(worksheet);
  if (!rows.length) {
    if (worksheet) {
      warnings.push(makeWarning(
        optional ? "optional_sheet_empty" : "required_sheet_empty",
        `La hoja ${name} está vacía.`,
        name
      ));
    }
    return { headers: [], rows: [] };
  }
  return { headers: rows[0], rows: rows.slice(1) };
}

export function requireHeaders(sheetName, headers, definitions, warnings) {
  const indexes = {};
  for (const [field, definition] of Object.entries(definitions)) {
    const aliases = Array.isArray(definition) ? definition : definition.aliases;
    const required = Array.isArray(definition) ? true : definition.required !== false;
    indexes[field] = findHeader(headers, aliases);
    if (required && indexes[field] < 0) {
      warnings.push(makeWarning(
        "required_header_missing",
        `Falta el encabezado ${aliases[0]} en ${sheetName}.`,
        sheetName,
        1
      ));
    }
  }
  return indexes;
}

export function nonEmptyRows(rows) {
  return rows
    .map((row, index) => ({ row, rowNumber: index + 2 }))
    .filter(({ row }) => row.some(isPresentCell));
}
