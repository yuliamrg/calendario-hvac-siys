import { normalizeText } from "../domain/text.js";

export function normalizedHeader(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "");
}
export function encodeColumn(index) {
  let value = Number(index) + 1;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

export function decodeAddress(address) {
  const match = String(address ?? "").replaceAll("$", "").match(/^([A-Z]+)(\d+)$/i);
  if (!match) throw new TypeError(`Referencia de celda inválida: ${address}`);
  let column = 0;
  for (const character of match[1].toUpperCase()) {
    column = column * 26 + character.charCodeAt(0) - 64;
  }
  return { row: Number(match[2]) - 1, column: column - 1 };
}

export function decodeRange(reference) {
  const [startReference, endReference = startReference] = String(reference ?? "").split(":");
  const start = decodeAddress(startReference);
  const end = decodeAddress(endReference);
  return { start, end };
}

export function cellValue(cell) {
  if (cell && typeof cell === "object" && !Array.isArray(cell)) {
    if (Object.hasOwn(cell, "v")) return cell.v;
    if (Object.hasOwn(cell, "w")) return cell.w;
  }
  return cell ?? null;
}

export function worksheetRows(worksheet) {
  if (Array.isArray(worksheet)) return worksheet.map((row) => [...row]);
  if (Array.isArray(worksheet?.__rows)) return worksheet.__rows.map((row) => [...row]);
  if (Array.isArray(worksheet?.rows)) return worksheet.rows.map((row) => [...row]);
  if (!worksheet || !worksheet["!ref"]) return [];

  const { start, end } = decodeRange(worksheet["!ref"]);
  const rows = [];
  for (let row = start.row; row <= end.row; row += 1) {
    const values = [];
    for (let column = start.column; column <= end.column; column += 1) {
      values.push(cellValue(worksheet[`${encodeColumn(column)}${row + 1}`]));
    }
    rows.push(values);
  }
  return rows;
}

export function headerMap(headers) {
  const result = new Map();
  headers.forEach((header, index) => {
    const key = normalizedHeader(header);
    if (key && !result.has(key)) result.set(key, index);
  });
  return result;
}

export function findHeader(headers, aliases) {
  const byName = headerMap(headers);
  for (const alias of aliases) {
    const index = byName.get(normalizedHeader(alias));
    if (index !== undefined) return index;
  }
  return -1;
}
export function rowValue(row, index) {
  return index >= 0 ? row[index] : null;
}
