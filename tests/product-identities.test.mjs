import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import * as core from "../packages/platform/src/core.js";
import { CONTRACT_VERSION, executeCalendarOperation } from "../packages/platform/src/calendar-contract.js";
import { WEB_VERSION } from "../apps/web/src/ui/web-version.js";
import { CLI_VERSION } from "../apps/cli/src/version.js";
import { applicationModulePaths, discoverApplicationModules } from "../scripts/build.mjs";

const root = resolve(import.meta.dirname, "..");
const CLI_BIN = "apps/cli/bin/calendary.js";
const NOW = "2026-09-01T10:00:00.000Z";
const makeDocument = (appVersion = "0.6.0") => core.createDefaultDocument("2026-09-01", NOW, { appVersion });
const operate = (document, operation, payload) => executeCalendarOperation(document, { operation, payload }, { now: NOW });

test("Web and CLI expose explicit transitional identities; shared core owns no release", async () => {
  assert.equal(WEB_VERSION, "0.18.0-beta.2");
  assert.equal(CLI_VERSION, "0.18.0-beta.1");
  const packageVersion = (await import("../package.json", { with: { type: "json" } })).default.version;
  assert.equal(packageVersion, undefined);
  assert.equal(WEB_VERSION, "0.18.0-beta.2");
  assert.equal(CLI_VERSION, "0.18.0-beta.1");
  assert.notEqual(WEB_VERSION, CLI_VERSION);
  for (const symbol of ["APP_VERSION", "WEB_VERSION", "CLI_VERSION"]) assert.equal(symbol in core, false);
  assert.equal(core.SCHEMA_VERSION, 4);
  assert.equal(CONTRACT_VERSION, 1);
  assert.equal(execFileSync(process.execPath, [CLI_BIN, "--version"], { cwd: root, encoding: "utf8" }), `${CLI_VERSION}\n`);
});

test("the Web workspace identity matches its package manifest and the platform keeps no release identity", async () => {
  const webPackage = (await import("../apps/web/package.json", { with: { type: "json" } })).default;
  const cliPackage = (await import("../apps/cli/package.json", { with: { type: "json" } })).default;
  const platformPackage = (await import("../packages/platform/package.json", { with: { type: "json" } })).default;
  assert.equal(webPackage.version, WEB_VERSION);
  assert.equal(cliPackage.version, CLI_VERSION);
  assert.equal(webPackage.private, true);
  assert.equal(cliPackage.private, true);
  assert.equal(platformPackage.private, true);
  assert.equal("WEB_VERSION" in core, false);
  assert.equal("CLI_VERSION" in core, false);
});

test("default construction accepts explicit legacy metadata and otherwise claims no product", () => {
  assert.equal(makeDocument(WEB_VERSION).appVersion, WEB_VERSION);
  assert.equal(core.createDefaultDocument("2026-09-01", NOW).appVersion, "");
  assert.equal(makeDocument(" opaque legacy ").appVersion, "opaque legacy");
});

test("sanitization preserves historical opaque metadata and does not fabricate missing/invalid identity", () => {
  assert.equal(core.sanitizeDocument(makeDocument(" 0.6.0\u0000 ")).appVersion, "0.6.0");
  for (const value of [undefined, null, "", "   ", {}, [], 123, false]) {
    const document = makeDocument();
    if (value === undefined) delete document.appVersion;
    else document.appVersion = value;
    assert.equal(core.sanitizeDocument(document).appVersion, "");
    assert.equal(core.parseBackup(document).document.appVersion, "");
  }
});

test("normal contract writes preserve historical metadata without product options", () => {
  const document = makeDocument();
  const result = operate(document, "calendar.identify", { name: "Cronograma actualizado" });
  assert.equal(result.changed, true);
  assert.equal(result.document.appVersion, "0.6.0");
  assert.equal(result.document.calendarMeta.revision, 1);
});

