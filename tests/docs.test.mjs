import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("el README enlaza documentación existente", () => {
  const readme = readFileSync(resolve(root, "README.md"), "utf8");
  const links = [...readme.matchAll(/\]\(([^)]+\.md)\)/g)].map((match) => match[1]);
  assert.ok(links.length >= 3);
  for (const link of links) {
    assert.equal(existsSync(resolve(root, link)), true, `No existe ${link}`);
  }
});

test("la distribución documenta que Pages publica main y la beta requiere merge", () => {
  const pages = readFileSync(resolve(root, "docs", "GITHUB_PAGES.md"), "utf8");
  assert.equal(existsSync(resolve(root, "docs", "GITHUB_PAGES.md")), true);
  for (const required of [
    "no publica cada rama",
    "main",
    "/beta/",
    "stable-version.txt",
    "PR a main",
    "workflow de Pages",
    "No ejecutar `workflow_dispatch` desde una rama",
    "preview local"
  ]) {
    assert.match(pages, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
});

test("el manual documenta persistencia, filtros, plantilla y restauración", () => {
  const manual = readFileSync(resolve(root, "docs", "MANUAL_DE_USO.md"), "utf8");
  for (const required of [
    "IndexedDB",
    "GitHub Pages",
    "Tomar control",
    "FechaInicio",
    "IncluirNoLaborables",
    "duplicados",
    "PNG",
    "respaldo",
    "SIYS Sync",
    "Ampliar",
    "REINICIAR",
    "Combinar otra copia",
    "beta",
    "Tema",
    "Oscuro",
    "Sistema",
    "impresión",
    "Teléfonos y tabletas",
    "alternativas táctiles",
    "899 px",
    "agenda diaria",
    "Ver mes",
    "Borrar y empezar de cero",
    "plantilla_programacion_SIYS-Sync.xlsx"
  ]) {
    assert.match(manual, new RegExp(required, "i"));
  }
});

test("la interfaz usa lenguaje operativo, tema del sistema inicial y menús móviles explícitos", () => {
  const template = readFileSync(resolve(root, "src", "index.template.html"), "utf8");
  const app = readFileSync(resolve(root, "src", "app.js"), "utf8");
  for (const label of [
    "Gestionar",
    "Actualizar base operativa",
    "Descargar copia del cronograma",
    "Recuperar una copia del cronograma",
    "Combinar otra copia",
    "Borrar y empezar de cero",
    "Descargar listado del mes",
    "Descargar imagen del cronograma",
    "Ver mes",
    "Más"
  ]) {
    assert.match(template, new RegExp(label, "i"));
  }
  assert.match(app, /return \["light", "dark", "system"\]\.includes\(value\) \? value : "system"/);
  assert.match(app, /function cycleThemePreference\(\)/);
  assert.match(app, /dom\.themeButton\.addEventListener\("click", cycleThemePreference\)/);
  assert.match(template, /id="responsibleSearch"/);
  assert.match(app, /respaldo-cronograma_/);
  assert.match(app, /_programacion_/);
  assert.match(app, /_cronograma_/);
});

test("la guía de Base Operativa enumera hojas y exclusiones de privacidad", () => {
  const guide = readFileSync(resolve(root, "docs", "BASE_OPERATIVA.md"), "utf8");
  for (const sheet of [
    "dm_ciudad",
    "dm_clientes",
    "dm_sede",
    "dm_directorio_siys",
    "dm_equipo_cronograma"
  ]) {
    assert.match(guide, new RegExp(sheet));
  }
  for (const excluded of ["cédulas", "teléfonos", "correos", "fotografías"]) {
    assert.match(guide, new RegExp(excluded, "i"));
  }
});

test("los criterios de diseño documentan la evolución beta y sus puertas de promoción", () => {
  const criteriaPath = resolve(root, "docs", "CRITERIOS_DE_DISENO.md");
  assert.equal(existsSync(criteriaPath), true);
  const criteria = readFileSync(criteriaPath, "utf8");
  for (const required of [
    "Criterios de diseño",
    "versión beta",
    "Tokens de referencia",
    "Responsive",
    "Accesibilidad e interacción",
    "Puertas de promoción beta → estable",
    "85/100",
    "seis viewports",
    "parche `0.x.y`",
    "hito `0.x.0`",
    "1.0.0"
  ]) {
    assert.match(criteria, new RegExp(required, "i"));
  }
});

test("las reglas de versionamiento explican SemVer y la decisión beta actual", () => {
  const versioningPath = resolve(root, "docs", "VERSIONAMIENTO.md");
  assert.equal(existsSync(versioningPath), true);
  const versioning = readFileSync(versioningPath, "utf8");
  for (const required of [
    "Semantic Versioning",
    "package.json",
    "APP_VERSION",
    "0.10.1",
    "0.10.1-beta.1",
    "0.11.0-beta.1",
    "0.11.0",
    "1.0.0-beta.1",
    "1.0.0",
    "0.10.0",
    "v0.10.0",
    "stable-version.txt",
    "no se reescriben",
    "0.9.1",
    "SCHEMA_VERSION",
    "0d05123",
    "npm run verify"
  ]) {
    assert.match(versioning, new RegExp(required.replace(/[.]/g, "\\."), "i"));
  }
});

test("la versión de release está sincronizada entre package, núcleo e interfaz", () => {
  const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const lockfile = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8"));
  const core = readFileSync(resolve(root, "src", "core.js"), "utf8");
  assert.equal(packageJson.version, "0.11.0-beta.1");
  assert.equal(lockfile.version, packageJson.version);
  assert.equal(lockfile.packages[""].version, packageJson.version);
  assert.match(core, new RegExp(`APP_VERSION = \\"${packageJson.version.replace(/[.]/g, "\\.")}\\"`));
});

test("la línea activa beta no reutiliza la base estable", () => {
  const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const stablePointer = readFileSync(resolve(root, "stable-version.txt"), "utf8").trim();
  assert.equal(stablePointer, "v0.10.0");
  assert.equal(packageJson.version, "0.11.0-beta.1");
  assert.notEqual(packageJson.version, stablePointer.slice(1));
});

test("el contrato visual promovido se aplica a beta y estable", () => {
  const css = readFileSync(resolve(root, "src", "styles.css"), "utf8");
  const app = readFileSync(resolve(root, "src", "app.js"), "utf8");
  assert.match(css, /html\[data-channel="beta"\],[\s\S]*html\[data-channel="stable"\]/);
  assert.match(app, /document\.documentElement\.dataset\.channel = RUNTIME_CHANNEL/);
  assert.match(app, /\["beta", "stable"\]\.includes\(RUNTIME_CHANNEL\)/);
  assert.match(app, /aria-controls/, "La beta debe documentar la relación pestaña/panel");
  assert.match(css, /html\[data-channel="beta"\] \.weekday-row,[\s\S]*html\[data-channel="stable"\] \.weekday-row \{[\s\S]*flex: 0 0 auto/);
  assert.match(css, /--beta-weekday-height: 32px/);
  assert.match(css, /html\[data-channel="beta"\] \.month-grid-wrap,[\s\S]*html\[data-channel="stable"\] \.month-grid-wrap \{[\s\S]*overflow: auto/);
  assert.match(css, /--beta-card-payroll-bg: #23423e/);
  assert.match(css, /\.search-box input \{[\s\S]*background: transparent/);
  assert.match(css, /\.selection-bar \.button:not\(\.ghost\):not\(\.danger\)/);
  assert.match(app, /RUNTIME_CHANNEL === "beta"/);
  assert.match(app, /Estado: \$\{statusText\}/);
  assert.match(css, /html\[data-channel="beta"\] \.quick-open/);
});

test("la dirección SIYS Operations permanece aislada en beta", () => {
  const css = readFileSync(resolve(root, "src", "styles.css"), "utf8");
  assert.match(css, /html\[data-channel="beta"\] \{[\s\S]*--beta-accent: #176b57/);
  assert.match(css, /html\[data-channel="beta"\]\[data-theme="dark"\][\s\S]*--beta-bg: #0e171a/);
  assert.match(css, /html\[data-channel="beta"\] \.activity-card[\s\S]*box-shadow: inset 0 3px 0 var\(--beta-card-mark\)/);
  assert.match(css, /html\[data-channel="beta"\] \.selection-bar \.button:not\(\.ghost\):not\(\.danger\)/);
  assert.match(css, /html\[data-channel="beta"\] \.search-box:focus-within/);
});
