import { parseArgs } from "node:util";
import { createInterface } from "node:readline/promises";
import { stdin as defaultStdin, stdout as defaultStdout, stderr as defaultStderr } from "node:process";
import { CALENDAR_OPERATIONS, CalendarContractError, executeCalendarOperation } from "../calendar-contract.js";
import { APP_VERSION } from "../core.js";
import { readCalendarFile, writeCalendarFile } from "./files.js";

const HELP = `calendary — calendario HVAC local por archivos JSON

Uso:
  calendary <grupo> <acción> --input respaldo.json [opciones]

Grupos y acciones:
  calendar  inspect | export-csv | export-quarantine-csv
  activity  list | get | create | edit | move | quarantine | assign-date | duplicate | extend | status | bulk-edit | delete
  catalog   list | upsert
  holiday   list | add | delete
  backup    restore | merge

Contrato de entrada:
  --payload '<json>'       Objeto exacto de la operación (recomendado para automatización)
  --payload-file archivo   Objeto exacto de la operación en un archivo JSON
  También se aceptan opciones de primer nivel: --activity-id, --activity-ids,
  --target-date, --date, --end-date, --status, --scope, --type, --id,
  --year, --month, --from, --to, --field, --value, --mode y --values.

Archivos y seguridad:
  --input archivo          Respaldo actual; obligatorio
  --write archivo          Nuevo respaldo para operaciones de escritura
  --source archivo         Respaldo origen para backup restore/merge
  --dry-run                Valida y muestra el resultado sin escribir
  --yes                    Confirma delete y restore sin preguntar
  --allow-non-working      Autoriza domingos o festivos

Salida:
  --output human|json      Formato de consola (predeterminado: human)
  --csv-output archivo     Destino de calendar export-csv
  --quiet                  No imprime éxito de escrituras
  --debug                  Incluye la causa técnica de errores
  --help                   Muestra esta ayuda
  --version                Muestra la versión de la CLI
`;

const VALUE_OPTIONS = [
  "input", "write", "source", "payload", "payload-file", "output", "csv-output",
  "activity-id", "activity-ids", "target-date", "date", "end-date", "status", "scope",
  "common-scope", "status-scope", "type", "id", "override-id", "year", "month", "from", "to",
  "field", "value", "mode", "values", "client-id", "site-id", "city", "responsible-ids",
  "service-type", "planning-bucket", "observations", "query", "active", "name", "reason"
];
const BOOLEAN_OPTIONS = ["dry-run", "yes", "allow-non-working", "quiet", "debug", "help", "version", "include-non-working"];

function parseCli(argv) {
  const options = Object.fromEntries(VALUE_OPTIONS.map((name) => [name, { type: "string" }]));
  for (const name of BOOLEAN_OPTIONS) options[name] = { type: "boolean" };
  const parsed = parseArgs({ args: argv, options, allowPositionals: true, strict: true });
  if (parsed.values.version) return { version: true, values: parsed.values };
  if (parsed.values.help || parsed.positionals.length === 0) return { help: true, values: parsed.values };
  if (parsed.positionals.length !== 2) throw Object.assign(new Error("Indica exactamente un grupo y una acción."), { code: "INVALID_REQUEST" });
  const operation = `${parsed.positionals[0]}.${parsed.positionals[1]}`;
  if (!CALENDAR_OPERATIONS[operation]) throw Object.assign(new Error(`Operación desconocida: ${operation}.`), { code: "INVALID_REQUEST" });
  return { operation, values: parsed.values };
}

function parseJson(value, label) {
  try { return JSON.parse(value); }
  catch (error) { throw Object.assign(new Error(`${label} no contiene JSON válido: ${error.message}`), { code: "INVALID_REQUEST" }); }
}

function split(value) { return value?.split(",").map((item) => item.trim()).filter(Boolean); }

