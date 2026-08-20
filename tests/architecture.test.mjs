import test from "node:test";
import assert from "node:assert/strict";

import {
  checkArchitecture,
  classifyModule,
  findForbiddenPackageReferences,
  findForbiddenSemanticReferences,
  formatArchitectureReport,
  validateArchitectureGraph
} from "../scripts/architecture-check.mjs";

test("el grafo real de src respeta las fronteras y captura la CLI completa", async () => {
  const report = await checkArchitecture();

  assert.equal(report.ok, true, formatArchitectureReport(report));
  assert.deepEqual(report.violations, []);
  assert.equal(classifyModule("app.js"), "composition");
  assert.equal(report.modules.includes("cli/main.js"), true);
  assert.equal(
    report.graph.get("cli/main.js").some(({ relativePath }) => relativePath === "cli/files.js"),
    true,
    "El grafo debe incluir el import() dinámico de la CLI"
  );
});

test("la validación detecta una dependencia sintética que cruza una frontera", async () => {
  const actual = await checkArchitecture();
  const graph = new Map(actual.graph);
  graph.set("domain/synthetic-violation.js", [
    { specifier: "../ui/presentation.js", relativePath: "ui/presentation.js" }
  ]);

  const report = validateArchitectureGraph({
    modules: [...actual.modules, "domain/synthetic-violation.js"],
    graph
  });

  assert.equal(report.ok, false);
  assert.equal(
    report.violations.some((item) => (
      item.type === "forbidden-import"
      && item.importer === "domain/synthetic-violation.js"
      && item.dependency === "ui/presentation.js"
    )),
    true
  );
  assert.match(formatArchitectureReport(report), /domain\/synthetic-violation\.js/);
});

test("el grafo real de src respeta las fronteras y captura la CLI completa", async () => {
  const report = await checkArchitecture();

  assert.equal(report.ok, true, formatArchitectureReport(report));
  assert.deepEqual(report.violations, []);
  assert.equal(classifyModule("app.js"), "composition");
  assert.equal(report.modules.includes("cli/main.js"), true);
  assert.equal(
    report.graph.get("cli/main.js").some(({ relativePath }) => relativePath === "cli/files.js"),
    true,
    "El grafo debe incluir el import() dinámico de la CLI"
  );
});

test("la validación detecta una dependencia sintética prohibida en la capa application", async () => {
  const actual = await checkArchitecture();
  const graph = new Map(actual.graph);
  graph.set("application/synthetic-violation.js", [
    { specifier: "../ui/presentation.js", relativePath: "ui/presentation.js" }
  ]);

  const report = validateArchitectureGraph({
    modules: [...actual.modules, "application/synthetic-violation.js"],
    graph
  });

  assert.equal(report.ok, false);
  assert.equal(
    report.violations.some((item) => (
      item.type === "forbidden-import"
      && item.importer === "application/synthetic-violation.js"
      && item.dependency === "ui/presentation.js"
    )),
    true
  );
  assert.match(formatArchitectureReport(report), /application\/synthetic-violation\.js/);
});

test("la validación permite importaciones permitidas desde la capa application", async () => {
  const actual = await checkArchitecture();
  const graph = new Map(actual.graph);
  graph.set("application/synthetic-allow.js", [
    { specifier: "../core.js", relativePath: "core.js" }
  ]);

  const report = validateArchitectureGraph({
    modules: [...actual.modules, "application/synthetic-allow.js"],
    graph
  });

  assert.equal(report.ok, true, formatArchitectureReport(report));
  assert.equal(report.violations.length, 0);
});

test("el grafo real de src pasa con la nueva regla de application", async () => {
  const report = await checkArchitecture();

  assert.equal(report.ok, true, formatArchitectureReport(report));
  assert.deepEqual(report.violations, []);
});

test("application no puede importar la frontera import (adaptadores de Excel)", async () => {
  const actual = await checkArchitecture();
  const graph = new Map(actual.graph);
  graph.set("application/synthetic-import-frontier.js", [
    { specifier: "../import/xlsx-table.js", relativePath: "import/xlsx-table.js" }
  ]);

  const report = validateArchitectureGraph({
    modules: [...actual.modules, "application/synthetic-import-frontier.js"],
    graph
  });

  assert.equal(report.ok, false);
  assert.equal(
    report.violations.some((item) => (
      item.type === "forbidden-import"
      && item.importer === "application/synthetic-import-frontier.js"
      && item.dependency === "import/xlsx-table.js"
      && item.dependencyLayer === "import"
    )),
    true,
    "application no debe conocer src/import"
  );
});