test("backup format 1 explicitly describes exporter independently of document metadata", () => {
  const document = makeDocument();
  const backup = core.createBackupEnvelope(document, { exporterVersion: WEB_VERSION, exportedAt: NOW });
  assert.equal(backup.appVersion, WEB_VERSION);
  assert.equal(backup.document.appVersion, "0.6.0");
  assert.equal(backup.formatVersion, 1);
  assert.equal(core.parseBackup(backup).document.appVersion, "0.6.0");
  assert.equal(core.createBackupEnvelope(document).appVersion, "");
  assert.equal(core.parseBackup({ ...backup, appVersion: "unknown historical exporter" }).document.appVersion, "0.6.0");
  assert.throws(() => core.parseBackup({ ...backup, formatVersion: 2 }), /formato.*compatible/);
  assert.throws(() => core.parseBackup({ ...backup, document: { ...document, schemaVersion: 5 } }), /más reciente/);
  assert.throws(() => operate({ ...document, schemaVersion: 5 }, "calendar.inspect", {}), (error) => error.code === "UNSUPPORTED_SCHEMA");
});

test("restore uses backup legacy metadata; merge retains current metadata, including neutral legacy values", () => {
  for (const appVersion of ["0.6.0", undefined]) {
    const incoming = makeDocument();
    if (appVersion === undefined) delete incoming.appVersion;
    incoming.calendarMeta.revision = 7;
    incoming.catalog.clients.push({ id: "incoming", name: "Cliente", active: true, updatedAt: NOW });
    const backup = core.createBackupEnvelope(incoming, { exporterVersion: WEB_VERSION });
    const current = makeDocument("opaque-current");
    const restored = operate(current, "backup.restore", { document: core.parseBackup(backup).document });
    assert.equal(restored.document.appVersion, appVersion ?? "");
    assert.equal(restored.document.calendarMeta.revision, 7);
    const merged = operate(current, "backup.merge", { document: core.parseBackup(backup).document });
    assert.equal(merged.document.appVersion, "opaque-current");
    assert.equal(merged.document.catalog.clients.length, 1);
    assert.equal(core.mergeBackupDocument(current, incoming).document.appVersion, "opaque-current");
    delete current.appVersion;
    assert.equal(core.mergeBackupDocument(current, incoming).document.appVersion, "");
  }
});

