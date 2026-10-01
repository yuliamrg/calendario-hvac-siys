import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PLATFORM_PACKAGE_NAME,
  PLATFORM_SPECIFIER_PREFIX,
  WORKSPACES,
  isPlatformSpecifier,
  normalizeModulePath,
  projectPathForPlatformSpecifier,
  projectRoot,
  readWorkspaceExports,
  workspaceForModulePath
} from "./workspaces.mjs";

export { projectRoot };

export const compositionRoot = `${WORKSPACES.web.sourceRoot}/app.js`;

const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);
const staticImportPattern = /\b(?:import|export)\s+(?:(?:[\s\S]*?)\s+from\s+)?["']([^"']+)["']/g;
const dynamicImportPattern = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

export const ARCHITECTURE_RULES = Object.freeze({
  "platform/domain": Object.freeze([
    "platform/core",
    "platform/contract",
    "platform/supabase",
    "web/composition",
    "web/cloud",
    "web/import",
    "web/application",
    "web/persistence",
    "web/ui",
    "cli"
  ]),
  "platform/core": Object.freeze([
    "platform/contract",
    "platform/supabase",
    "web/composition",
    "web/cloud",
    "web/import",
    "web/application",
    "web/persistence",
    "web/ui",
    "cli"
  ]),
  "platform/contract": Object.freeze([
    "platform/supabase",
    "web/composition",
    "web/cloud",
    "web/import",
    "web/application",
    "web/persistence",
    "web/ui",
    "cli"
  ]),
  "platform/supabase": Object.freeze([
    "platform/domain",
    "platform/core",
    "platform/contract",
    "web/composition",
    "web/cloud",
    "web/import",
    "web/application",
    "web/persistence",
    "web/ui",
    "cli"
  ]),
  "web/composition": Object.freeze(["cli"]),
  "web/cloud": Object.freeze([
    "web/composition",
    "web/import",
    "web/application",
    "web/persistence",
    "web/ui",
    "cli"
  ]),
  "web/import": Object.freeze([
    "platform/contract",
    "platform/supabase",
    "web/cloud",
    "web/composition",
    "web/persistence",
    "web/ui",
    "cli"
  ]),
  "web/application": Object.freeze([
    "platform/contract",
    "platform/supabase",
    "web/cloud",
    "web/composition",
    "web/import",
    "web/persistence",
    "web/ui",
    "cli"
  ]),
  "web/persistence": Object.freeze([
    "platform/core",
    "platform/contract",
    "platform/supabase",
    "web/cloud",
    "web/composition",
    "web/import",
    "web/application",
    "web/ui",
    "cli"
  ]),
  "web/ui": Object.freeze([
    "platform/core",
    "platform/contract",
    "platform/supabase",
    "web/cloud",
    "web/composition",
    "web/persistence",
    "cli"
  ]),
  cli: Object.freeze([
    "web/composition",
    "web/cloud",
    "web/import",
    "web/application",
    "web/persistence",
    "web/ui"
  ])
});

export const APPLICATION_FORBIDDEN_TOKENS = Object.freeze([
  "document",
  "window",
  "globalThis",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "fetch",
  "BroadcastChannel",
  "Supabase",
  "XLSX"
]);

export const PLATFORM_FORBIDDEN_TOKENS = Object.freeze([
  "window",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "BroadcastChannel",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource"
]);

export const APPLICATION_FORBIDDEN_PACKAGES = Object.freeze([
  "xlsx",
  "exceljs",
  "supabase",
  "@supabase/supabase-js"
]);

export const SUPABASE_RUNTIME_IMPORT_PREFIX = "node:";

