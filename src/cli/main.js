import { stdin as defaultStdin, stdout as defaultStdout, stderr as defaultStderr } from "node:process";
import { CALENDAR_OPERATIONS, CalendarContractError, executeCalendarOperation } from "../calendar-contract.js";
import { APP_VERSION } from "../core.js";
import { readCalendarFile, writeCalendarFile } from "./files.js";
import { HELP, buildPayload, parseCli } from "./arguments.js";
import {
  confirmDestructive,
  exitCodeFor,
  formatHumanResult,
  writeNewTextFile
} from "./io.js";

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
    if (!values.quiet) stdout.write(`${values.output === "json" ? JSON.stringify({ ...outcome, document: definition.readOnly ? undefined : outcome.document, written }, null, 2) : formatHumanResult(parsed.operation, outcome)}\n`);
    return 0;
  } catch (error) {
    const code = error instanceof CalendarContractError ? error.code : (error.code ?? "INTERNAL_ERROR");
    stderr.write(`${code}: ${error.message}\n`);
    if (values.debug && error.stack) stderr.write(`${error.stack}\n`);
    return exitCodeFor({ code });
  }
}

export { HELP } from "./arguments.js";
