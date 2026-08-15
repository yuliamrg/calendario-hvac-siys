import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stylePaths = [
  resolve(root, "src", "styles.css"),
  resolve(root, "src", "styles", "responsive.css"),
  resolve(root, "src", "styles", "channel-contract.css")
];
const readStyles = () => stylePaths.map((path) => readFileSync(path, "utf8")).join("\n\n");

test("el README enlaza documentación existente", () => {
  const readme = readFileSync(resolve(root, "README.md"), "utf8");
  const links = [...readme.matchAll(/\]\(([^)]+\.md)\)/g)].map((match) => match[1]);
  assert.ok(links.length >= 3);
  for (const link of links) {
    assert.equal(existsSync(resolve(root, link)), true, "No existe " + link);
  }
});

test("el runbook fija el flujo seguro de respaldos JSON", () => {
  const runbookPath = resolve(root, "docs", "OPERACION_RESPALDOS_JSON.md");
  assert.equal(existsSync(runbookPath), true);
  const runbook = readFileSync(runbookPath, "utf8");
  for (const required of [
    "C:\\Users\\CoordServicio\\OneDrive - Siys\\cronogramas\\Respaldo",
    "https://yuliamrg.github.io/calendario-hvac-siys/",
    "https://yuliamrg.github.io/calendario-hvac-siys/beta/",
    "channel",
    "appVersion",
    "schemaVersion",
    "SHA256",
    "DOM.setFileInputFiles: Not allowed",
    "Combinar otra copia",
    "nunca se sobrescribe"
  ]) {
    assert.ok(runbook.includes(required), "Falta documentar " + required);
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
  const css = readStyles();
  for (const label of [
    "Gestionar",
    "Actualizar base operativa",
    "Descargar plantilla de Base Operativa",
    "Descargar copia del cronograma",
    "Recuperar una copia del cronograma",
    "Combinar otra copia",
    "Borrar y empezar de cero",
    "Descargar listado del mes",
    "Descargar imagen de pendientes",
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
  assert.match(app, /function buildDayOverflowButton\(date, items, maps\)/);
  assert.match(app, /aria-haspopup/, "La pila de tarjetas debe anunciar su apertura de agenda");
  assert.match(app, /function activityObservationsTooltip\(activity\)/);
  assert.match(app, /card\.title = activityObservationsTooltip\(activity\)/);
  assert.match(app, /card\.draggable = reorderEnabled/);
  assert.match(app, /day-reorder-hint/);
  assert.match(css, /\.day-cell\.has-overflow/);
  assert.match(css, /\.day-overflow-card/);
});

test("la actividad conserva un solo buscador de responsables y unifica la ampliacion", () => {
  const template = readFileSync(resolve(root, "src", "index.template.html"), "utf8");
  const app = readFileSync(resolve(root, "src", "app.js"), "utf8");
  assert.equal((template.match(/id="responsibleSearch"/g) ?? []).length, 1);
  assert.doesNotMatch(template, /activityResponsibleText|activityResponsibleType|responsibleSuggestions/);
  assert.doesNotMatch(template, /Ampliar a rango/);
  assert.match(template, /id="seriesRangeFrom" type="date" required/);
  assert.match(template, /id="seriesRangeTo" type="date"\s*>/);
  assert.match(app, /openSeriesRangeDialog\(payload\.activityIds\[0\], \{ fromDate: payload\.date \}\)/);
  assert.match(app, /const operation = toDate \? "activity\.extend-range"/);
});

test("la lista cloud de cronogramas tiene refresco y la provisión es idempotente", () => {
  const template = readFileSync(resolve(root, "src", "index.template.html"), "utf8");
  const app = readFileSync(resolve(root, "src", "app.js"), "utf8");
  const migration = readFileSync(
    resolve(root, "supabase", "migrations", "20260813160000_provision_user_calendars.sql"),
    "utf8"
  );
  assert.match(template, /id="refreshCloudCalendarsButton"/);
  assert.match(app, /function refreshCloudCalendars\(\{ notify = false \} = \{\}\)/);
  assert.match(app, /CLOUD_CALENDAR_REFRESH_MS = 30000/);
  assert.match(app, /visibilitychange/);
  assert.match(app, /window\.addEventListener\("focus"/);
  assert.match(migration, /create or replace function public\.handle_new_user/);
  assert.match(migration, /on conflict \(legacy_id, created_by\) do nothing/);
  assert.match(migration, /cross join/);
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
    "seis viewports"
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
    "package-lock.json",
    "APP_VERSION",
    "0.14.0-beta.1",
    "0.14.0-beta.2",
    "0.14.0",
    "0.15.0-beta.1",
    "0.13.0-beta.2",
    "SCHEMA_VERSION",
    "CONTRACT_VERSION",
    "formatVersion",
    "stable-version.txt",
    "npm run version:check",
    "npm run release:check",
    "npm run goal:check",
    "npm run verify"
  ]) {
    assert.match(versioning, new RegExp(required.replace(/[.]/g, "\\."), "i"));
  }
});

test("la versión de release está sincronizada entre package, lock, núcleo y estable", () => {
  const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const packageLock = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8"));
  const core = readFileSync(resolve(root, "src", "core.js"), "utf8");
  const stableTag = readFileSync(resolve(root, "stable-version.txt"), "utf8").trim();
  assert.match(packageJson.version, /^0\.\d+\.\d+(?:-beta\.[1-9]\d*)?$/);
  assert.match(stableTag, /^v\d+\.\d+\.\d+$/);
  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages[""].version, packageJson.version);
  assert.match(core, new RegExp('APP_VERSION = "' + packageJson.version.replace(/[.]/g, "\\.") + '"'));
});

test("el contrato visual promovido se aplica a beta y estable", () => {
  const css = readStyles();
  const app = readFileSync(resolve(root, "src", "app.js"), "utf8");
  assert.match(css, /html\[data-channel="beta"\],[\s\S]*html\[data-channel="stable"\]/);
  assert.match(app, /document\.documentElement\.dataset\.channel = RUNTIME_CHANNEL/);
  assert.match(app, /\["beta", "stable", "local"\]\.includes\(RUNTIME_CHANNEL\)/);
  assert.match(app, /aria-controls/, "La beta debe documentar la relación pestaña/panel");
  assert.match(css, /html\[data-channel="beta"\] \.weekday-row,[\s\S]*html\[data-channel="stable"\] \.weekday-row \{[\s\S]*flex: 0 0 auto/);
  assert.match(css, /--beta-weekday-height: 32px/);
  assert.match(css, /html\[data-channel="beta"\] \.month-grid-wrap,[\s\S]*html\[data-channel="stable"\] \.month-grid-wrap \{[\s\S]*overflow: auto/);
  assert.match(css, /--beta-card-payroll-bg: #23423e/);
  assert.match(css, /\.search-box input \{[\s\S]*background: transparent/);
  assert.match(css, /\.selection-bar \.button:not\(\.ghost\):not\(\.danger\)/);
});

test("las tarjetas en modo lectura reubican el contenido al ocultar controles", () => {
  const css = readStyles();
  assert.match(
    css,
    /body\.read-only \.activity-card\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) auto;[\s\S]*?\}/
  );
});
