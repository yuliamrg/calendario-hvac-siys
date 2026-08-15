import { writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { CALENDAR_OPERATIONS } from "../calendar-contract.js";

export async function confirmDestructive(operation, values, stdin, stdout) {
  if (!CALENDAR_OPERATIONS[operation].destructive || values.yes) return;
  if (!stdin.isTTY) {
    throw Object.assign(
      new Error("La operación destructiva requiere --yes en modo no interactivo."),
      { code: "CONFIRMATION_REQUIRED" }
    );
  }
  const prompt = createInterface({ input: stdin, output: stdout });
  const answer = await prompt.question(`Confirma ${operation} escribiendo "si": `);
  prompt.close();
  if (answer.trim().toLowerCase() !== "si") {
    throw Object.assign(new Error("Operación cancelada."), { code: "CONFIRMATION_REQUIRED" });
  }
}

export function formatHumanResult(operation, outcome, source = null) {
  const sourceLine = source?.kind === "cloud"
    ? `Fuente cloud ${source.channel}/${source.calendarId}; revisión cloud=${source.cloudRevision ?? "?"}, documento=${source.documentRevision ?? "?"}; observado=${source.observedAt}.${source.warnings?.length ? ` Advertencias: ${source.warnings.join(", ")}.` : ""}`
    : null;
  if (["activity.list", "catalog.list", "holiday.list"].includes(operation)) {
    return [sourceLine, outcome.result.items.map((item) => JSON.stringify(item)).join("\n") || "Sin resultados."].filter(Boolean).join("\n");
  }
  const result = outcome.changed
    ? `OK ${operation}: revisión ${outcome.document.calendarMeta.revision}.`
    : `${operation}: sin cambios.\n${JSON.stringify(outcome.result, null, 2)}`;
  return [sourceLine, result].filter(Boolean).join("\n");
}

export function exitCodeFor(error) {
  if (["INVALID_REQUEST", "VALIDATION_FAILED", "INVALID_DOCUMENT", "UNSUPPORTED_SCHEMA", "INPUT_TOO_LARGE", "HISTORICAL_QUERY_UNSUPPORTED", "CHANNEL_INVALID", "CONFIG_INVALID"].includes(error.code)) return 2;
  if (["NOT_FOUND", "CALENDAR_NOT_FOUND", "CALENDAR_DOCUMENT_NOT_FOUND"].includes(error.code)) return 3;
  if (["CONFLICT", "OUTPUT_EXISTS", "CONFIRMATION_REQUIRED", "NON_WORKING_CONFIRMATION_REQUIRED", "CALENDAR_AMBIGUOUS", "CHANNEL_MISMATCH", "CLOUD_WRITE_NOT_ALLOWED"].includes(error.code)) return 4;
  return 1;
}

export async function writeNewTextFile(path, content) {
  try {
    await writeFile(path, content, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (error.code === "EEXIST") {
      throw Object.assign(new Error(`El destino ya existe: ${path}`), { code: "OUTPUT_EXISTS" });
    }
    throw error;
  }
}
