import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseBackup } from "@siys-sync/platform/core.js";

export const MAX_INPUT_BYTES = 25 * 1024 * 1024;

export async function readCalendarFile(path) {
  const absolute = resolve(path);
  const content = await readFile(absolute);
  if (content.byteLength > MAX_INPUT_BYTES) throw Object.assign(new Error("El archivo supera el límite de 25 MB."), { code: "INPUT_TOO_LARGE" });
  let raw;
  try { raw = JSON.parse(content.toString("utf8")); }
  catch (error) { throw Object.assign(new Error(`JSON inválido: ${error.message}`), { code: "INVALID_DOCUMENT" }); }
  return { absolute, ...parseBackup(raw) };
}