test("Web wiring uses its identity only for new documents, UI and explicit backup export; manifest excludes CLI", async () => {
  const app = await readFile(resolve(root, "apps", "web", "src", "app.js"), "utf8");
  assert.match(app, /createDefaultDocument\(undefined, undefined, \{ appVersion: WEB_VERSION \}\)/);
  assert.match(app, /exporterVersion: WEB_VERSION/);
  assert.match(app, /versionLabel\.textContent = `Versión \$\{WEB_VERSION\}/);
  assert.doesNotMatch(app, /\.appVersion\s*=/);
  const discovery = await discoverApplicationModules();
  assert.ok(discovery.modules.includes("apps/web/src/ui/web-version.js"));
  for (const paths of [discovery.modules, applicationModulePaths]) {
    assert.equal(paths.some((path) => path.startsWith("apps/cli/")), false);
    assert.equal(paths.some((path) => path.startsWith("packages/platform/")), true);
  }
});

test("a source-controlled differing CLI version changes --version while Web checks and historical tag gates still pass", async () => {
  const fixture = await mkdtemp(resolve(tmpdir(), "siys-product-identities-"));
  try {
    for (const path of ["apps", "packages", "package.json", "package-lock.json", "stable-version.txt"]) {
      await cp(resolve(root, path), resolve(fixture, path), { recursive: true });
    }
    await mkdir(resolve(fixture, "tests"));
    await cp(resolve(root, "tests/cli.test.mjs"), resolve(fixture, "tests/cli.test.mjs"));
    await mkdir(resolve(fixture, "scripts"));
    await cp(resolve(root, "scripts/version-check.mjs"), resolve(fixture, "scripts/version-check.mjs"));
    await mkdir(resolve(fixture, "node_modules", "@siys-sync"), { recursive: true });
    await cp(
      resolve(root, "packages", "platform"),
      resolve(fixture, "node_modules", "@siys-sync", "platform"),
      { recursive: true }
    );
    await mkdir(resolve(fixture, "dist"));
    const dist = `export const WEB_VERSION = "${WEB_VERSION}";`;
    for (const name of ["index.html", "calendario-hvac-siys.html"]) await writeFile(resolve(fixture, "dist", name), dist);
    // Hypothetical fixture only: this is not a selected CLI release number.
    const hypothetical = "9.8.7-beta.2";
    const writeCliVersion = async (value) => {
      await writeFile(resolve(fixture, "apps/cli/src/version.js"), `export const CLI_VERSION = "${value}";`);
      const cliPackagePath = resolve(fixture, "apps", "cli", "package.json");
      const cliPackage = JSON.parse(await readFile(cliPackagePath, "utf8"));
      cliPackage.version = value;
      const lockPath = resolve(fixture, "package-lock.json");
      const lock = JSON.parse(await readFile(lockPath, "utf8"));
      lock.packages["apps/cli"].version = value;
      await writeFile(lockPath, JSON.stringify(lock));
      await writeFile(cliPackagePath, `${JSON.stringify(cliPackage, null, 2)}\n`);
    };
    await writeCliVersion(hypothetical);
    const git = (...args) => execFileSync("git", args, { cwd: fixture, stdio: "pipe" });
    git("init");
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", "fixture");
    git("add", "apps", "packages", "dist");
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "product sources");
    git("tag", "web-v0.17.0");
    git("tag", `web-v${WEB_VERSION}`);
    const check = (...args) => spawnSync(process.execPath, ["scripts/version-check.mjs", ...args], { cwd: fixture, encoding: "utf8", env: { ...process.env, GITHUB_ACTIONS: "false" } });
    const passing = check("--require-stable-tag", "--product", "web", "--require-tag");
    assert.equal(passing.status, 0, passing.stdout + passing.stderr);
    const result = JSON.parse(passing.stdout);
    assert.equal(result.webVersion, WEB_VERSION);
    assert.equal(result.cliVersion, hypothetical);
    assert.equal(result.distEqual, true);
    assert.equal(result.releaseTag, `web-v${WEB_VERSION}`);
    assert.equal(result.releaseTagCommit, result.headCommit);
    assert.equal(execFileSync(process.execPath, [CLI_BIN, "--version"], { cwd: fixture, encoding: "utf8" }), `${hypothetical}\n`);
    const smoke = spawnSync(process.execPath, ["--test", "tests/cli.test.mjs"], { cwd: fixture, encoding: "utf8" });
    assert.equal(smoke.status, 0, smoke.stdout + smoke.stderr);
    git("tag", `cli-v${hypothetical}`);
    const cliCheck = (...extra) => check("--product", "cli", "--require-tag", "--require-head", ...extra);
    assert.equal(cliCheck().status, 0);
    const workflowEnv = { ...process.env, GITHUB_ACTIONS: "true", GITHUB_REF: `refs/tags/cli-v${hypothetical}`, GITHUB_SHA: result.headCommit };
    const workflowCheck = () => spawnSync(process.execPath, ["scripts/version-check.mjs", "--product", "cli", "--require-tag", "--require-head"], { cwd: fixture, encoding: "utf8", env: workflowEnv });
    assert.equal(workflowCheck().status, 0);
    workflowEnv.GITHUB_REF = "refs/heads/main";
    assert.match(JSON.parse(workflowCheck().stdout).failures.join(" "), /ref\/SHA/);
    assert.match(JSON.parse(cliCheck("--tag", `cli-v${WEB_VERSION}`).stdout).failures.join(" "), /no coincide/);
    // Independent validation must still reject invalid CLI SemVer and incorrect Web artifacts.
    await writeCliVersion("invalid");
    assert.match(JSON.parse(check().stdout).failures.join(" "), /CLI_VERSION.*Semantic Versioning/);
    await writeCliVersion(hypothetical);
    await writeFile(resolve(fixture, "dist/index.html"), "stale Web artifact");
    assert.match(JSON.parse(check().stdout).failures.join(" "), /no son idénticos/);
    for (const name of ["index.html", "calendario-hvac-siys.html"]) await writeFile(resolve(fixture, "dist", name), "stale Web artifact");
    assert.match(JSON.parse(check().stdout).failures.join(" "), /dist.*WEB_VERSION/);
    git("tag", "-d", "web-v0.17.0");
    assert.match(JSON.parse(check("--skip-dist", "--require-stable-tag").stdout).failures.join(" "), /tag estable.*no existe/);
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", "later");
    assert.equal(check("--skip-dist", "--product", "web", "--require-tag").status, 0);
    assert.match(JSON.parse(cliCheck().stdout).failures.join(" "), /commit exacto/);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