export function classifyModule(modulePath) {
  const normalized = normalizeModulePath(modulePath);
  if (normalized.startsWith("apps/cli/bin/")) return "cli";
  const workspace = workspaceForModulePath(normalized);
  if (!workspace) return null;
  const relativePath = normalized.slice(workspace.sourceRoot.length + 1);
  if (workspace.id === "platform") {
    if (relativePath === "core.js") return "platform/core";
    if (relativePath === "calendar-contract.js") return "platform/contract";
    if (relativePath.startsWith("domain/")) return "platform/domain";
    if (relativePath.startsWith("supabase/")) return "platform/supabase";
    return null;
  }
  if (workspace.id === "web") {
    if (relativePath === "app.js") return "web/composition";
    if (relativePath === "cloud.js") return "web/cloud";
    if (relativePath === "importer.js" || relativePath.startsWith("import/")) return "web/import";
    if (relativePath.startsWith("persistence/")) return "web/persistence";
    if (relativePath.startsWith("application/")) return "web/application";
    if (relativePath.startsWith("ui/")) return "web/ui";
    return null;
  }
  if (workspace.id === "cli") return "cli";
  return null;
}

function collectMatches(source, pattern) {
  return [...source.matchAll(pattern)].map((match) => match[1]);
}

function stripCommentsAndStringLiterals(source) {
  let code = "";
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (char === "/" && next === "/") {
      index += 2;
      while (index < source.length && source[index] !== "\n") index += 1;
      code += "\n";
      continue;
    }
    if (char === "/" && next === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) index += 1;
      index = Math.min(index + 2, source.length);
      code += " ";
      continue;
    }
    if (char === "'" || char === "\"" || char === "`") {
      const quote = char;
      index += 1;
      while (index < source.length) {
        if (source[index] === "\\") {
          index += 2;
          continue;
        }
        if (source[index] === quote) {
          index += 1;
          break;
        }
        index += 1;
      }
      code += " ";
      continue;
    }
    code += char;
    index += 1;
  }
  return code;
}

function findForbiddenTokens(source, tokens) {
  const code = stripCommentsAndStringLiterals(source);
  const pattern = new RegExp(`(?<![.\\w$])(?:${tokens.join("|")})\\b`, "g");
  const found = new Set();
  for (const match of code.matchAll(pattern)) {
    const token = match[0];
    const after = code.slice(match.index + token.length);
    if (/^\s*:/.test(after)) continue;
    found.add(token);
  }
  return [...found];
}

export function findForbiddenSemanticReferences(source) {
  return findForbiddenTokens(source, APPLICATION_FORBIDDEN_TOKENS);
}

export function findForbiddenPlatformReferences(source) {
  return findForbiddenTokens(source, PLATFORM_FORBIDDEN_TOKENS);
}

export function isForbiddenApplicationPackage(specifier) {
  return APPLICATION_FORBIDDEN_PACKAGES.includes(specifier)
    || specifier.startsWith("@supabase/");
}

export function findForbiddenPackageReferences(source) {
  const specifiers = [
    ...collectMatches(source, staticImportPattern),
    ...collectMatches(source, dynamicImportPattern)
  ];
  return [...new Set(specifiers.filter(isForbiddenApplicationPackage))];
}

export function extractImportSpecifiers(source) {
  const specifiers = [
    ...collectMatches(source, staticImportPattern),
    ...collectMatches(source, dynamicImportPattern)
  ];
  return [...new Set(specifiers)];
}

export function findForbiddenSupabaseRuntimeImports(source) {
  return extractImportSpecifiers(source)
    .filter((specifier) => specifier.startsWith(SUPABASE_RUNTIME_IMPORT_PREFIX));
}

