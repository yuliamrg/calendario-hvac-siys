import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  PLATFORM_SPECIFIER_PREFIX,
  WORKSPACES,
  isPlatformSpecifier,
  normalizeModulePath,
  projectPathForPlatformSpecifier,
  projectRoot,
  workspaceForModulePath
} from "./workspaces.mjs";

const root = projectRoot;
const webSourceRoot = WORKSPACES.web.sourceRoot;

export const applicationEntryPath = normalizeModulePath(`${webSourceRoot}/app.js`);

export const applicationModulePaths = Object.freeze([
  "packages/platform/src/domain/text.js",
  "packages/platform/src/domain/responsible-ranking.js",
  "packages/platform/src/domain/dates.js",
  "packages/platform/src/domain/calendar-enums.js",
  "packages/platform/src/domain/activity-order.js",
  "packages/platform/src/domain/activity-filters.js",
  "apps/web/src/ui/three-motion.js",
  "apps/web/src/ui/web-version.js",
  "packages/platform/src/domain/import-merge.js",
  "packages/platform/src/domain/backup-merge.js",
  "packages/platform/src/domain/csv-export.js",
  "packages/platform/src/domain/holidays.js",
  "apps/web/src/import/xlsx-table.js",
  "apps/web/src/import/workbook-table.js",
  "apps/web/src/persistence/indexed-document-store.js",
  "apps/web/src/persistence/json-preferences.js",
  "apps/web/src/application/calendar-commands.js",
  "apps/web/src/application/import-commands.js",
  "apps/web/src/ui/calendar-constants.js",
  "apps/web/src/ui/presentation.js",
  "apps/web/src/ui/filter-options.js",
  "apps/web/src/ui/activity-presentation.js",
  "apps/web/src/ui/export-layout.js",
  "apps/web/src/ui/mutation-controller.js",
  "apps/web/src/ui/view-state.js",
  "packages/platform/src/core.js",
  "apps/web/src/import/programming.js",
  "apps/web/src/import/base-operativa.js",
  "apps/web/src/importer.js",
  "packages/platform/src/calendar-contract.js",
  "packages/platform/src/supabase/transport.js",
  "apps/web/src/cloud.js",
  "apps/web/src/app.js"
]);

const stylePaths = [
  "styles.css",
  "styles/responsive.css",
  "styles/channel-contract.css"
].map((relativePath) => resolve(root, webSourceRoot, relativePath));

const paths = {
  template: resolve(root, webSourceRoot, "index.template.html"),
  vendor: resolve(root, WORKSPACES.web.directory, "vendor", "xlsx.full.min.js"),
  three: resolve(root, "node_modules", "three", "build", "three.cjs"),
  license: resolve(root, WORKSPACES.web.directory, "vendor", "LICENSE.txt"),
  notice: resolve(root, WORKSPACES.web.directory, "vendor", "NOTICE.txt"),
  brandIcon: resolve(root, webSourceRoot, "assets", "siys-sync-icon.svg"),
  outputDir: resolve(root, "dist"),
  output: resolve(root, "dist", "calendario-hvac-siys.html"),
  pagesOutput: resolve(root, "dist", "index.html")
};

const staticModuleImportPattern = /(?:^|[\n;])\s*(?:import|export)\s+(?:(?:[\s\S]*?)\s+from\s+)?["']([^"']+)["']\s*;?/gm;

export const moduleSpecifiers = (source) => [...source.matchAll(staticModuleImportPattern)]
  .map((match) => match[1]);

const escapedPlatformPrefix = PLATFORM_SPECIFIER_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const moduleLinkPattern = (keyword) => new RegExp(
  `${keyword}\\s*\\{[\\s\\S]*?\\}\\s*from\\s*["'](?:\\.\\.?\\/|${escapedPlatformPrefix}).+?\\.js["'];?\\s*`,
  "g"
);

const resolveProjectModule = (importerProjectPath, specifier) => {
  if (specifier.startsWith(".")) {
    const targetProjectPath = normalizeModulePath(relative(root, resolve(root, dirname(importerProjectPath), specifier)));
    const targetWorkspace = workspaceForModulePath(targetProjectPath);
    if (!targetWorkspace) {
      throw new Error(`El import ${specifier} de ${importerProjectPath} sale de los workspaces declarados.`);
    }
    return targetProjectPath;
  }
  if (isPlatformSpecifier(specifier)) {
    return projectPathForPlatformSpecifier(specifier);
  }
  return null;
};

