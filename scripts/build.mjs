import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(import.meta.dirname, "..");
const applicationSourceRoot = resolve(root, "src");
export const applicationModuleRelativePaths = Object.freeze([
  "domain/text.js",
  "domain/responsible-ranking.js",
  "domain/dates.js",
  "domain/calendar-enums.js",
  "domain/activity-order.js",
  "domain/activity-filters.js",
  "ui/three-motion.js",
  "domain/import-merge.js",
  "domain/backup-merge.js",
  "domain/csv-export.js",
  "domain/holidays.js",
  "import/xlsx-table.js",
  "import/workbook-table.js",
  "persistence/indexed-document-store.js",
  "persistence/json-preferences.js",
  "application/calendar-commands.js",
  "ui/calendar-constants.js",
  "ui/presentation.js",
  "ui/activity-presentation.js",
  "ui/export-layout.js",
  "ui/mutation-controller.js",
  "ui/view-state.js",
  "core.js",
  "import/programming.js",
  "import/base-operativa.js",
  "importer.js",
  "calendar-contract.js",
  "cloud.js",
  "app.js"
]);
const applicationModulePaths = applicationModuleRelativePaths
  .map((relativePath) => resolve(applicationSourceRoot, relativePath));
const stylePaths = [
  "styles.css",
  "styles/responsive.css",
  "styles/channel-contract.css"
].map((relativePath) => resolve(root, "src", relativePath));

const paths = {
  template: resolve(root, "src", "index.template.html"),
  vendor: resolve(root, "vendor", "xlsx.full.min.js"),
  three: resolve(root, "node_modules", "three", "build", "three.cjs"),
  license: resolve(root, "vendor", "LICENSE.txt"),
  notice: resolve(root, "vendor", "NOTICE.txt"),
  brandIcon: resolve(root, "src", "assets", "siys-sync-icon.svg"),
  outputDir: resolve(root, "dist"),
  output: resolve(root, "dist", "calendario-hvac-siys.html"),
  pagesOutput: resolve(root, "dist", "index.html")
};

const staticModuleImportPattern = /(?:^|[\n;])\s*(?:import|export)\s+(?:(?:[\s\S]*?)\s+from\s+)?["']([^"']+)["']\s*;?/gm;
const normalizeModulePath = (modulePath) => String(modulePath)
  .replaceAll("\\", "/")
  .replace(/^\.\//, "");

export const localModuleSpecifiers = (source) => [...source.matchAll(staticModuleImportPattern)]
  .map((match) => match[1])
  .filter((specifier) => specifier.startsWith("."));

const resolveLocalModulePath = (importerRelativePath, specifier, sourceRoot = applicationSourceRoot) => {
  const targetPath = resolve(sourceRoot, dirname(importerRelativePath), specifier);
  const targetRelativePath = normalizeModulePath(relative(sourceRoot, targetPath));
  if (
    !targetRelativePath ||
    targetRelativePath === ".." ||
    targetRelativePath.startsWith("../") ||
    isAbsolute(targetRelativePath)
  ) {
    throw new Error(`El import local ${specifier} de ${importerRelativePath} sale de src/.`);
  }
  return targetRelativePath;
};

export async function discoverApplicationModules({
  entryRelativePath = "app.js",
  sourceRoot = applicationSourceRoot
} = {}) {
  const entry = normalizeModulePath(entryRelativePath);
  const queue = [entry];
  const visited = new Set();
  const graph = new Map();

  while (queue.length) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);
    const source = await readFile(resolve(sourceRoot, current), "utf8");
    const imports = [...new Set(localModuleSpecifiers(source))].map((specifier) => ({
      specifier,
      relativePath: resolveLocalModulePath(current, specifier, sourceRoot)
    }));
    graph.set(current, imports);
    for (const { relativePath } of imports) {
      if (!visited.has(relativePath)) queue.push(relativePath);
    }
  }

  return { entry, modules: [...visited], graph };
}

