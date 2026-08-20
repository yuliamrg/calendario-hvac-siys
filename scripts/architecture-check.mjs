import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
export const projectRoot = resolve(scriptDirectory, "..");
export const sourceRoot = resolve(projectRoot, "src");

const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);
const staticImportPattern = /\b(?:import|export)\s+(?:(?:[\s\S]*?)\s+from\s+)?["']([^"']+)["']/g;
const dynamicImportPattern = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

export const ARCHITECTURE_RULES = Object.freeze({
  domain: Object.freeze(["ui", "persistence", "cli", "cloud", "composition"]),
  core: Object.freeze(["ui", "persistence", "cli", "cloud", "composition"]),
  contract: Object.freeze(["ui", "persistence", "cli", "cloud", "composition"]),
  import: Object.freeze(["ui", "persistence", "cli", "cloud", "composition"]),
  persistence: Object.freeze(["ui", "cli", "cloud", "composition"]),
  cloud: Object.freeze(["ui", "cli", "composition"]),
  ui: Object.freeze(["persistence", "cli", "cloud", "composition"]),
  cli: Object.freeze(["ui", "persistence", "cloud", "composition"]),
  composition: Object.freeze([]),
  application: Object.freeze(["ui", "persistence", "cli", "cloud", "composition"]),
});

export function normalizeModulePath(modulePath) {
  return String(modulePath)
    .replaceAll("\\", "/")
    .replace(/^\.\//, "");
}

export function classifyModule(modulePath) {
  const normalizedPath = normalizeModulePath(modulePath);
  if (normalizedPath === "app.js") return "composition";
  if (normalizedPath === "core.js") return "core";
  if (normalizedPath === "calendar-contract.js") return "contract";
  if (normalizedPath === "cloud.js") return "cloud";
  if (normalizedPath === "importer.js" || normalizedPath.startsWith("import/")) return "import";
  if (normalizedPath.startsWith("domain/")) return "domain";
  if (normalizedPath.startsWith("persistence/")) return "persistence";
  if (normalizedPath.startsWith("ui/")) return "ui";
  if (normalizedPath.startsWith("cli/")) return "cli";
  if (normalizedPath.startsWith("application/")) return "application";
  return null;
}

function collectMatches(source, pattern) {
  return [...source.matchAll(pattern)].map((match) => match[1]);
}

export function extractLocalImportSpecifiers(source) {
  const specifiers = [
    ...collectMatches(source, staticImportPattern),
    ...collectMatches(source, dynamicImportPattern)
  ];
  return [...new Set(specifiers)].filter((specifier) => specifier.startsWith("."));
}

export function resolveLocalModulePath(importerRelativePath, specifier, root = sourceRoot) {
  const targetPath = resolve(root, dirname(importerRelativePath), specifier);
  return normalizeModulePath(relative(root, targetPath));
}

async function collectSourceFiles(directory, root, files) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await collectSourceFiles(absolutePath, root, files);
      continue;
    }
    if (!entry.isFile() || !SOURCE_EXTENSIONS.has(extname(entry.name))) continue;
    files.push(normalizeModulePath(relative(root, absolutePath)));
  }
}

export async function discoverSourceModules({ root = sourceRoot } = {}) {
  const files = [];
  await collectSourceFiles(root, root, files);
  return files.sort();
}

export async function readSourceImportGraph({ root = sourceRoot } = {}) {
  const modules = await discoverSourceModules({ root });
  const graph = new Map();

  for (const importer of modules) {
    const source = await readFile(resolve(root, importer), "utf8");
    const imports = extractLocalImportSpecifiers(source).map((specifier) => ({
      specifier,
      relativePath: resolveLocalModulePath(importer, specifier, root)
    }));
    graph.set(importer, imports);
  }

  return { root, modules, graph };
}

function violation(type, details) {
  return { type, ...details };
}

export function validateArchitectureGraph({ modules, graph }) {
  const normalizedModules = [...new Set(modules.map(normalizeModulePath))].sort();
  const moduleSet = new Set(normalizedModules);
  const violations = [];
  const compositionRoots = normalizedModules.filter(
    (modulePath) => classifyModule(modulePath) === "composition"
  );

  for (const modulePath of normalizedModules) {
    const layer = classifyModule(modulePath);
    if (!layer) {
      violations.push(violation("unknown-layer", { module: modulePath }));
    }
  }

  if (!moduleSet.has("app.js")) {
    violations.push(violation("missing-composition-root", { module: "app.js" }));
  }
  if (compositionRoots.length !== 1 || compositionRoots[0] !== "app.js") {
    violations.push(violation("invalid-composition-root", { modules: compositionRoots }));
  }

  let importCount = 0;
  for (const importer of normalizedModules) {
    const importerLayer = classifyModule(importer);
    for (const dependency of graph.get(importer) ?? []) {
      importCount += 1;
      const dependencyPath = normalizeModulePath(dependency.relativePath);
      if (!moduleSet.has(dependencyPath)) {
        violations.push(violation("missing-local-module", {
          importer,
          specifier: dependency.specifier,
          dependency: dependencyPath
        }));
        continue;
      }

      const dependencyLayer = classifyModule(dependencyPath);
      const forbiddenLayers = ARCHITECTURE_RULES[importerLayer] ?? [];
      if (dependencyLayer && forbiddenLayers.includes(dependencyLayer)) {
        violations.push(violation("forbidden-import", {
          importer,
          importerLayer,
          dependency: dependencyPath,
          dependencyLayer,
          specifier: dependency.specifier
        }));
      }
    }
  }

  return {
    ok: violations.length === 0,
    modules: normalizedModules,
    importCount,
    violations
  };
}

export async function checkArchitecture(options = {}) {
  const graph = await readSourceImportGraph(options);
  return {
    ...graph,
    ...validateArchitectureGraph(graph)
  };
}

function formatViolation(item) {
  switch (item.type) {
    case "unknown-layer":
      return `módulo sin capa declarada: ${item.module}`;
    case "missing-composition-root":
      return `falta el composition root ${item.module}`;
    case "invalid-composition-root":
      return `app.js debe ser el único composition root (actuales: ${item.modules.join(", ") || "ninguno"})`;
    case "missing-local-module":
      return `import local no resuelto: ${item.importer} -> ${item.specifier} (${item.dependency})`;
    case "forbidden-import":
      return `${item.importer} [${item.importerLayer}] no puede importar ${item.dependency} [${item.dependencyLayer}]`;
    default:
      return `violación desconocida: ${JSON.stringify(item)}`;
  }
}

export function formatArchitectureReport(report) {
  if (report.ok) {
    return `Guardia de arquitectura OK: ${report.modules.length} módulos, ${report.importCount} imports locales.`;
  }
  return [
    "Guardia de arquitectura fallida:",
    ...report.violations.map((item) => `- ${formatViolation(item)}`)
  ].join("\n");
}

export async function assertArchitecture(options = {}) {
  const report = await checkArchitecture(options);
  if (!report.ok) throw new Error(formatArchitectureReport(report));
  return report;
}

const isMainModule = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  try {
    const report = await checkArchitecture();
    console.log(formatArchitectureReport(report));
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    console.error(`Guardia de arquitectura no pudo ejecutarse: ${error.message}`);
    process.exitCode = 1;
  }
}
