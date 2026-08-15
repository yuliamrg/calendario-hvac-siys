import { stdin as defaultStdin, stdout as defaultStdout, stderr as defaultStderr } from "node:process";
import { resolve } from "node:path";
import { CALENDAR_OPERATIONS, CalendarContractError, executeCalendarOperation } from "../calendar-contract.js";
import { APP_VERSION } from "../core.js";
import { CLOUD_COMMANDS, HELP, buildPayload, parseCli } from "./arguments.js";
import { createSupabaseAuthClient, supabaseConfigFromEnv } from "./cloud-auth.js";
import { CloudCliError } from "./cloud-errors.js";
import { CloudCalendarSource } from "./cloud-read.js";
import { readPassword, readPasswordFromStdin } from "./auth-prompt.js";
import { confirmDestructive, exitCodeFor, formatHumanResult, writeNewTextFile } from "./io.js";
import { FileCalendarSource } from "./sources.js";

function sourceKindFor(operation, values) {
  if (operation === "backup.restore" || operation === "backup.merge") return "file";
  const kind = values.source ?? "file";
  if (!["file", "cloud"].includes(kind)) {
    throw new CloudCliError("INVALID_REQUEST", "--source debe ser file o cloud.");
  }
  return kind;
}

function ensureCloudRequest(operation, values) {
  const definition = CALENDAR_OPERATIONS[operation];
  if (!definition?.readOnly) throw new CloudCliError("CLOUD_WRITE_NOT_ALLOWED", "Las operaciones de escritura cloud están deshabilitadas en esta fase.");
  if (values.input) throw new CloudCliError("INVALID_REQUEST", "--input no se usa con --source cloud.");
  if (!values.channel || !["stable", "beta"].includes(values.channel)) {
    throw new CloudCliError("CHANNEL_INVALID", "--channel stable|beta es obligatorio para --source cloud.");
  }
  if (values.mine && values["calendar-id"] !== undefined) {
    throw new CloudCliError("INVALID_REQUEST", "Usa --mine o --calendar-id, no ambos.");
  }
}

function ensureFileRequest(operation, values) {
  if (!values.input) throw new CloudCliError("INVALID_REQUEST", "Falta --input.");
  if (values.mine || values["calendar-id"] !== undefined) {
    throw new CloudCliError("INVALID_REQUEST", "--mine y --calendar-id solo aplican a --source cloud.");
  }
  if (operation === "backup.restore" || operation === "backup.merge") {
    if (!values.source || values.source === "cloud" || values.source === "file") {
      throw new CloudCliError("INVALID_REQUEST", "Esta operación requiere --source con la ruta de un respaldo.");
    }
  }
}