export async function validateApplicationModuleManifest({
  entryRelativePath = "app.js",
  sourceRoot = applicationSourceRoot,
  moduleRelativePaths = applicationModuleRelativePaths
} = {}) {
  const listed = moduleRelativePaths.map(normalizeModulePath);
  const listedSet = new Set(listed);
  const listedIndex = new Map(listed.map((modulePath, index) => [modulePath, index]));
  const duplicatePaths = listed.filter((modulePath, index) => listed.indexOf(modulePath) !== index);
  const discovery = await discoverApplicationModules({ entryRelativePath, sourceRoot });
  const missing = [];
  const orderIssues = [];

  if (!listedSet.has(discovery.entry)) {
    missing.push({
      importer: "(entry)",
      specifier: `./${discovery.entry}`,
      relativePath: discovery.entry
    });
  }

  for (const importer of discovery.modules) {
    const importerIndex = listedIndex.get(importer);
    for (const dependency of discovery.graph.get(importer) ?? []) {
      if (!listedSet.has(dependency.relativePath)) {
        missing.push({ importer, ...dependency });
        continue;
      }
      const dependencyIndex = listedIndex.get(dependency.relativePath);
      if (dependencyIndex > importerIndex) {
        orderIssues.push({
          importer,
          ...dependency,
          importerIndex,
          dependencyIndex
        });
      }
    }
  }

  return {
    entry: discovery.entry,
    discovered: discovery.modules,
    listed,
    missing,
    orderIssues,
    duplicatePaths
  };
}

export async function assertApplicationModuleManifest(options = {}) {
  const report = await validateApplicationModuleManifest(options);
  if (report.missing.length || report.orderIssues.length || report.duplicatePaths.length) {
    const details = [
      ...report.missing.map(({ importer, specifier, relativePath }) =>
        `faltante: ${importer} importa ${specifier} (${relativePath})`),
      ...report.orderIssues.map(({ importer, relativePath, importerIndex, dependencyIndex }) =>
        `orden: ${relativePath} debe preceder a ${importer} (${dependencyIndex} > ${importerIndex})`),
      ...report.duplicatePaths.map((modulePath) => `duplicado: ${modulePath}`)
    ];
    throw new Error(`El manifiesto de módulos de la aplicación no coincide con src/:\n- ${details.join("\n- ")}`);
  }
  return report;
}

