import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const paths = {
  template: resolve(root, "src", "index.template.html"),
  css: resolve(root, "src", "styles.css"),
  core: resolve(root, "src", "core.js"),
  importer: resolve(root, "src", "importer.js"),
  app: resolve(root, "src", "app.js"),
  vendor: resolve(root, "vendor", "xlsx.full.min.js"),
  license: resolve(root, "vendor", "LICENSE.txt"),
  notice: resolve(root, "vendor", "NOTICE.txt"),
  outputDir: resolve(root, "dist"),
  output: resolve(root, "dist", "calendario-hvac-siys.html"),
  pagesOutput: resolve(root, "dist", "index.html")
};

const [template, css, core, importer, app, vendor, license, notice] = await Promise.all([
  readFile(paths.template, "utf8"),
  readFile(paths.css, "utf8"),
  readFile(paths.core, "utf8"),
  readFile(paths.importer, "utf8"),
  readFile(paths.app, "utf8"),
  readFile(paths.vendor, "utf8"),
  readFile(paths.license, "utf8"),
  readFile(paths.notice, "utf8")
]);

const requiredTokens = ["/*__APP_CSS__*/", "/*__SHEETJS__*/", "/*__APP_JS__*/", "<!--__LICENSE__-->"];
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

const stripLocalImports = (source) => source.replace(
  /import\s*\{[\s\S]*?\}\s*from\s*["']\.\/(?:core|importer)\.js["'];?\s*/g,
  ""
);

const slots = {
  css: "__CALENDARIO_HVAC_INLINE_CSS_9D6D6437__",
  vendor: "__CALENDARIO_HVAC_INLINE_VENDOR_9D6D6437__",
  app: "__CALENDARIO_HVAC_INLINE_APP_9D6D6437__",
  license: "__CALENDARIO_HVAC_LICENSE_9D6D6437__"
};
const escapeInlineScript = (source) => source.replace(/<\/script/gi, "<\\/script");
const escapeInlineStyle = (source) => source.replace(/<\/style/gi, "<\\/style");
const appBundle = `${core}\n\n${stripLocalImports(importer)}\n\n${stripLocalImports(app)}`;

const slottedTemplate = template
  .replace("/*__APP_CSS__*/", slots.css)
  .replace("/*__SHEETJS__*/", slots.vendor)
  .replace("/*__APP_JS__*/", slots.app)
  .replace("<!--__LICENSE__-->", slots.license);

const html = slottedTemplate
  .replace(slots.css, () => escapeInlineStyle(css))
  .replace(slots.vendor, () => escapeInlineScript(vendor))
  .replace(slots.app, () => escapeInlineScript(appBundle))
  .replace(slots.license, () => licenseComment);

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
