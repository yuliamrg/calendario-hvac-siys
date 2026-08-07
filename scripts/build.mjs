import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const applicationModulePaths = [
  "domain/text.js",
  "domain/dates.js",
  "domain/calendar-enums.js",
  "domain/activity-order.js",
  "domain/activity-filters.js",
  "domain/import-merge.js",
  "domain/backup-merge.js",
  "domain/csv-export.js",
  "domain/holidays.js",
  "import/xlsx-table.js",
  "import/workbook-table.js",
  "persistence/indexed-document-store.js",
  "persistence/json-preferences.js",
  "ui/calendar-constants.js",
  "ui/presentation.js",
  "ui/mutation-controller.js",
  "core.js",
  "import/programming.js",
  "import/base-operativa.js",
  "calendar-contract.js",
  "cloud.js",
  "app.js"
].map((relativePath) => resolve(root, "src", relativePath));
const stylePaths = [
  "styles.css",
  "styles/responsive.css",
  "styles/channel-contract.css"
].map((relativePath) => resolve(root, "src", relativePath));

const paths = {
  template: resolve(root, "src", "index.template.html"),
  vendor: resolve(root, "vendor", "xlsx.full.min.js"),
  license: resolve(root, "vendor", "LICENSE.txt"),
  notice: resolve(root, "vendor", "NOTICE.txt"),
  brandIcon: resolve(root, "src", "assets", "siys-sync-icon.svg"),
  outputDir: resolve(root, "dist"),
  output: resolve(root, "dist", "calendario-hvac-siys.html"),
  pagesOutput: resolve(root, "dist", "index.html")
};

const [template, styles, applicationModules, vendor, license, notice, brandIcon] = await Promise.all([
  readFile(paths.template, "utf8"),
  Promise.all(stylePaths.map((path) => readFile(path, "utf8"))),
  Promise.all(applicationModulePaths.map((path) => readFile(path, "utf8"))),
  readFile(paths.vendor, "utf8"),
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
const appBundle = applicationModules.map(stripLocalModuleLinks).join("\n\n");
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
  .replace(slots.vendor, () => escapeInlineScript(vendor))
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