export async function build() {
  await assertApplicationModuleManifest();

  const [template, styles, applicationModules, vendor, threeModule, license, notice, brandIcon] = await Promise.all([
    readFile(paths.template, "utf8"),
    Promise.all(stylePaths.map((path) => readFile(path, "utf8"))),
    Promise.all(applicationModulePaths.map((path) => readFile(path, "utf8"))),
    readFile(paths.vendor, "utf8"),
    readFile(paths.three, "utf8"),
    readFile(paths.license, "utf8"),
    readFile(paths.notice, "utf8"),
    readFile(paths.brandIcon)
  ]);

const requiredTokens = [
  "/*__APP_CSS__*/",
  "/*__SHEETJS__*/",
  "/*__APP_JS__*/",
  "<!--__LICENSE__-->",
  "__SIYS_SYNC_ICON__",
  "__SIYS_SUPABASE_CONFIG_VALUE__"
];
for (const token of requiredTokens) {
  if (!template.includes(token)) {
    throw new Error(`Falta el marcador de compilación ${token}`);
  }
}
if (/<script[^>]+src=|<link[^>]+href=["']https?:/i.test(template)) {
  throw new Error("La plantilla contiene una dependencia de red no permitida.");
}

const licenseComment = `<!--
SheetJS Community Edition 0.20.3
${notice.replaceAll("--", "—")}

${license.replaceAll("--", "—")}

Three.js 0.185.1
Copyright © 2010-2026 three.js authors
Released under the MIT License: https://github.com/mrdoob/three.js/blob/dev/LICENSE
-->`;

const stripLocalModuleLinks = (source) => source
  .replace(/import\s*\{[\s\S]*?\}\s*from\s*["'](?:\.\.?\/)+.+?\.js["'];?\s*/g, "")
  .replace(/export\s*\{[\s\S]*?\}\s*from\s*["'](?:\.\.?\/)+.+?\.js["'];?\s*/g, "");

const slots = {
  css: "__CALENDARIO_HVAC_INLINE_CSS_9D6D6437__",
  vendor: "__CALENDARIO_HVAC_INLINE_VENDOR_9D6D6437__",
  app: "__CALENDARIO_HVAC_INLINE_APP_9D6D6437__",
  license: "__CALENDARIO_HVAC_LICENSE_9D6D6437__"
};
const escapeInlineScript = (source) => source.replace(/<\/script/gi, "<\\/script");
const escapeInlineStyle = (source) => source.replace(/<\/style/gi, "<\\/style");
const exposeThreeGlobal = (source) => `(function () {
  const exports = {};
${source.replace(/ +\t/g, "\t")}
  globalThis.THREE = exports;
})();`;
const appBundle = applicationModules.map(stripLocalModuleLinks).join("\n\n");
const vendorBundle = `${vendor}\n${exposeThreeGlobal(threeModule)}`;
const syntaxCheck = spawnSync(process.execPath, ["--input-type=module", "--check", "-"], {
  input: appBundle,
  encoding: "utf8"
});
if (syntaxCheck.status !== 0) {
  throw new Error(`El bundle de la aplicación no es JavaScript válido:\n${syntaxCheck.stderr.trim()}`);
}

const supabaseConfig = {
  enabled: Boolean(process.env.SIYS_SUPABASE_URL?.trim() && process.env.SIYS_SUPABASE_PUBLISHABLE_KEY?.trim()),
  url: process.env.SIYS_SUPABASE_URL?.trim() ?? "",
  publishableKey: process.env.SIYS_SUPABASE_PUBLISHABLE_KEY?.trim() ?? ""
};

const slottedTemplate = template
  .replace("/*__APP_CSS__*/", slots.css)
  .replace("/*__SHEETJS__*/", slots.vendor)
  .replace("/*__APP_JS__*/", slots.app)
  .replace("<!--__LICENSE__-->", slots.license);

const html = slottedTemplate
  .replace(slots.css, () => escapeInlineStyle(styles.join("\n\n")))
  .replace(slots.vendor, () => escapeInlineScript(vendorBundle))
  .replace(slots.app, () => escapeInlineScript(appBundle))
  .replace(slots.license, () => licenseComment)
  .replace("__SIYS_SUPABASE_CONFIG_VALUE__", () => JSON.stringify(supabaseConfig))
  .replaceAll("__SIYS_SYNC_ICON__", `data:image/svg+xml;base64,${brandIcon.toString("base64")}`);

const remainingMarkers = [
  ...requiredTokens.filter((token) => html.includes(token)),
  ...Object.values(slots).filter((slot) => html.includes(slot))
];
const networkDependency = /https?:\/\/cdn\.sheetjs\.com\/xlsx-/i.test(html);
if (remainingMarkers.length || networkDependency) {
  throw new Error(`El resultado conserva marcadores o dependencias de red no permitidas: ${[
    ...remainingMarkers,
    ...(networkDependency ? ["cdn.sheetjs.com"] : [])
  ].join(", ")}`);
}

await mkdir(paths.outputDir, { recursive: true });
await Promise.all([
  writeFile(paths.output, html, "utf8"),
  writeFile(paths.pagesOutput, html, "utf8")
]);

const size = Buffer.byteLength(html);
console.log(JSON.stringify({
  status: "ok",
  output: paths.output,
  pagesOutput: paths.pagesOutput,
  bytes: size,
  selfContained: true
}, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await build();
}
