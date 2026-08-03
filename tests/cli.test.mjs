import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createBackupEnvelope, createDefaultDocument } from "../src/core.js";

const root = resolve(import.meta.dirname, "..");
const bin = resolve(root, "bin", "calendary.js");

function cli(args) {
  return spawnSync(process.execPath, [bin, ...args], { cwd: root, encoding: "utf8" });
}

async function fixture() {
  const directory = await mkdtemp(resolve(tmpdir(), "calendary-cli-"));
  const input = resolve(directory, "input.json");
  const document = createDefaultDocument("2026-08-03", "2026-08-03T00:00:00.000Z");
  await writeFile(input, JSON.stringify(createBackupEnvelope(document, { channel: "local" })), "utf8");
  return { directory, input };
}

test("la ayuda enumera grupos, contrato y medidas de seguridad", () => {
  const result = cli(["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /activity\s+list \| get \| create/);
  assert.match(result.stdout, /--dry-run/);
});

test("inspect entrega JSON limpio por stdout", async () => {
  const { input } = await fixture();
  const result = cli(["calendar", "inspect", "--input", input, "--output", "json"]);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.operation, "calendar.inspect");
  assert.equal(output.result.counts.activities, 0);
});

test("una escritura exige destino nuevo y genera un respaldo compatible", async () => {
  const { directory, input } = await fixture();
  const output = resolve(directory, "created.json");
  const payload = JSON.stringify({
    date: "2026-08-03", serviceType: "administrative", status: "scheduled",
    observations: "Planeación semanal"
  });
  const result = cli(["activity", "create", "--input", input, "--write", output, "--payload", payload, "--output", "json"]);
  assert.equal(result.status, 0, result.stderr);
  const stored = JSON.parse(await readFile(output, "utf8"));
  assert.equal(stored.document.activities.length, 1);
  const repeated = cli(["activity", "create", "--input", input, "--write", output, "--payload", payload]);
  assert.equal(repeated.status, 4);
  assert.match(repeated.stderr, /OUTPUT_EXISTS/);
});

test("delete requiere confirmación explícita fuera de una terminal", async () => {
  const { directory, input } = await fixture();
  const output = resolve(directory, "deleted.json");
  const result = cli(["activity", "delete", "--input", input, "--write", output, "--activity-ids", "missing"]);
  assert.equal(result.status, 4);
  assert.match(result.stderr, /CONFIRMATION_REQUIRED/);
});
