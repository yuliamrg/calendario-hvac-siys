import { access, readFile, rename, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { createBackupEnvelope, parseBackup } from "../core.js";

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

export async function writeCalendarFile(path, document, metadata = {}) {
  const absolute = resolve(path);
  try {
    await access(absolute, constants.F_OK);
    throw Object.assign(new Error(`El destino ya existe: ${absolute}`), { code: "OUTPUT_EXISTS" });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const temporary = resolve(dirname(absolute), `.${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`);
  const envelope = createBackupEnvelope(document, {
    exportedAt: new Date().toISOString(),
    origin: "calendary-cli",
    channel: metadata.channel ?? "local"
  });
  try {
    await writeFile(temporary, `${JSON.stringify(envelope, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporary, absolute);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  return absolute;
}