export function resolveImportSpecifier(importerProjectPath, specifier) {
  if (specifier.startsWith(".")) {
    return normalizeModulePath(relative(projectRoot, resolve(projectRoot, dirname(importerProjectPath), specifier)));
  }
  if (isPlatformSpecifier(specifier)) {
    return projectPathForPlatformSpecifier(specifier);
  }
  return null;
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

export async function discoverSourceModules() {
  const files = [];
  for (const workspace of Object.values(WORKSPACES)) {
    await collectSourceFiles(resolve(projectRoot, workspace.sourceRoot), projectRoot, files);
  }
  await collectSourceFiles(resolve(projectRoot, "apps/cli/bin"), projectRoot, files);
  return files.sort();
}

export async function readSourceImportGraph() {
  const modules = await discoverSourceModules();
  const graph = new Map();
  const sources = new Map();

  for (const importer of modules) {
    const source = await readFile(resolve(projectRoot, importer), "utf8");
    sources.set(importer, source);
    const imports = extractImportSpecifiers(source).map((specifier) => ({
      specifier,
      projectPath: resolveImportSpecifier(importer, specifier)
    }));
    graph.set(importer, imports);
  }

  return { modules, graph, sources };
}

function violation(type, details) {
  return { type, ...details };
}

export function countModulesByBoundary(modules) {
  const counts = {};
  for (const modulePath of modules) {
    const boundary = classifyModule(modulePath) ?? "unknown";
    counts[boundary] = (counts[boundary] ?? 0) + 1;
  }
  return counts;
}

export function validateArchitectureGraph({ modules, graph, sources, platformExports }) {
  const normalizedModules = [...new Set(modules.map(normalizeModulePath))].sort();
  const moduleSet = new Set(normalizedModules);
  const violations = [];
  const compositionRoots = normalizedModules.filter(
    (modulePath) => classifyModule(modulePath) === "web/composition"
  );

  for (const modulePath of normalizedModules) {
    if (!classifyModule(modulePath)) {
      violations.push(violation("unknown-layer", { module: modulePath }));
    }
  }

  if (!moduleSet.has(compositionRoot)) {
    violations.push(violation("missing-composition-root", { module: compositionRoot }));
  }
  if (compositionRoots.length !== 1 || compositionRoots[0] !== compositionRoot) {
    violations.push(violation("invalid-composition-root", {
      modules: compositionRoots,
      expected: compositionRoot
    }));
  }

  let importCount = 0;
  for (const importer of normalizedModules) {
    const importerBoundary = classifyModule(importer);
    for (const dependency of graph.get(importer) ?? []) {
      importCount += 1;
      const specifier = dependency.specifier;
      const dependencyPath = dependency.projectPath ? normalizeModulePath(dependency.projectPath) : null;
      if (!dependencyPath) {
        if (!specifier.startsWith(SUPABASE_RUNTIME_IMPORT_PREFIX)) {
          violations.push(violation("unresolved-import", { importer, specifier }));
        }
        continue;
      }
      if (!moduleSet.has(dependencyPath)) {
        violations.push(violation("missing-local-module", {
          importer,
          specifier,
          dependency: dependencyPath
        }));
        continue;
      }

      if (Array.isArray(platformExports) && specifier.startsWith(PLATFORM_SPECIFIER_PREFIX)) {
        const subpath = `.${specifier.slice(PLATFORM_PACKAGE_NAME.length)}`;
        if (!platformExports.includes(subpath)) {
          violations.push(violation("undeclared-platform-export", { importer, specifier, subpath }));
        }
      }

      const dependencyBoundary = classifyModule(dependencyPath);
      const forbiddenBoundaries = ARCHITECTURE_RULES[importerBoundary] ?? [];
      if (dependencyBoundary && forbiddenBoundaries.includes(dependencyBoundary)) {
        violations.push(violation("forbidden-import", {
          importer,
          importerBoundary,
          dependency: dependencyPath,
          dependencyBoundary,
          specifier
        }));
      }
    }
  }

  if (sources) {
    for (const modulePath of normalizedModules) {
      const boundary = classifyModule(modulePath);
      const source = sources.get(modulePath);
      if (typeof source !== "string") continue;
      if (["platform/domain", "platform/core", "platform/contract", "web/application", "web/import", "platform/supabase"].includes(boundary)) {
        const code = stripCommentsAndStringLiterals(source);
        for (const token of ["APP_VERSION", "WEB_VERSION", "CLI_VERSION"]) {
          if (new RegExp(`\\b${token}\\b`).test(code)) {
            violations.push(violation("shared-product-version", { module: modulePath, token }));
          }
        }
      }
      if (["platform/domain", "platform/core", "platform/contract"].includes(boundary)) {
        for (const specifier of findForbiddenSupabaseRuntimeImports(source)) {
          violations.push(violation("forbidden-platform-runtime-import", { module: modulePath, specifier }));
        }
        for (const token of findForbiddenPlatformReferences(source)) {
          violations.push(violation("forbidden-platform-reference", { module: modulePath, token }));
        }
      }
      if (boundary === "web/application") {
        for (const token of findForbiddenSemanticReferences(source)) {
          violations.push(violation("forbidden-semantic-reference", { module: modulePath, token }));
        }
        for (const specifier of findForbiddenPackageReferences(source)) {
          violations.push(violation("forbidden-application-package", { module: modulePath, specifier }));
        }
      }
      if (boundary === "platform/supabase") {
        for (const specifier of findForbiddenSupabaseRuntimeImports(source)) {
          violations.push(violation("forbidden-supabase-runtime-import", { module: modulePath, specifier }));
        }
      }
    }
  }

  return {
    ok: violations.length === 0,
    modules: normalizedModules,
    boundaryCounts: countModulesByBoundary(normalizedModules),
    importCount,
    violations
  };
}

export async function checkArchitecture() {
  const graph = await readSourceImportGraph();
  const { exports: platformExports } = await readWorkspaceExports("platform");
  return {
    ...graph,
    platformExports,
    ...validateArchitectureGraph({ ...graph, platformExports })
  };
}

function formatViolation(item) {
  switch (item.type) {
    case "unknown-layer":
      return `módulo sin frontera declarada: ${item.module}`;
    case "missing-composition-root":
      return `falta el composition root ${item.module}`;
    case "invalid-composition-root":
      return `${item.expected} debe ser el único composition root (actuales: ${item.modules.join(", ") || "ninguno"})`;
    case "unresolved-import":
      return `import no resuelto: ${item.importer} -> ${item.specifier}`;
    case "missing-local-module":
      return `import local no resuelto: ${item.importer} -> ${item.specifier} (${item.dependency})`;
    case "undeclared-platform-export":
      return `${item.importer} importa ${item.specifier} pero @siys-sync/platform no exporta ${item.subpath}`;
    case "forbidden-import":
      return `${item.importer} [${item.importerBoundary}] no puede importar ${item.dependency} [${item.dependencyBoundary}]`;
    case "shared-product-version":
      return `módulo compartido ${item.module} referencia la identidad de producto ${item.token}`;
    case "forbidden-platform-runtime-import":
      return `módulo platform ${item.module} importa un runtime Node no portable '${item.specifier}'`;
    case "forbidden-platform-reference":
      return `módulo platform ${item.module} referencia el token de navegador prohibido '${item.token}'`;
    case "forbidden-semantic-reference":
      return `módulo application ${item.module} referencia el token prohibido '${item.token}'`;
    case "forbidden-application-package":
      return `módulo application ${item.module} importa el paquete prohibido '${item.specifier}'`;
    case "forbidden-supabase-runtime-import":
      return `módulo supabase ${item.module} importa un runtime específico no portable '${item.specifier}'`;
    default:
      return `violación desconocida: ${JSON.stringify(item)}`;
  }
}

export function formatArchitectureReport(report) {
  if (report.ok) {
    const boundaries = Object.entries(report.boundaryCounts ?? {})
      .map(([boundary, count]) => `${boundary}=${count}`)
      .join(", ");
    return `Guardia de arquitectura OK: ${report.modules.length} módulos, ${report.importCount} imports, fronteras [${boundaries}].`;
  }
  return [
    "Guardia de arquitectura fallida:",
    ...report.violations.map((item) => `- ${formatViolation(item)}`)
  ].join("\n");
}

export async function assertArchitecture() {
  const report = await checkArchitecture();
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
