import test from "node:test";
import assert from "node:assert/strict";
import { CLI_VERSION } from "../src/cli/version.js";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const bin = resolve(root, "bin", "calendary.js");

function cli(args) {
  const env = { ...process.env };
  delete env.SIYS_SUPABASE_URL;
  delete env.SIYS_SUPABASE_PUBLISHABLE_KEY;
  delete env.CALENDARY_SESSION_FILE;
  return spawnSync(process.execPath, [bin, ...args], { cwd: root, encoding: "utf8", windowsHide: true, env });
}

test("la ayuda describe una CLI cloud-only con operando y salidas seguras", () => {
  const result = cli(["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /activity\s+list \| get \| create/);
  assert.match(result.stdout, /--dry-run/);
  assert.match(result.stdout, /--source cloud/);
  assert.match(result.stdout, /--backup-file/);
  assert.match(result.stdout, /--payload-file/);
  assert.match(result.stdout, /--csv-output/);
  assert.doesNotMatch(result.stdout, /--source file\|cloud/);
  assert.doesNotMatch(result.stdout, /--input archivo/);
  assert.doesNotMatch(result.stdout, /--write archivo/);
});

test("--version imprime la identidad CLI independiente", () => {
  const result = cli(["--version"]);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), CLI_VERSION);
});

test("--source file retirado se rechaza antes de cualquier red", () => {
  const result = cli(["activity", "list", "--source", "file", "--channel", "beta", "--output", "json"]);
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /INVALID_REQUEST/);
  assert.match(result.stderr, /única autoridad/);
});

test("--input retirado se rechaza", () => {
  const result = cli(["calendar", "inspect", "--input", "cronograma.json", "--output", "json"]);
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /INVALID_REQUEST/);
});

test("--write retirado se rechaza", () => {
  const result = cli(["activity", "create", "--write", "salida.json"]);
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /INVALID_REQUEST/);
});

test("falta --source cloud y se rechaza con mensaje de autoridad", () => {
  const result = cli(["calendar", "inspect", "--channel", "beta", "--output", "json"]);
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /INVALID_REQUEST/);
  assert.match(result.stderr, /--source cloud/);
});

test("--source cloud sin --channel falla cerrado antes de la red", () => {
  const result = cli(["calendar", "inspect", "--source", "cloud", "--output", "json"]);
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /CHANNEL_INVALID/);
});

test("--backup-file fuera de backup restore|merge se rechaza", () => {
  const result = cli(["activity", "list", "--source", "cloud", "--channel", "beta", "--backup-file", "respaldo.json", "--output", "json"]);
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /INVALID_REQUEST/);
  assert.match(result.stderr, /--backup-file/);
});

test("backup restore sin --source cloud se rechaza y sugiere --backup-file", () => {
  const result = cli(["backup", "restore", "--backup-file", "respaldo.json"]);
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /--source cloud/);
  assert.match(result.stderr, /--backup-file/);
});

test("--source distinto de cloud se rechaza antes de la red", () => {
  const result = cli(["activity", "list", "--source", "bogus", "--output", "json"]);
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /INVALID_REQUEST/);
  assert.match(result.stderr, /sólo admite cloud/);
});

test("operación desconocida se rechaza", () => {
  const result = cli(["activity", "explode", "--source", "cloud", "--channel", "beta"]);
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /INVALID_REQUEST/);
});
