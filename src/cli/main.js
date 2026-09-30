import { stdin as defaultStdin, stdout as defaultStdout, stderr as defaultStderr } from "node:process";
import { CALENDAR_OPERATIONS, CalendarContractError, executeCalendarOperation } from "../calendar-contract.js";
import { CLI_VERSION } from "./version.js";
import { CLOUD_COMMANDS, HELP, buildPayload, parseCli } from "./arguments.js";
import { createSupabaseAuthClient, supabaseConfigFromEnv } from "./cloud-auth.js";
import { CloudCliError } from "./cloud-errors.js";
import { CloudCalendarSource } from "./cloud-read.js";
import { createCloudCalendarWriter } from "./cloud-write.js";
import { readPassword, readPasswordFromStdin } from "./auth-prompt.js";
import { confirmDestructive, exitCodeFor, formatHumanResult, writeNewTextFile } from "./io.js";

const BACKUP_OPERATIONS = new Set(["backup.restore", "backup.merge"]);
const SOURCE_AUTHORITY_MESSAGE = "La CLI usa Supabase como única autoridad; indica --source cloud.";

function requireCloudSource(operation, values) {
  if (values.source === "cloud") return;
  const hint = BACKUP_OPERATIONS.has(operation) ? " El respaldo se indica con --backup-file." : "";
  if (values.source === undefined || values.source === "") {
    throw new CloudCliError("INVALID_REQUEST", `${SOURCE_AUTHORITY_MESSAGE}${hint}`);
  }
  throw new CloudCliError(
    "INVALID_REQUEST",
    `La CLI usa Supabase como única autoridad; --source sólo admite cloud (recibido: ${values.source}).${hint}`
  );
}

function ensureCloudRequest(values) {
  if (!values.channel || !["stable", "beta"].includes(values.channel)) {
    throw new CloudCliError("CHANNEL_INVALID", "--channel stable|beta es obligatorio para --source cloud.");
  }
  if (values.mine && values["calendar-id"] !== undefined) {
    throw new CloudCliError("INVALID_REQUEST", "Usa --mine o --calendar-id, no ambos.");
  }
}

function ensureOperationOperands(operation, values) {
  if (values["backup-file"] !== undefined && !BACKUP_OPERATIONS.has(operation)) {
    throw new CloudCliError("INVALID_REQUEST", "--backup-file sólo aplica a backup restore|merge.");
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

async function makeAuth(io, config = supabaseConfigFromEnv(io.env ?? process.env)) {
  return createSupabaseAuthClient(config, {
    fetchImpl: io.fetch,
    sessionStore: io.sessionStore,
    timeoutMs: io.timeoutMs
  });
}

async function runCloudCommand(operation, values, io, stdout, stderr) {
  const config = supabaseConfigFromEnv(io.env ?? process.env);
  const auth = await makeAuth(io, config);
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
    const source = new CloudCalendarSource(config, { auth, fetchImpl: io.fetch, timeoutMs: io.timeoutMs });
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
    if (parsed.version) { stdout.write(`${CLI_VERSION}\n`); return 0; }
    if (parsed.help) { stdout.write(HELP); return 0; }
    if (values["as-of"] !== undefined) throw new CloudCliError("HISTORICAL_QUERY_UNSUPPORTED", "La CLI solo soporta current cloud state; no admite consultas históricas as-of.");
    if (CLOUD_COMMANDS.has(parsed.operation)) return await runCloudCommand(parsed.operation, values, { ...io, stdin }, stdout, stderr);

    const operation = parsed.operation;
    const definition = CALENDAR_OPERATIONS[operation];
    requireCloudSource(operation, values);
    ensureCloudRequest(values);
    ensureOperationOperands(operation, values);
    const config = supabaseConfigFromEnv(io.env ?? process.env);
    const auth = await makeAuth(io, config);
    const source = new CloudCalendarSource(config, {
      auth,
      fetchImpl: io.fetch,
      timeoutMs: io.timeoutMs
    });
    const input = await source.load({
      channel: values.channel,
      calendarId: values["calendar-id"],
      mine: Boolean(values.mine)
    });

    if (!values.output) values.output = "human";
    if (!["human", "json"].includes(values.output)) throw new CloudCliError("INVALID_REQUEST", "--output debe ser human o json.");
    await confirmDestructive(operation, values, stdin, stdout);
    const payload = await buildPayload(operation, values);
    const outcome = executeCalendarOperation(input.document, { operation, payload });
    if (operation === "calendar.export-csv" || operation === "calendar.export-quarantine-csv") {
      if (values["csv-output"]) await writeNewTextFile(values["csv-output"], outcome.result.content);
      else stdout.write(outcome.result.content);
      return 0;
    }
    let written = null;
    if (!definition.readOnly && !values["dry-run"] && outcome.changed) {
      const writer = createCloudCalendarWriter(config, {
        auth,
        fetchImpl: io.fetch,
        timeoutMs: io.timeoutMs
      });
      const persisted = await writer.writeDocument({
        calendarId: input.source.calendarId,
        expectedRevision: input.source.cloudRevision,
        document: outcome.document
      });
      written = {
        kind: "cloud",
        calendarId: persisted.calendarId,
        revision: persisted.revision,
        updatedAt: persisted.updatedAt
      };
    }
    const rendered = {
      ...outcome,
      source: input.source,
      document: definition.readOnly ? undefined : outcome.document,
      written
    };
    if (!values.quiet) stdout.write(`${values.output === "json" ? JSON.stringify(rendered, null, 2) : formatHumanResult(operation, outcome, input.source, written, { dryRun: Boolean(values["dry-run"]) })}\n`);
    return 0;
  } catch (error) {
    const code = error instanceof CalendarContractError || error instanceof CloudCliError ? error.code : (error.code ?? "INTERNAL_ERROR");
    stderr.write(`${code}: ${error.message}\n`);
    if (values.debug && error.stack) stderr.write(`${error.stack}\n`);
    return exitCodeFor({ code });
  }
}

export { HELP } from "./arguments.js";