async function buildPayload(operation, values) {
  let payload = {};
  if (values["payload-file"]) payload = parseJson(await (await import("node:fs/promises")).readFile(values["payload-file"], "utf8"), "--payload-file");
  if (values.payload) payload = { ...payload, ...parseJson(values.payload, "--payload") };
  const map = {
    "activity-id": "activityId", "target-date": "targetDate", "end-date": "endDate",
    "common-scope": "commonScope", "status-scope": "statusScope", "override-id": "overrideId",
    "client-id": "clientId", "site-id": "siteId", "service-type": "serviceType",
    "planning-bucket": "planningBucket"
  };
  for (const key of VALUE_OPTIONS) {
    if (values[key] === undefined || ["input", "write", "source", "payload", "payload-file", "output", "csv-output"].includes(key)) continue;
    let value = values[key];
    if (["activity-ids", "responsible-ids"].includes(key)) value = split(value);
    if (["year", "month"].includes(key)) value = Number(value);
    if (key === "active") value = value === "true";
    if (["value", "values"].includes(key)) value = parseJson(value, `--${key}`);
    payload[map[key] ?? key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  if (values["include-non-working"]) payload.includeNonWorking = true;
  if (values["allow-non-working"]) payload.allowNonWorking = true;
  if (operation === "activity.edit" && !payload.patch) {
    const patchFields = ["date", "planningBucket", "clientId", "siteId", "city", "responsibleIds", "serviceType", "status", "observations"];
    payload.patch = Object.fromEntries(patchFields.filter((key) => Object.hasOwn(payload, key)).map((key) => [key, payload[key]]));
    for (const key of patchFields) delete payload[key];
  }
  if (operation === "catalog.upsert" && !payload.values) {
    const fields = ["name", "active", "clientId", "city"];
    payload.values = Object.fromEntries(fields.filter((key) => Object.hasOwn(payload, key)).map((key) => [key, payload[key]]));
    for (const key of fields) delete payload[key];
  }
  if (operation === "backup.restore" || operation === "backup.merge") {
    if (!values.source) throw Object.assign(new Error("Esta operación requiere --source."), { code: "INVALID_REQUEST" });
    payload.document = (await readCalendarFile(values.source)).document;
  }
  return payload;
}

async function confirmDestructive(operation, values, stdin, stdout) {
  if (!CALENDAR_OPERATIONS[operation].destructive || values.yes) return;
  if (!stdin.isTTY) throw Object.assign(new Error("La operación destructiva requiere --yes en modo no interactivo."), { code: "CONFIRMATION_REQUIRED" });
  const prompt = createInterface({ input: stdin, output: stdout });
  const answer = await prompt.question(`Confirma ${operation} escribiendo "si": `);
  prompt.close();
  if (answer.trim().toLowerCase() !== "si") throw Object.assign(new Error("Operación cancelada."), { code: "CONFIRMATION_REQUIRED" });
}

function humanResult(operation, outcome) {
  if (operation === "activity.list" || operation === "catalog.list" || operation === "holiday.list") {
    return outcome.result.items.map((item) => JSON.stringify(item)).join("\n") || "Sin resultados.";
  }
  return outcome.changed
    ? `OK ${operation}: revisión ${outcome.document.calendarMeta.revision}.`
    : `${operation}: sin cambios.\n${JSON.stringify(outcome.result, null, 2)}`;
}

function exitCode(error) {
  if (["INVALID_REQUEST", "VALIDATION_FAILED", "INVALID_DOCUMENT", "UNSUPPORTED_SCHEMA", "INPUT_TOO_LARGE"].includes(error.code)) return 2;
  if (error.code === "NOT_FOUND") return 3;
  if (["CONFLICT", "OUTPUT_EXISTS", "CONFIRMATION_REQUIRED", "NON_WORKING_CONFIRMATION_REQUIRED"].includes(error.code)) return 4;
  return 1;
}

async function writeNewTextFile(path, content) {
  try {
    await (await import("node:fs/promises")).writeFile(path, content, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (error.code === "EEXIST") throw Object.assign(new Error(`El destino ya existe: ${path}`), { code: "OUTPUT_EXISTS" });
    throw error;
  }
}

export async function runCli(argv, io = {}) {
  const stdin = io.stdin ?? defaultStdin;
  const stdout = io.stdout ?? defaultStdout;
  const stderr = io.stderr ?? defaultStderr;
  let values = {};
  try {
    const parsed = parseCli(argv);
    values = parsed.values;
    if (parsed.version) { stdout.write(`${APP_VERSION}\n`); return 0; }
    if (parsed.help) { stdout.write(HELP); return 0; }
    if (!values.input) throw Object.assign(new Error("Falta --input."), { code: "INVALID_REQUEST" });
    if (!values.output) values.output = "human";
    if (!['human', 'json'].includes(values.output)) throw Object.assign(new Error("--output debe ser human o json."), { code: "INVALID_REQUEST" });
    const definition = CALENDAR_OPERATIONS[parsed.operation];
    if (!definition.readOnly && !values["dry-run"] && !values.write) throw Object.assign(new Error("Las escrituras requieren --write o --dry-run."), { code: "INVALID_REQUEST" });
    const input = await readCalendarFile(values.input);
    if (values.write && input.absolute.toLowerCase() === (await import("node:path")).resolve(values.write).toLowerCase()) {
      throw Object.assign(new Error("--write debe ser distinto de --input."), { code: "CONFLICT" });
    }
    await confirmDestructive(parsed.operation, values, stdin, stdout);
    const payload = await buildPayload(parsed.operation, values);
    const outcome = executeCalendarOperation(input.document, { operation: parsed.operation, payload }, {
      appVersion: input.document.appVersion
    });
    if (parsed.operation === "calendar.export-csv" || parsed.operation === "calendar.export-quarantine-csv") {
      if (values["csv-output"]) await writeNewTextFile(values["csv-output"], outcome.result.content);
      else stdout.write(outcome.result.content);
      return 0;
    }
    let written = null;
    if (!definition.readOnly && !values["dry-run"] && outcome.changed) written = await writeCalendarFile(values.write, outcome.document, { channel: input.channel });
    if (!values.quiet) stdout.write(`${values.output === "json" ? JSON.stringify({ ...outcome, document: definition.readOnly ? undefined : outcome.document, written }, null, 2) : humanResult(parsed.operation, outcome)}\n`);
    return 0;
  } catch (error) {
    const code = error instanceof CalendarContractError ? error.code : (error.code ?? "INTERNAL_ERROR");
    stderr.write(`${code}: ${error.message}\n`);
    if (values.debug && error.stack) stderr.write(`${error.stack}\n`);
    return exitCode({ code });
  }
}

export { HELP };
