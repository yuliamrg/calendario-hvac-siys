import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const failures = [];
const option = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const product = option("--product");
const readText = (path) => readFile(resolve(root, path), "utf8");
const readJson = async (path) => JSON.parse(await readText(path));
const isNonNegativeInteger = (value) =>
  /^\d+$/.test(value) && (value === "0" || !value.startsWith("0"));

const parseVersion = (value, label) => {
  const match = String(value ?? "").match(
    /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/
  );
  if (!match) {
    failures.push(label + " no es una versión Semantic Versioning válida: " + (value || "(vacía)") + ".");
    return null;
  }
  const [, major, minor, patch, prerelease, build] = match;
  for (const [name, number] of [["MAJOR", major], ["MINOR", minor], ["PATCH", patch]]) {
    if (!isNonNegativeInteger(number)) {
      failures.push(label + " tiene un " + name + " con ceros iniciales: " + value + ".");
    }
  }
  for (const identifier of prerelease?.split(".") ?? []) {
    if (/^\d+$/.test(identifier) && !isNonNegativeInteger(identifier)) {
      failures.push(label + " tiene un identificador prerelease numérico inválido: " + value + ".");
    }
  }
  if (build) {
    failures.push(label + " no debe usar metadata de build en una release: " + value + ".");
  }
  return { major: Number(major), minor: Number(minor), patch: Number(patch), prerelease };
};

const git = (...args) => {
  try { return execFileSync("git", args, { cwd: root, maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }); }
  catch { return null; }
};
const revision = (ref) => git("rev-parse", "--verify", ref)?.toString().trim() ?? null;
const atTag = (tag, path) => git("show", `refs/tags/${tag}:${path}`);
const versionConstant = (source, name) => source?.toString().match(new RegExp(`export const ${name} = "([^"\n]+)";`))?.[1];
const [orchestrator, lock, webPackage, cliPackage, platform, webSource, cliSource, stableSource] = await Promise.all([
  readJson("package.json"), readJson("package-lock.json"), readJson("apps/web/package.json"),
  readJson("apps/cli/package.json"), readJson("packages/platform/package.json"),
  readText("apps/web/src/ui/web-version.js"), readText("apps/cli/src/version.js"), readText("stable-version.txt")
]);
const webVersion = versionConstant(webSource, "WEB_VERSION");
const cliVersion = versionConstant(cliSource, "CLI_VERSION");
parseVersion(webVersion, "WEB_VERSION");
parseVersion(cliVersion, "CLI_VERSION");
for (const [name, pkg, version] of [["Web", webPackage, webVersion], ["CLI", cliPackage, cliVersion]]) {
  if (pkg.version !== version) failures.push(`${name} package/version no coinciden.`);
  if (pkg.private !== true) failures.push(`${name} debe permanecer privado (sin publicación npm).`);
}
if (orchestrator.private !== true || "version" in orchestrator || "version" in lock || "version" in lock.packages[""]) {
  failures.push("La raíz privada y su lock no deben poseer una versión de producto.");
}
if (platform.version !== "0.0.0" || platform.private !== true) failures.push("Platform debe permanecer interno, privado y en 0.0.0.");
for (const [path, pkg] of [["apps/web", webPackage], ["apps/cli", cliPackage], ["packages/platform", platform]]) {
  if (lock.packages[path]?.version !== pkg.version) failures.push(`Lock de ${path} no coincide con su manifiesto.`);
}
const stableTag = stableSource.trim();
const stableMatch = stableTag.match(/^web-v(.+)$/);
const stableVersion = parseVersion(stableMatch?.[1], "stable-version.txt");
if (!stableMatch || stableVersion?.prerelease) failures.push("stable-version.txt debe contener web-v<stable-semver> sin prerelease.");
const stableTagCommit = revision(`refs/tags/${stableTag}^{commit}`);
if (args.includes("--require-stable-tag") && !stableTagCommit) failures.push(`El tag estable ${stableTag} no existe.`);

