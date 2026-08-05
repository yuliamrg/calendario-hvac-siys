import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("la comprobación automatizada de versionamiento pasa sobre la release actual", () => {
  const output = execFileSync(process.execPath, ["scripts/version-check.mjs", "--skip-dist"], {
    cwd: root,
    encoding: "utf8"
  });
  const result = JSON.parse(output);
  assert.equal(result.status, "ok");
  assert.equal(result.distEqual, null);
  assert.match(result.version, /^0\.\d+\.\d+(?:-beta\.[1-9]\d*)?$/);
  assert.match(result.stableTag, /^v\d+\.\d+\.\d+$/);
  assert.deepEqual(result.failures, []);
});
