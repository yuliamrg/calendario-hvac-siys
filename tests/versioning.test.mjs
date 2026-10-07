import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "..");

test("versionamiento valida Web y CLI independientemente sin autoridad raíz", () => {
  const result = JSON.parse(execFileSync(process.execPath, ["scripts/version-check.mjs", "--skip-dist"], { cwd: root, encoding: "utf8" }));
  assert.equal(result.status, "ok");
  assert.equal(result.webVersion, "0.19.1");
  assert.equal(result.cliVersion, "0.18.0-beta.1");
  assert.equal(result.platformVersion, "0.0.0");
  assert.equal(result.distEqual, null);
  assert.match(result.stableTag, /^web-v\d+\.\d+\.\d+$/);
  assert.deepEqual(result.failures, []);
});

test("release CLI rechaza tags de otro producto y no depende del artefacto Web", () => {
  const check = spawnSync(process.execPath, ["scripts/version-check.mjs", "--product", "cli", "--require-tag", "--require-head", "--tag", "web-v0.18.0"], { cwd: root, encoding: "utf8" });
  assert.notEqual(check.status, 0);
  const result = JSON.parse(check.stdout);
  assert.equal(result.distEqual, null);
  assert.match(result.failures.join(" "), /no coincide/);
});
