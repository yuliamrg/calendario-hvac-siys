import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { builtinModules } from "node:module";
import { buildCliRelease } from "../scripts/build-cli-release.mjs";
import { extractImportSpecifiers } from "../scripts/architecture-check.mjs";
import { CLI_VERSION } from "../apps/cli/src/version.js";

async function inventory(root, path = root) {
  const files = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    assert.equal(entry.isSymbolicLink(), false);
    const absolute = join(path, entry.name);
    if (entry.isDirectory()) files.push(...await inventory(root, absolute));
    else files.push(relative(root, absolute).replaceAll("\\", "/"));
  }
  return files.sort();
}

test("la distribución CLI es autocontenida, reproducible y funciona sin workspace ni red", async () => {
  const temp = await mkdtemp(join(tmpdir(), "calendary-distribution-"));
  try {
    const output = join(temp, "package");
    await buildCliRelease({ outputDirectory: output });
    const second = join(temp, "second");
    await buildCliRelease({ outputDirectory: second });
    const files = await inventory(output);
    assert.deepEqual(files, await inventory(second));
    assert.ok(files.includes("node_modules/@siys-sync/platform/src/calendar-contract.js"));
    const platform = JSON.parse(await readFile(join(output, "node_modules/@siys-sync/platform/package.json"), "utf8"));
    for (const file of files) {
      assert.match(file, /^(?:package\.json|README\.txt|(?:bin|src)\/.+\.js|node_modules\/@siys-sync\/platform\/(?:package\.json|src\/.+\.js))$/);
      assert.doesNotMatch(file, /(?:web|vendor|supabase\/migrations|fixture|\.git|\.env)/i);
      const bytes = await readFile(join(output, file));
      assert.deepEqual(bytes, await readFile(join(second, file)), `determinismo: ${file}`);
      if (!file.endsWith(".js")) continue;
      for (const specifier of extractImportSpecifiers(bytes.toString())) {
        if (specifier.startsWith("node:")) { assert.ok(builtinModules.includes(specifier.slice(5))); continue; }
        let target;
        if (specifier.startsWith(".")) target = resolve(dirname(join(output, file)), specifier);
        else {
          assert.ok(specifier.startsWith("@siys-sync/platform/"), specifier);
          const key = `./${specifier.slice("@siys-sync/platform/".length)}`;
          assert.ok(platform.exports[key], specifier);
          target = resolve(output, "node_modules/@siys-sync/platform", platform.exports[key]);
        }
        const resolved = await realpath(target);
        const inside = relative(await realpath(output), resolved);
        assert.ok(!isAbsolute(inside) && !inside.startsWith(".."), `${file}: ${specifier} sale del paquete`);
      }
    }
    // This preload turns any accidental network request into a failing smoke test.
    const guard = join(temp, "no-network.cjs");
    await writeFile(guard, 'globalThis.fetch = () => { throw new Error("NETWORK_FORBIDDEN"); };');
    const env = { ...process.env };
    for (const key of ["SIYS_SUPABASE_URL", "SIYS_SUPABASE_PUBLISHABLE_KEY", "CALENDARY_SESSION_FILE", "NODE_PATH", "NODE_OPTIONS"]) delete env[key];
    const cli = (...args) => spawnSync(process.execPath, ["--require", guard, "bin/calendary.js", ...args], { cwd: output, encoding: "utf8", windowsHide: true, env });
    const version = cli("--version");
    assert.equal(version.status, 0, version.stderr);
    assert.equal(version.stdout.trim(), CLI_VERSION);
    const help = cli("--help");
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /--source cloud/);
    const invalid = cli("calendar", "inspect", "--channel", "beta", "--output", "json");
    assert.equal(invalid.status, 2, invalid.stderr);
    assert.match(invalid.stderr, /INVALID_REQUEST/);
    assert.doesNotMatch(invalid.stderr, /NETWORK_FORBIDDEN/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
