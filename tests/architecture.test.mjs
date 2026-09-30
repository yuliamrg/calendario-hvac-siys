import test from "node:test";
import assert from "node:assert/strict";

import {
  checkArchitecture,
  classifyModule,
  extractLocalImportSpecifiers,
  findForbiddenPackageReferences,
  findForbiddenSemanticReferences,
  findForbiddenSupabaseRuntimeImports,
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
    report.graph.get("cli/main.js").some(({ relativePath }) => relativePath === "cli/cloud-read.js"),
    true,
    "El grafo debe capturar la ruta de lectura cloud de la CLI"
  );
  assert.equal(
    report.graph.get("cli/main.js").some(({ relativePath }) => relativePath === "cli/cloud-write.js"),
    true,
    "El grafo debe capturar la frontera de escritura cloud de la CLI"
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
    report.graph.get("cli/main.js").some(({ relativePath }) => relativePath === "cli/cloud-read.js"),
    true,
    "El grafo debe capturar la ruta de lectura cloud de la CLI"
  );
  assert.equal(
    report.graph.get("cli/main.js").some(({ relativePath }) => relativePath === "cli/cloud-write.js"),
    true,
    "El grafo debe capturar la frontera de escritura cloud de la CLI"
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

test("la capa supabase clasifica el transporte compartido y respeta el grafo real", async () => {
  const report = await checkArchitecture();

  assert.equal(report.ok, true, formatArchitectureReport(report));
  assert.deepEqual(report.violations, []);
  assert.equal(classifyModule("supabase/transport.js"), "supabase");
  assert.equal(report.modules.includes("supabase/transport.js"), true);
});

test("un módulo supabase no puede importar ninguna otra capa", async () => {
  const actual = await checkArchitecture();
  const graph = new Map(actual.graph);
  const forbiddenTargets = [
    { specifier: "../cli/main.js", relativePath: "cli/main.js", layer: "cli" },
    { specifier: "../cloud.js", relativePath: "cloud.js", layer: "cloud" },
    { specifier: "../ui/presentation.js", relativePath: "ui/presentation.js", layer: "ui" },
    { specifier: "../persistence/json-preferences.js", relativePath: "persistence/json-preferences.js", layer: "persistence" },
    { specifier: "../application/calendar-commands.js", relativePath: "application/calendar-commands.js", layer: "application" },
    { specifier: "../core.js", relativePath: "core.js", layer: "core" },
    { specifier: "../calendar-contract.js", relativePath: "calendar-contract.js", layer: "contract" },
    { specifier: "../domain/dates.js", relativePath: "domain/dates.js", layer: "domain" }
  ];
  graph.set("supabase/synthetic-violation.js", forbiddenTargets.map(({ specifier, relativePath }) => ({
    specifier,
    relativePath
  })));

  const report = validateArchitectureGraph({
    modules: [...actual.modules, "supabase/synthetic-violation.js"],
    graph
  });

  assert.equal(report.ok, false);
  for (const target of forbiddenTargets) {
    assert.equal(
      report.violations.some((item) => (
        item.type === "forbidden-import"
        && item.importer === "supabase/synthetic-violation.js"
        && item.dependency === target.relativePath
        && item.dependencyLayer === target.layer
      )),
      true,
      `supabase no debe importar ${target.relativePath}`
    );
  }
});

test("cli puede importar la capa supabase", async () => {
  const actual = await checkArchitecture();
  const graph = new Map(actual.graph);
  graph.set("cli/synthetic-supabase.js", [
    { specifier: "../supabase/transport.js", relativePath: "supabase/transport.js" }
  ]);

  const report = validateArchitectureGraph({
    modules: [...actual.modules, "cli/synthetic-supabase.js"],
    graph
  });

  assert.equal(report.ok, true, formatArchitectureReport(report));
  assert.equal(report.violations.length, 0);
});

test("cloud puede importar la capa supabase", async () => {
  const actual = await checkArchitecture();
  const graph = new Map(actual.graph);
  graph.set("cloud.js", [
    ...(actual.graph.get("cloud.js") ?? []),
    { specifier: "./supabase/transport.js", relativePath: "supabase/transport.js" }
  ]);

  const report = validateArchitectureGraph({
    modules: actual.modules,
    graph
  });

  assert.equal(report.ok, true, formatArchitectureReport(report));
  assert.equal(report.violations.length, 0);
});

test("extractLocalImportSpecifiers detecta imports locales estáticos y dinámicos", () => {
  const source = [
    'import { a } from "./estatico.js";',
    'const dynamic = await import("./dinamico.js");',
    'import { readFile } from "node:fs/promises";',
    'import { b } from "../otro/path.js";'
  ].join("\n");
  assert.deepEqual(
    extractLocalImportSpecifiers(source).sort(),
    ["../otro/path.js", "./dinamico.js", "./estatico.js"]
  );
});

test("findForbiddenSupabaseRuntimeImports detecta cualquier specifier node:", () => {
  const source = [
    'import { readFile } from "node:fs/promises";',
    'import { homedir } from "node:os";',
    'import { join } from "node:path";',
    'const stream = await import("node:stream");',
    'import { createTransport } from "../transport.js";',
    'import test from "node:test";'
  ].join("\n");

  assert.deepEqual(
    findForbiddenSupabaseRuntimeImports(source).sort(),
    ["node:fs/promises", "node:os", "node:path", "node:stream", "node:test"]
  );
  assert.deepEqual(findForbiddenSupabaseRuntimeImports('import x from "./local.js";'), []);
});

test("un módulo supabase no puede importar módulos runtime node:", async () => {
  const actual = await checkArchitecture();
  const graph = new Map(actual.graph);
  graph.set("supabase/synthetic-runtime.js", []);
  const sources = new Map(actual.sources);
  sources.set("supabase/synthetic-runtime.js", [
    'import { readFile } from "node:fs/promises";',
    'import { homedir } from "node:os";',
    'export async function load() { return readFile(homedir(), "utf8"); }'
  ].join("\n"));

  const report = validateArchitectureGraph({
    modules: [...actual.modules, "supabase/synthetic-runtime.js"],
    graph,
    sources
  });

  assert.equal(report.ok, false);
  for (const specifier of ["node:fs/promises", "node:os"]) {
    assert.equal(
      report.violations.some((item) => (
        item.type === "forbidden-supabase-runtime-import"
        && item.module === "supabase/synthetic-runtime.js"
        && item.specifier === specifier
      )),
      true,
      `supabase no debe importar ${specifier}`
    );
  }
  assert.match(formatArchitectureReport(report), /node:fs\/promises/);
});

test("la prohibición de node: no aplica a la capa cli", async () => {
  const actual = await checkArchitecture();
  const graph = new Map(actual.graph);
  graph.set("cli/synthetic-runtime.js", []);
  const sources = new Map(actual.sources);
  sources.set("cli/synthetic-runtime.js", [
    'import { readFile } from "node:fs/promises";',
    'import { homedir } from "node:os";'
  ].join("\n"));

  const report = validateArchitectureGraph({
    modules: [...actual.modules, "cli/synthetic-runtime.js"],
    graph,
    sources
  });

  assert.equal(report.ok, true, formatArchitectureReport(report));
  assert.equal(report.violations.length, 0);
});

test("domain, core, contract y application no pueden importar supabase", async () => {
  const actual = await checkArchitecture();
  const graph = new Map(actual.graph);
  const syntheticModules = [
    "domain/synthetic-supabase.js",
    "application/synthetic-supabase.js"
  ];
  const supabaseDependency = [{ specifier: "../supabase/transport.js", relativePath: "supabase/transport.js" }];
  graph.set("domain/synthetic-supabase.js", supabaseDependency);
  graph.set("application/synthetic-supabase.js", supabaseDependency);
  graph.set("core.js", [
    ...(actual.graph.get("core.js") ?? []),
    { specifier: "./supabase/transport.js", relativePath: "supabase/transport.js" }
  ]);
  graph.set("calendar-contract.js", [
    ...(actual.graph.get("calendar-contract.js") ?? []),
    { specifier: "./supabase/transport.js", relativePath: "supabase/transport.js" }
  ]);

  const report = validateArchitectureGraph({
    modules: [...actual.modules, ...syntheticModules],
    graph
  });

  assert.equal(report.ok, false);
  for (const importer of [...syntheticModules, "core.js", "calendar-contract.js"]) {
    assert.equal(
      report.violations.some((item) => (
        item.type === "forbidden-import"
        && item.importer === importer
        && item.dependency === "supabase/transport.js"
        && item.dependencyLayer === "supabase"
      )),
      true,
      `${importer} no debe importar supabase`
    );
  }
});

test("product boundaries reject shared-to-client and cross-client version imports without filename-specific rules", async () => {
  const actual = await checkArchitecture();
  for (const importer of ["domain/dates.js", "core.js", "calendar-contract.js", "application/calendar-commands.js", "cli/main.js", "app.js"]) {
    const targets = importer === "cli/main.js" ? ["ui/future-identity.js"]
      : importer === "app.js" ? ["cli/future-identity.js"]
        : ["ui/future-identity.js", "cli/future-identity.js"];
    for (const dependency of targets) {
      const graph = new Map(actual.graph);
      graph.set(importer, [{ specifier: `./${dependency}`, relativePath: dependency }]);
      const report = validateArchitectureGraph({ modules: [...actual.modules, dependency], graph });
      assert.ok(report.violations.some((item) => item.type === "forbidden-import" && item.importer === importer && item.dependency === dependency));
    }
  }
});

test("shared modules cannot reintroduce product release ownership", async () => {
  const actual = await checkArchitecture();
  for (const module of ["core.js", "calendar-contract.js", "domain/dates.js", "application/calendar-commands.js"]) {
    for (const token of ["APP_VERSION", "WEB_VERSION", "CLI_VERSION"]) {
      const sources = new Map(actual.sources);
      sources.set(module, `export const ${token} = "9.8.7";`);
      const report = validateArchitectureGraph({ ...actual, sources });
      assert.ok(report.violations.some((item) => item.type === "shared-product-version" && item.module === module && item.token === token));
    }
  }
});