function printJson(stdout, value) {
  stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printCloudHuman(stdout, value) {
  if (value.calendars) {
    stdout.write(value.calendars.map((calendar) => `${calendar.calendarId} | ${calendar.channel} | ${calendar.name} | ${calendar.ownerName ?? ""}`).join("\n"));
    if (value.calendars.length) stdout.write("\n");
    return;
  }
  stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function makeAuth(io) {
  const config = supabaseConfigFromEnv(io.env ?? process.env);
  return createSupabaseAuthClient(config, {
    fetchImpl: io.fetch,
    sessionStore: io.sessionStore,
    timeoutMs: io.timeoutMs
  });
}

async function runCloudCommand(operation, values, io, stdout, stderr) {
  const auth = await makeAuth(io);
  const output = values.output ?? "human";
  if (!["human", "json"].includes(output)) throw new CloudCliError("INVALID_REQUEST", "--output debe ser human o json.");
  if (operation === "cloud.login") {
    if (!values.email) throw new CloudCliError("INVALID_REQUEST", "cloud login requiere --email.");
    const password = values["password-stdin"]
      ? await readPasswordFromStdin(io.stdin ?? defaultStdin)
      : await readPassword(io.stdin ?? defaultStdin, stderr);
    const session = await auth.signIn(values.email, password);
    const result = { loggedIn: true, user: session.user, expiresAt: new Date(Number(session.expires_at) * 1000).toISOString() };
    if (output === "json") printJson(stdout, result);
    else stdout.write(`Sesión cloud guardada para ${result.user?.email ?? result.user?.id ?? values.email}. Expira ${result.expiresAt}.\n`);
    return 0;
  }
  if (operation === "cloud.whoami") {
    const user = await auth.whoami();
    const result = { authenticated: true, user };
    if (output === "json") printJson(stdout, result);
    else stdout.write(`${user.email ?? user.id}\n`);
    return 0;
  }
  if (operation === "cloud.logout") {
    const result = await auth.logout();
    if (output === "json") printJson(stdout, result);
    else stdout.write("Sesión cloud eliminada.\n");
    return 0;
  }
  if (operation === "cloud.calendars") {
    if (!values.channel || !["stable", "beta"].includes(values.channel)) throw new CloudCliError("CHANNEL_INVALID", "cloud calendars requiere --channel stable|beta.");
    const source = new CloudCalendarSource(null, { auth, fetchImpl: io.fetch, timeoutMs: io.timeoutMs });
    const calendars = await source.listCalendars({ channel: values.channel, mine: Boolean(values.mine) });
    const result = { source: { kind: "cloud", channel: values.channel, observedAt: new Date().toISOString() }, calendars };
    if (output === "json") printJson(stdout, result);
    else printCloudHuman(stdout, result);
    return 0;
  }
  throw new CloudCliError("INVALID_REQUEST", `Comando cloud desconocido: ${operation}.`);
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
    if (values["as-of"] !== undefined) throw new CloudCliError("HISTORICAL_QUERY_UNSUPPORTED", "La CLI solo soporta current cloud state; no admite consultas históricas as-of.");
    if (CLOUD_COMMANDS.has(parsed.operation)) return await runCloudCommand(parsed.operation, values, { ...io, stdin }, stdout, stderr);

    const definition = CALENDAR_OPERATIONS[parsed.operation];
    const sourceKind = sourceKindFor(parsed.operation, values);
    if (!definition.readOnly && sourceKind === "file" && !values["dry-run"] && !values.write) {
      throw new CloudCliError("INVALID_REQUEST", "Las escrituras requieren --write o --dry-run.");
    }
    let input;
    if (sourceKind === "cloud") {
      ensureCloudRequest(parsed.operation, values);
      const config = supabaseConfigFromEnv(io.env ?? process.env);
      const auth = await makeAuth(io);
      const source = new CloudCalendarSource(config, {
        auth,
        fetchImpl: io.fetch,
        timeoutMs: io.timeoutMs
      });
      input = await source.load({
        channel: values.channel,
        calendarId: values["calendar-id"],
        mine: Boolean(values.mine)
      });
    } else {
      ensureFileRequest(parsed.operation, values);
      input = await new FileCalendarSource(values.input).load();
    }

    if (!values.output) values.output = "human";
    if (!["human", "json"].includes(values.output)) throw new CloudCliError("INVALID_REQUEST", "--output debe ser human o json.");
    if (sourceKind === "cloud" && !definition.readOnly) throw new CloudCliError("CLOUD_WRITE_NOT_ALLOWED", "Las operaciones de escritura cloud están deshabilitadas en esta fase.");
    if (sourceKind === "file" && values.write && input.input.absolute.toLowerCase() === resolve(values.write).toLowerCase()) {
      throw new CloudCliError("CONFLICT", "--write debe ser distinto de --input.");
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
    if (sourceKind === "cloud" && !definition.readOnly) throw new CloudCliError("CLOUD_WRITE_NOT_ALLOWED", "La operación cloud no es de solo lectura.");
    let written = null;
    if (!definition.readOnly && !values["dry-run"] && outcome.changed) written = await (async () => {
      const { writeCalendarFile } = await import("./files.js");
      return writeCalendarFile(values.write, outcome.document, { channel: input.source.channel });
    })();
    const rendered = {
      ...outcome,
      source: input.source,
      document: definition.readOnly ? undefined : outcome.document,
      written
    };
    if (!values.quiet) stdout.write(`${values.output === "json" ? JSON.stringify(rendered, null, 2) : formatHumanResult(parsed.operation, outcome, input.source)}\n`);
    return 0;
  } catch (error) {
    const code = error instanceof CalendarContractError || error instanceof CloudCliError ? error.code : (error.code ?? "INTERNAL_ERROR");
    stderr.write(`${code}: ${error.message}\n`);
    if (values.debug && error.stack) stderr.write(`${error.stack}\n`);
    return exitCodeFor({ code });
  }
}

export { HELP } from "./arguments.js";
