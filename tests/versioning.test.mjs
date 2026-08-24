import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
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
  assert.match(result.headCommit, /^[0-9a-f]{40}$/);
  if (result.currentTagPresent) {
    assert.match(result.currentTagCommit, /^[0-9a-f]{40}$/);
    assert.equal(result.currentTagMatchesHead, result.currentTagCommit === result.headCommit);
  }
  assert.deepEqual(result.failures, []);
});

test("la comprobación post-release exige que el tag actual apunte a HEAD", () => {
  const check = spawnSync(
    process.execPath,
    ["scripts/version-check.mjs", "--skip-dist", "--require-current-tag"],
    { cwd: root, encoding: "utf8" }
  );
  const result = JSON.parse(check.stdout);
  if (result.currentTagMatchesHead) {
    assert.equal(check.status, 0);
    assert.equal(result.status, "ok");
  } else {
    assert.notEqual(check.status, 0);
    assert.equal(result.status, "error");
    assert.match(result.failures.join(" "), /tag.*(no existe|commit exacto)/i);
  }
});
