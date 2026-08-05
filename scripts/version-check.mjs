import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const args = new Set(process.argv.slice(2));
const failures = [];
const skipDist = args.has("--skip-dist");

const readText = (relativePath) => readFile(resolve(root, relativePath), "utf8");

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

const localTagExists = (tag) => {
  try {
    execFileSync("git", ["rev-parse", "--verify", "refs/tags/" + tag], {
      cwd: root,
      stdio: "ignore"
    });
    return true;
  } catch {
    return false;
  }
};

const [packageSource, lockSource, coreSource, stableSource, namedDist, pagesDist] =
  await Promise.all([
    readText("package.json"),
    readText("package-lock.json"),
    readText("src/core.js"),
    readText("stable-version.txt"),
    readFile(resolve(root, "dist", "calendario-hvac-siys.html")),
    readFile(resolve(root, "dist", "index.html"))
  ]);

let packageJson;
let lockJson;
try {
  packageJson = JSON.parse(packageSource);
} catch (error) {
  failures.push("package.json no es JSON válido: " + error.message);
}
try {
  lockJson = JSON.parse(lockSource);
} catch (error) {
  failures.push("package-lock.json no es JSON válido: " + error.message);
}

const packageVersion = packageJson?.version;
const parsedPackage = parseVersion(packageVersion, "package.json > version");
const coreMatch = coreSource.match(/export const APP_VERSION = "([^"]+)";/);
const coreVersion = coreMatch?.[1];
if (!coreMatch) failures.push("src/core.js no declara APP_VERSION con el formato esperado.");
parseVersion(coreVersion, "src/core.js > APP_VERSION");

if (packageVersion && coreVersion && packageVersion !== coreVersion) {
  failures.push("package.json (" + packageVersion + ") y APP_VERSION (" + coreVersion + ") no coinciden.");
}
if (lockJson?.version !== undefined && lockJson.version !== packageVersion) {
  failures.push("package-lock.json > version (" + lockJson.version + ") no coincide con package.json (" + packageVersion + ").");
}
if (lockJson?.packages?.[""]?.version !== undefined &&
    lockJson.packages[""].version !== packageVersion) {
  failures.push("package-lock.json > packages[\"\"].version (" + lockJson.packages[""].version + ") no coincide con package.json (" + packageVersion + ").");
}

const stableTag = stableSource.trim();
const stableMatch = stableTag.match(/^v(.+)$/);
const parsedStable = parseVersion(stableMatch?.[1], "stable-version.txt");
if (!stableMatch) {
  failures.push("stable-version.txt debe contener un tag como v0.14.0: " + (stableTag || "(vacío)") + ".");
} else if (parsedStable?.prerelease) {
  failures.push("stable-version.txt no puede apuntar a una prerelease: " + stableTag + ".");
}

if (parsedPackage?.prerelease) {
  const betaMatch = parsedPackage.prerelease.match(/^beta\.(\d+)$/);
  if (!betaMatch || !isNonNegativeInteger(betaMatch[1]) || Number(betaMatch[1]) < 1) {
    failures.push("La prerelease actual debe tener el formato beta.N con N >= 1: " + packageVersion + ".");
  }
}

let distEqual = null;
let distSha256 = null;
if (!skipDist) {
  distEqual = namedDist.equals(pagesDist);
  if (!distEqual) failures.push("Los dos artefactos de dist/ no son idénticos.");
  const distText = namedDist.toString("utf8");
  if (packageVersion && !distText.includes('APP_VERSION = "' + packageVersion + '"')) {
    failures.push("dist/ no contiene APP_VERSION " + packageVersion + "; regenere con npm run build.");
  }
  distSha256 = createHash("sha256").update(namedDist).digest("hex");
}

const stableTagPresent = stableTag ? localTagExists(stableTag) : false;
if (args.has("--require-stable-tag") && !stableTagPresent) {
  failures.push("El tag estable " + stableTag + " no existe en el repositorio local.");
}

const currentTag = packageVersion ? "v" + packageVersion : null;
const currentTagPresent = currentTag ? localTagExists(currentTag) : false;
if (args.has("--require-current-tag") && !currentTagPresent) {
  failures.push("El tag de la versión actual " + currentTag + " no existe en el repositorio local.");
}

const result = {
  status: failures.length ? "error" : "ok",
  version: packageVersion ?? null,
  channel: parsedPackage?.prerelease ? "beta" : "stable",
  stableTag,
  stableTagPresent,
  currentTag,
  currentTagPresent,
  distEqual,
  distSha256,
  failures
};

console.log(JSON.stringify(result, null, 2));
if (failures.length) process.exitCode = 1;