test("application tampoco puede importar la fachada importer.js", async () => {
  const actual = await checkArchitecture();
  const graph = new Map(actual.graph);
  graph.set("application/synthetic-importer.js", [
    { specifier: "../importer.js", relativePath: "importer.js" }
  ]);

  const report = validateArchitectureGraph({
    modules: [...actual.modules, "application/synthetic-importer.js"],
    graph
  });

  assert.equal(report.ok, false);
  assert.equal(
    report.violations.some((item) => (
      item.type === "forbidden-import"
      && item.importer === "application/synthetic-importer.js"
      && item.dependency === "importer.js"
    )),
    true
  );
});

test("la validación semántica detecta referencias prohibidas en un módulo application", async () => {
  const actual = await checkArchitecture();
  const graph = new Map(actual.graph);
  graph.set("application/synthetic-semantic.js", []);
  const sources = new Map(actual.sources);
  sources.set("application/synthetic-semantic.js", [
    "export function measure() {",
    "  const width = window.innerWidth;",
    "  return width + localStorage.length;",
    "}"
  ].join("\n"));

  const report = validateArchitectureGraph({
    modules: [...actual.modules, "application/synthetic-semantic.js"],
    graph,
    sources
  });

  assert.equal(report.ok, false);
  assert.equal(
    report.violations.some((item) => (
      item.type === "forbidden-semantic-reference"
      && item.module === "application/synthetic-semantic.js"
      && item.token === "window"
    )),
    true
  );
  assert.equal(
    report.violations.some((item) => (
      item.type === "forbidden-semantic-reference"
      && item.module === "application/synthetic-semantic.js"
      && item.token === "localStorage"
    )),
    true
  );
  assert.match(formatArchitectureReport(report), /window/);
});

test("la validación semántica detecta imports de paquetes prohibidos", async () => {
  const actual = await checkArchitecture();
  const graph = new Map(actual.graph);
  graph.set("application/synthetic-excel.js", []);
  const sources = new Map(actual.sources);
  sources.set("application/synthetic-excel.js", [
    "import { read } from \"xlsx\";",
    "export function load() { return read(\"a.xlsx\"); }"
  ].join("\n"));

  const report = validateArchitectureGraph({
    modules: [...actual.modules, "application/synthetic-excel.js"],
    graph,
    sources
  });

  assert.equal(report.ok, false);
  assert.equal(
    report.violations.some((item) => (
      item.type === "forbidden-application-package"
      && item.module === "application/synthetic-excel.js"
      && item.specifier === "xlsx"
    )),
    true
  );
});

test("la validación semántica ignora comentarios, mensajes y template literals", () => {
  const source = [
    "// window y localStorage no deben usarse; se inyectan adaptadores.",
    "export function notify() {",
    "  throw new Error(\"Usar window solo via adaptador inyectado.\");",
    "  const tip = `Esto menciona fetch y Supabase en un literal.`;",
    "}"
  ].join("\n");

  assert.deepEqual(findForbiddenSemanticReferences(source), []);
});

test("la validación semántica permite un módulo application limpio", async () => {
  const actual = await checkArchitecture();
  const graph = new Map(actual.graph);
  graph.set("application/synthetic-clean.js", []);
  const sources = new Map(actual.sources);
  sources.set("application/synthetic-clean.js", [
    "import { dispatchOperation } from \"./calendar-commands.js\";",
    "export function run(op, payload) {",
    "  const value = structuredClone(payload);",
    "  return dispatchOperation(value, op);",
    "}"
  ].join("\n"));

  const report = validateArchitectureGraph({
    modules: [...actual.modules, "application/synthetic-clean.js"],
    graph,
    sources
  });

  assert.equal(report.ok, true, formatArchitectureReport(report));
  assert.equal(
    report.violations.some((item) => item.type === "forbidden-semantic-reference"),
    false
  );
});