export async function discoverApplicationModules({ entryPath = applicationEntryPath } = {}) {
  const entry = normalizeModulePath(entryPath);
  const queue = [entry];
  const visited = new Set();
  const graph = new Map();

  while (queue.length) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    if (!workspaceForModulePath(current) || isAbsolute(current) || current.startsWith("../")) {
      throw new Error(`Módulo fuera de los workspaces declarados: ${current}`);
    }
    visited.add(current);
    const source = await readFile(resolve(root, current), "utf8");
    const imports = [];
    for (const specifier of [...new Set(moduleSpecifiers(source))]) {
      const projectPath = resolveProjectModule(current, specifier);
      if (projectPath === null) {
        throw new Error(`El módulo ${current} importa un especificador no resuelto: ${specifier}`);
      }
      imports.push({ specifier, projectPath });
      if (!visited.has(projectPath)) queue.push(projectPath);
    }
    graph.set(current, imports);
  }

  return { entry, modules: [...visited], graph };
}

export async function validateApplicationModuleManifest({
  entryPath = applicationEntryPath,
  modulePaths = applicationModulePaths
} = {}) {
  const listed = modulePaths.map(normalizeModulePath);
  const listedSet = new Set(listed);
  const listedIndex = new Map(listed.map((modulePath, index) => [modulePath, index]));
  const duplicatePaths = listed.filter((modulePath, index) => listed.indexOf(modulePath) !== index);
  const discovery = await discoverApplicationModules({ entryPath });
  const missing = [];
  const orderIssues = [];

  if (!listedSet.has(discovery.entry)) {
    missing.push({
      importer: "(entry)",
      specifier: `./${discovery.entry}`,
      projectPath: discovery.entry
    });
  }

  for (const importer of discovery.modules) {
    const importerIndex = listedIndex.get(importer);
    for (const dependency of discovery.graph.get(importer) ?? []) {
      if (!listedSet.has(dependency.projectPath)) {
        missing.push({ importer, ...dependency });
        continue;
      }
      const dependencyIndex = listedIndex.get(dependency.projectPath);
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
      ...report.missing.map(({ importer, specifier, projectPath }) =>
        `faltante: ${importer} importa ${specifier} (${projectPath})`),
      ...report.orderIssues.map(({ importer, projectPath, importerIndex, dependencyIndex }) =>
        `orden: ${projectPath} debe preceder a ${importer} (${dependencyIndex} > ${importerIndex})`),
      ...report.duplicatePaths.map((modulePath) => `duplicado: ${modulePath}`)
    ];
    throw new Error(`El manifiesto de módulos de la aplicación no coincide con los workspaces:\n- ${details.join("\n- ")}`);
  }
  return report;
}

export async function build() {
  await assertApplicationModuleManifest();

  const [template, styles, applicationModules, vendor, threeModule, license, notice, brandIcon] = await Promise.all([
    readFile(paths.template, "utf8"),
    Promise.all(stylePaths.map((path) => readFile(path, "utf8"))),
    Promise.all(applicationModulePaths.map((modulePath) => readFile(resolve(root, modulePath), "utf8"))),
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

  const stripModuleLinks = (source, modulePath) => {
    const stripped = source
      .replace(moduleLinkPattern("import"), "")
      .replace(moduleLinkPattern("export"), "");
    const unresolved = moduleSpecifiers(stripped);
    if (unresolved.length) {
      throw new Error(
        `El módulo ${modulePath} conserva especificadores de import no resueltos: ${unresolved.join(", ")}`
      );
    }
    return stripped;
  };

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
  const appBundle = applicationModules
    .map((source, index) => stripModuleLinks(source, applicationModulePaths[index]))
    .join("\n\n");
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
    .replaceAll("__SIYS_SYNC_ICON__", `data:image/svg+xml;base64,${Buffer.from(brandIcon.toString("utf8").replaceAll("\r\n", "\n")).toString("base64")}`);

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

  // Preserve the certified LF composition even with core.autocrlf=true.
  const outputHtml = html.replaceAll("\r\n", "\n");
  await mkdir(paths.outputDir, { recursive: true });
  await Promise.all([
    writeFile(paths.output, outputHtml, "utf8"),
    writeFile(paths.pagesOutput, outputHtml, "utf8")
  ]);

  const size = Buffer.byteLength(outputHtml);
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