let distEqual = null;
let distSha256 = null;
// CLI releases do not depend on Web artifacts or Web release tags.
if (!args.includes("--skip-dist") && product !== "cli") {
  const [named, pages] = await Promise.all([readFile(resolve(root, "dist/calendario-hvac-siys.html")), readFile(resolve(root, "dist/index.html"))]);
  distEqual = named.equals(pages);
  if (!distEqual) failures.push("Los dos artefactos de dist/ no son idénticos.");
  if (versionConstant(named, "WEB_VERSION") !== webVersion) failures.push(`dist/ no contiene WEB_VERSION ${webVersion}.`);
  distSha256 = createHash("sha256").update(named).digest("hex");
}

let releaseTag = null;
let releaseTagCommit = null;
let taggedArtifactSha256 = null;
const headCommit = revision("HEAD");
if (product) {
  if (!["web", "cli"].includes(product)) failures.push("--product debe ser web o cli.");
  const version = product === "web" ? webVersion : cliVersion;
  const expected = `${product}-v${version}`;
  releaseTag = option("--tag") ?? expected;
  if (releaseTag !== expected) failures.push(`Tag ${releaseTag} no coincide con ${expected}.`);
  releaseTagCommit = revision(`refs/tags/${releaseTag}^{commit}`);
  if (args.includes("--require-tag") && !releaseTagCommit) failures.push(`El tag ${releaseTag} no existe.`);
  if (releaseTagCommit && releaseTag === expected) {
    const pkgSource = atTag(releaseTag, `apps/${product}/package.json`);
    // Migration aliases refer to certified commits before physical workspaces.
    const legacy = product === "web" && !pkgSource;
    const taggedPackage = pkgSource ?? (legacy ? atTag(releaseTag, "package.json") : null);
    const taggedSource = atTag(releaseTag, legacy ? "src/ui/web-version.js" : product === "web" ? "apps/web/src/ui/web-version.js" : "apps/cli/src/version.js");
    if (!taggedPackage || JSON.parse(taggedPackage).version !== version || versionConstant(taggedSource, product === "web" ? "WEB_VERSION" : "CLI_VERSION") !== version) {
      failures.push(`El tag ${releaseTag} no contiene la versión solicitada de ${product}.`);
    }
    if (product === "web") {
      const artifact = atTag(releaseTag, "dist/index.html");
      const named = atTag(releaseTag, "dist/calendario-hvac-siys.html");
      if (!artifact || !named || !artifact.equals(named) || versionConstant(artifact, "WEB_VERSION") !== version) failures.push("El artefacto Web etiquetado no corresponde a la release.");
      if (artifact) taggedArtifactSha256 = createHash("sha256").update(artifact).digest("hex");
      if (distSha256 && taggedArtifactSha256 !== distSha256) failures.push("El artefacto Web actual difiere del etiquetado; requiere su propia release.");
    }
  }
  if (args.includes("--require-head") && (!releaseTagCommit || releaseTagCommit !== headCommit)) failures.push(`El tag ${releaseTag} debe corresponder al commit exacto de HEAD.`);
  if (product === "cli" && process.env.GITHUB_ACTIONS === "true" && (process.env.GITHUB_REF !== `refs/tags/${releaseTag}` || process.env.GITHUB_SHA !== headCommit)) {
    failures.push("El ref/SHA de GitHub no corresponde a la release CLI solicitada.");
  }
}
console.log(JSON.stringify({ status: failures.length ? "error" : "ok", webVersion, cliVersion, platformVersion: platform.version,
  stableTag, stableTagPresent: Boolean(stableTagCommit), stableTagCommit, headCommit, product: product ?? null,
  releaseTag, releaseTagCommit, taggedArtifactSha256, distEqual, distSha256, failures }, null, 2));
if (failures.length) process.exitCode = 1;
