import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const namedPath = resolve(root, "dist", "calendario-hvac-siys.html");
const pagesPath = resolve(root, "dist", "index.html");
const [named, pages, appSource] = await Promise.all([
  readFile(namedPath, "utf8"),
  readFile(pagesPath, "utf8"),
  readFile(resolve(root, "src", "app.js"), "utf8")
]);

const failures = [];
if (named !== pages) failures.push("dist/index.html no coincide con el HTML descargable.");
for (const marker of ["/*__APP_CSS__*/", "/*__SHEETJS__*/", "/*__APP_JS__*/", "<!--__LICENSE__-->"]) {
  if (named.includes(marker)) failures.push(`El HTML conserva el marcador ${marker}.`);
}
if (/<script[^>]+src=|<link[^>]+rel=["']stylesheet["'][^>]+href=/i.test(named)) {
  failures.push("El HTML conserva recursos ejecutables externos.");
}
for (const api of [/\bfetch\s*\(/, /\bXMLHttpRequest\b/, /\bWebSocket\b/, /\bEventSource\b/]) {
  if (api.test(appSource)) failures.push(`La aplicación contiene una API de red no autorizada: ${api}.`);
}
if (/gh[opusr]_[A-Za-z0-9_]{20,}/.test(named)) failures.push("El HTML parece contener un token de GitHub.");

const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
  .split(/\r?\n/)
  .filter(Boolean);
const forbiddenTracked = tracked.filter((path) =>
  /^(qa|calendarios muestra)\//i.test(path) ||
  /\.(?:xlsx|xls|csv|png|backup\.json)$/i.test(path)
);
if (forbiddenTracked.length) {
  failures.push(`Hay artefactos operativos o QA versionados: ${forbiddenTracked.join(", ")}`);
}

if (failures.length) {
  throw new Error(`Auditoría de distribución fallida:\n- ${failures.join("\n- ")}`);
}

console.log(JSON.stringify({
  status: "ok",
  selfContained: true,
  pagesMatchesDownload: true,
  trackedFiles: tracked.length,
  networkApis: 0,
  forbiddenTracked: 0
}, null, 2));
