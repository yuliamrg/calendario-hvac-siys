import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
async function normalizeTree(path, eol) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const file = join(path, entry.name);
    if (entry.isDirectory()) await normalizeTree(file, eol);
    else {
      const source = await readFile(file, "utf8");
      await writeFile(file, source.replaceAll("\r\n", "\n").replaceAll("\n", eol));
    }
  }
}

test("build Web con LF y CRLF conserva exactamente el HTML certificado", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "siys-web-eol-"));
  try {
    for (const path of ["apps/web", "packages/platform", "node_modules/three/build"]) {
      await cp(resolve(root, path), join(fixture, path), { recursive: true });
    }
    await mkdir(join(fixture, "scripts"));
    for (const file of ["build.mjs", "workspaces.mjs"]) await cp(join(root, "scripts", file), join(fixture, "scripts", file));
    const certified = await readFile(join(root, "dist/index.html"));
    const config = JSON.parse(certified.toString().match(/globalThis\.__SIYS_SUPABASE_CONFIG__ = (\{[^\n]+\});/)[1]);
    const env = { ...process.env, SIYS_SUPABASE_URL: config.url, SIYS_SUPABASE_PUBLISHABLE_KEY: config.publishableKey };
    const expected = "92e590df3e255ad8981cddb942b97ea7610ea3f588aedf9657bc784fa6622ca0";
    // This regression only certifies the current Web release/configuration.
    assert.equal(createHash("sha256").update(certified).digest("hex"), expected);
    for (const eol of ["\n", "\r\n"]) {
      for (const path of ["apps/web", "packages/platform", "scripts"]) await normalizeTree(join(fixture, path), eol);
      const result = spawnSync(process.execPath, ["scripts/build.mjs"], { cwd: fixture, env, encoding: "utf8", windowsHide: true });
      assert.equal(result.status, 0, result.stderr);
      for (const name of ["index.html", "calendario-hvac-siys.html"]) {
        const artifact = await readFile(join(fixture, "dist", name));
        assert.equal(createHash("sha256").update(artifact).digest("hex"), expected);
        assert.deepEqual(artifact, certified);
      }
    }
  } finally { await rm(fixture, { recursive: true, force: true }); }
});
