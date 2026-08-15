import { parseArgs } from "node:util";
import { CALENDAR_OPERATIONS } from "../calendar-contract.js";
import { readCalendarFile } from "./files.js";

export const HELP = `calendary — calendario HVAC local por archivos JSON o lectura cloud

Uso:
  calendary <grupo> <acción> [opciones]

Grupos y acciones:
  calendar  inspect | export-csv | export-quarantine-csv
  activity  list | get | create | edit | move | quarantine | assign-date | duplicate | extend | extend-range | status | bulk-edit | delete
  catalog   list | upsert
  holiday   list | add | delete
  backup    restore | merge
  document  normalize-text
  cloud     login | whoami | logout | calendars

Contrato de entrada:
  --payload '<json>'       Objeto exacto de la operación (recomendado para automatización)
  --payload-file archivo   Objeto exacto de la operación en un archivo JSON
  También se aceptan opciones de primer nivel: --activity-id, --activity-ids,
  --target-date, --date, --end-date, --from-date, --to-date, --status, --scope, --type, --id,
  --year, --month, --from, --to, --field, --value, --mode y --values.

Archivos y seguridad:
  --source file|cloud      Fuente (file por defecto; backup usa --source como ruta)
  --input archivo          Respaldo actual; obligatorio con --source file
  --write archivo          Nuevo respaldo para operaciones de escritura
  backup restore/merge     --source archivo es el respaldo origen
  --dry-run                Valida y muestra el resultado sin escribir
  --yes                    Confirma delete y restore sin preguntar
  --allow-non-working      Autoriza domingos o festivos

Cloud read-only:
  --channel stable|beta    Canal Supabase explícito
  --calendar-id UUID       Calendario cloud inequívoco
  --mine                   Restringe la selección a created_by del usuario autenticado
  --as-of valor            No soportado: falla con HISTORICAL_QUERY_UNSUPPORTED
  --email correo           Email para cloud login (la contraseña nunca va en argv)
  --password-stdin         Lee la contraseña desde stdin sin mostrarla

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
  "activity-id", "activity-ids", "target-date", "date", "end-date", "from-date", "to-date", "status", "scope",
  "common-scope", "status-scope", "type", "id", "override-id", "year", "month", "from", "to",
  "field", "value", "mode", "values", "client-id", "site-id", "city", "responsible-ids",
  "service-type", "planning-bucket", "observations", "query", "active", "name", "reason",
  "client-name", "site-name", "responsible-names", "new-responsible-type",
  "channel", "calendar-id", "as-of", "email"
];
const BOOLEAN_OPTIONS = ["dry-run", "yes", "allow-non-working", "quiet", "debug", "help", "version", "include-non-working", "include-activities", "include-catalog", "include-meta", "mine", "password-stdin"];

export const CLOUD_COMMANDS = Object.freeze(new Set([
  "cloud.login", "cloud.whoami", "cloud.logout", "cloud.calendars"
]));

export function parseCli(argv) {
  const options = Object.fromEntries(VALUE_OPTIONS.map((name) => [name, { type: "string" }]));
  for (const name of BOOLEAN_OPTIONS) options[name] = { type: "boolean" };
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options, allowPositionals: true, strict: true });
  } catch (error) {
    throw Object.assign(new Error(error.message), { code: "INVALID_REQUEST", cause: error });
  }
  if (parsed.values.version) return { version: true, values: parsed.values };
  if (parsed.values.help || parsed.positionals.length === 0) return { help: true, values: parsed.values };
  if (parsed.positionals.length !== 2) throw Object.assign(new Error("Indica exactamente un grupo y una acción."), { code: "INVALID_REQUEST" });
  const operation = `${parsed.positionals[0]}.${parsed.positionals[1]}`;
  if (!CALENDAR_OPERATIONS[operation] && !CLOUD_COMMANDS.has(operation)) throw Object.assign(new Error(`Operación desconocida: ${operation}.`), { code: "INVALID_REQUEST" });
  return { operation, values: parsed.values };
}

function parseJson(value, label) {
  try { return JSON.parse(value); }
  catch (error) { throw Object.assign(new Error(`${label} no contiene JSON válido: ${error.message}`), { code: "INVALID_REQUEST" }); }
}

function split(value) { return value?.split(",").map((item) => item.trim()).filter(Boolean); }

export async function buildPayload(operation, values) {
  let payload = {};
  if (values["payload-file"]) payload = parseJson(await (await import("node:fs/promises")).readFile(values["payload-file"], "utf8"), "--payload-file");
  if (values.payload) payload = { ...payload, ...parseJson(values.payload, "--payload") };
  const map = {
    "activity-id": "activityId", "target-date": "targetDate", "end-date": "endDate", "from-date": "fromDate", "to-date": "toDate",
    "common-scope": "commonScope", "status-scope": "statusScope", "override-id": "overrideId",
    "client-id": "clientId", "site-id": "siteId", "service-type": "serviceType",
    "planning-bucket": "planningBucket"
  };
  for (const key of VALUE_OPTIONS) {
    if (values[key] === undefined || ["input", "write", "source", "payload", "payload-file", "output", "csv-output", "channel", "calendar-id", "as-of", "email"].includes(key)) continue;
    let value = values[key];
    if (["activity-ids", "responsible-ids", "responsible-names"].includes(key)) value = split(value);
    if (["year", "month"].includes(key)) value = Number(value);
    if (key === "active") value = value === "true";
    if (["value", "values"].includes(key)) value = parseJson(value, `--${key}`);
    payload[map[key] ?? key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  if (values["include-non-working"]) payload.includeNonWorking = true;
  if (values["include-activities"]) payload.includeActivities = true;
  if (values["include-catalog"]) payload.includeCatalog = true;
  if (values["include-meta"]) payload.includeMeta = true;
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
