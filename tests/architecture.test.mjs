import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyModule,
  checkArchitecture,
  extractImportSpecifiers,
  findForbiddenPackageReferences,
  findForbiddenPlatformReferences,
  findForbiddenSemanticReferences,
  findForbiddenSupabaseRuntimeImports,
  formatArchitectureReport,
  resolveImportSpecifier,
  validateArchitectureGraph
} from "../scripts/architecture-check.mjs";

const clonedGraph = (actual) => new Map(actual.graph);

test("el grafo real respeta las fronteras de los tres workspaces", async () => {
  const report = await checkArchitecture();

  assert.equal(report.ok, true, formatArchitectureReport(report));
  assert.deepEqual(report.violations, []);
  assert.equal(classifyModule("apps/web/src/app.js"), "web/composition");
  assert.equal(classifyModule("apps/cli/src/main.js"), "cli");
  assert.equal(classifyModule("packages/platform/src/core.js"), "platform/core");
  assert.equal(classifyModule("packages/platform/src/calendar-contract.js"), "platform/contract");
  assert.equal(classifyModule("packages/platform/src/domain/dates.js"), "platform/domain");
  assert.equal(classifyModule("packages/platform/src/supabase/transport.js"), "platform/supabase");

  assert.equal(classifyModule("apps/cli/bin/calendary.js"), "cli");
  assert.ok(report.modules.includes("apps/cli/bin/calendary.js"));
  const mainGraph = report.graph.get("apps/cli/src/main.js");
  assert.ok(mainGraph.some(({ projectPath }) => projectPath === "apps/cli/src/cloud-read.js"));
  assert.ok(mainGraph.some(({ projectPath }) => projectPath === "apps/cli/src/cloud-write.js"));
  assert.ok(
    mainGraph.some(({ projectPath }) => projectPath === "packages/platform/src/calendar-contract.js"),
    "la CLI debe resolver el contrato compartido por el workspace de plataforma"
  );
  assert.ok(
    report.modules.includes("packages/platform/src/supabase/transport.js"),
    "el grafo debe capturar el transporte compartido"
  );
});

test("platform no puede importar web ni cli", async () => {
  const actual = await checkArchitecture();
  for (const target of [
    { boundary: "web/ui", projectPath: "apps/web/src/ui/presentation.js" },
    { boundary: "cli", projectPath: "apps/cli/src/main.js" }
  ]) {
    const graph = clonedGraph(actual);
    const modulePath = "packages/platform/src/domain/synthetic-violation.js";
    graph.set(modulePath, [{ specifier: `../${target.projectPath}`, projectPath: target.projectPath }]);
    const report = validateArchitectureGraph({ ...actual, graph, modules: [...actual.modules, modulePath] });
    assert.equal(report.ok, false);
    assert.ok(
      report.violations.some((item) => (
        item.type === "forbidden-import"
        && item.importer === modulePath
        && item.dependencyBoundary === target.boundary
      )),
      `platform no debe importar ${target.boundary}`
    );
  }
});

test("web no puede importar cli y cli no puede importar web", async () => {
  const actual = await checkArchitecture();
  const cases = [
    {
      importer: "apps/web/src/app.js",
      importerBoundary: "web/composition",
      target: "apps/cli/src/main.js",
      targetBoundary: "cli"
    },
    {
      importer: "apps/cli/src/main.js",
      importerBoundary: "cli",
      target: "apps/web/src/ui/presentation.js",
      targetBoundary: "web/ui"
    }
  ];
  for (const testCase of cases) {
    const graph = clonedGraph(actual);
    graph.set(testCase.importer, [
      ...(actual.graph.get(testCase.importer) ?? []),
      { specifier: `./${testCase.target}`, projectPath: testCase.target }
    ]);
    const report = validateArchitectureGraph({ ...actual, graph });
    assert.equal(report.ok, false);
    assert.ok(
      report.violations.some((item) => (
        item.type === "forbidden-import"
        && item.importer === testCase.importer
        && item.dependencyBoundary === testCase.targetBoundary
      )),
      `${testCase.importer} no debe importar ${testCase.target}`
    );
  }
});

test("un módulo platform no puede importar runtime Node ni APIs de navegador", async () => {
  const actual = await checkArchitecture();
  const modulePath = "packages/platform/src/domain/synthetic-runtime.js";
  const graph = clonedGraph(actual);
  const sources = new Map(actual.sources);
  graph.set(modulePath, [
    { specifier: "node:fs/promises", projectPath: null }
  ]);
  sources.set(modulePath, [
    'import { readFile } from "node:fs/promises";',
    "export function read() {",
    "  return window.innerWidth + localStorage.length + readFile;",
    "}"
  ].join("\n"));

  const report = validateArchitectureGraph({
    ...actual,
    modules: [...actual.modules, modulePath],
    graph,
    sources
  });

  assert.equal(report.ok, false);
  assert.ok(report.violations.some((item) => (
    item.type === "forbidden-platform-runtime-import"
    && item.module === modulePath
    && item.specifier === "node:fs/promises"
  )));
  for (const token of ["window", "localStorage"]) {
    assert.ok(report.violations.some((item) => (
      item.type === "forbidden-platform-reference"
      && item.module === modulePath
      && item.token === token
    )));
  }
});

test("los módulos compartidos no pueden reintroducir la identidad de producto", async () => {
  const actual = await checkArchitecture();
  for (const modulePath of [
    "packages/platform/src/core.js",
    "packages/platform/src/calendar-contract.js",
    "packages/platform/src/domain/dates.js",
    "apps/web/src/application/calendar-commands.js",
    "apps/web/src/import/xlsx-table.js",
    "packages/platform/src/supabase/transport.js"
  ]) {
    for (const token of ["APP_VERSION", "WEB_VERSION", "CLI_VERSION"]) {
      const sources = new Map(actual.sources);
      sources.set(modulePath, `export const ${token} = "9.8.7";`);
      const report = validateArchitectureGraph({ ...actual, sources });
      assert.ok(report.violations.some((item) => (
        item.type === "shared-product-version"
        && item.module === modulePath
        && item.token === token
      )), `${modulePath} no debe declarar ${token}`);
    }
  }
});

test("la capa application web rechaza tokens y paquetes prohibidos", async () => {
  const actual = await checkArchitecture();
  const semanticModule = "apps/web/src/application/synthetic-semantic.js";
  const semanticSources = new Map(actual.sources);
  semanticSources.set(semanticModule, [
    "export function measure() {",
    "  const width = window.innerWidth;",
    "  return width + localStorage.length;",
    "}"
  ].join("\n"));
  const semanticReport = validateArchitectureGraph({
    ...actual,
    modules: [...actual.modules, semanticModule],
    sources: semanticSources
  });
  for (const token of ["window", "localStorage"]) {
    assert.ok(semanticReport.violations.some((item) => (
      item.type === "forbidden-semantic-reference"
      && item.module === semanticModule
      && item.token === token
    )));
  }

  const packageModule = "apps/web/src/application/synthetic-excel.js";
  const packageSources = new Map(actual.sources);
  packageSources.set(packageModule, 'import { read } from "xlsx";\nexport const load = () => read("a.xlsx");');
  const packageReport = validateArchitectureGraph({
    ...actual,
    modules: [...actual.modules, packageModule],
    sources: packageSources
  });
  assert.ok(packageReport.violations.some((item) => (
    item.type === "forbidden-application-package"
    && item.module === packageModule
    && item.specifier === "xlsx"
  )));
});

test("el transporte supabase es dual-runtime y no puede importar node:", async () => {
  const actual = await checkArchitecture();
  const modulePath = "packages/platform/src/supabase/synthetic-runtime.js";
  const sources = new Map(actual.sources);
  sources.set(modulePath, [
    'import { readFile } from "node:fs/promises";',
    'import { homedir } from "node:os";',
    "export async function load() { return readFile(homedir(), \"utf8\"); }"
  ].join("\n"));
  const report = validateArchitectureGraph({
    ...actual,
    modules: [...actual.modules, modulePath],
    sources
  });
  for (const specifier of ["node:fs/promises", "node:os"]) {
    assert.ok(report.violations.some((item) => (
      item.type === "forbidden-supabase-runtime-import"
      && item.module === modulePath
      && item.specifier === specifier
    )));
  }
});

test("la prohibición de node: no aplica a la capa cli", async () => {
  const actual = await checkArchitecture();
  const modulePath = "apps/cli/src/synthetic-runtime.js";
  const sources = new Map(actual.sources);
  sources.set(modulePath, [
    'import { readFile } from "node:fs/promises";',
    'import { homedir } from "node:os";'
  ].join("\n"));
  const report = validateArchitectureGraph({
    ...actual,
    modules: [...actual.modules, modulePath],
    sources
  });
  assert.equal(report.ok, true, formatArchitectureReport(report));
  assert.deepEqual(report.violations, []);
});

test("las fronteras internas conservan sus prohibiciones entre capas", async () => {
  const actual = await checkArchitecture();
  const cases = [
    ["packages/platform/src/supabase/transport.js", "packages/platform/src/domain/dates.js", "platform/domain"],
    ["packages/platform/src/core.js", "packages/platform/src/supabase/transport.js", "platform/supabase"],
    ["apps/web/src/ui/presentation.js", "packages/platform/src/supabase/transport.js", "platform/supabase"],
    ["apps/web/src/persistence/json-preferences.js", "apps/web/src/ui/presentation.js", "web/ui"],
    ["apps/web/src/import/xlsx-table.js", "apps/web/src/ui/presentation.js", "web/ui"],
    ["apps/web/src/application/calendar-commands.js", "apps/web/src/import/xlsx-table.js", "web/import"]
  ];
  for (const [importer, target, dependencyBoundary] of cases) {
    const graph = clonedGraph(actual);
    graph.set(importer, [{ specifier: `./${target}`, projectPath: target }]);
    const report = validateArchitectureGraph({ ...actual, graph });
    assert.ok(
      report.violations.some((item) => (
        item.type === "forbidden-import"
        && item.importer === importer
        && item.dependencyBoundary === dependencyBoundary
      )),
      `${importer} no debe importar ${target}`
    );
  }
});

test("un import de plataforma no declarado en los exports se marca", async () => {
  const actual = await checkArchitecture();
  const graph = clonedGraph(actual);
  graph.set("apps/web/src/app.js", [
    ...(actual.graph.get("apps/web/src/app.js") ?? []),
    {
      specifier: "@siys-sync/platform/domain/holidays.js",
      projectPath: "packages/platform/src/domain/holidays.js"
    }
  ]);
  const report = validateArchitectureGraph({ ...actual, graph });
  assert.equal(report.ok, false);
  assert.ok(report.violations.some((item) => (
    item.type === "undeclared-platform-export"
    && item.subpath === "./domain/holidays.js"
  )));
});

test("un módulo sin frontera declarada y un import irresoluble se detectan", async () => {
  const actual = await checkArchitecture();
  const unknownModule = "apps/web/src/mystery.js";
  const graph = clonedGraph(actual);
  graph.set("apps/web/src/app.js", [
    ...(actual.graph.get("apps/web/src/app.js") ?? []),
    { specifier: "desconocido", projectPath: null }
  ]);
  const report = validateArchitectureGraph({
    ...actual,
    modules: [...actual.modules, unknownModule],
    graph
  });
  assert.equal(report.ok, false);
  assert.ok(report.violations.some((item) => (
    item.type === "unknown-layer" && item.module === unknownModule
  )));
  assert.ok(report.violations.some((item) => (
    item.type === "unresolved-import" && item.specifier === "desconocido"
  )));
});

test("extractImportSpecifiers detecta imports estáticos y dinámicos", () => {
  const source = [
    'import { a } from "./estatico.js";',
    'const dynamic = await import("./dinamico.js");',
    'import { readFile } from "node:fs/promises";',
    'import { b } from "@siys-sync/platform/core.js";'
  ].join("\n");
  assert.deepEqual(
    extractImportSpecifiers(source).sort(),
    ["@siys-sync/platform/core.js", "./dinamico.js", "./estatico.js", "node:fs/promises"].sort()
  );
});

test("resolveImportSpecifier traduce rutas relativas y exports de plataforma", () => {
  assert.equal(
    resolveImportSpecifier("apps/web/src/app.js", "./core.js"),
    "apps/web/src/core.js"
  );
  assert.equal(
    resolveImportSpecifier("apps/web/src/import/base-operativa.js", "./xlsx-table.js"),
    "apps/web/src/import/xlsx-table.js"
  );
  assert.equal(
    resolveImportSpecifier("apps/web/src/app.js", "@siys-sync/platform/core.js"),
    "packages/platform/src/core.js"
  );
  assert.equal(resolveImportSpecifier("apps/cli/src/files.js", "node:path"), null);
});

test("findForbiddenPlatformReferences y findForbiddenSemanticReferences separan sus tokens", () => {
  assert.deepEqual(findForbiddenPlatformReferences("const x = window; const y = localStorage;"), ["window", "localStorage"]);
  assert.deepEqual(findForbiddenPlatformReferences("const document = {};"), []);
  assert.deepEqual(findForbiddenSemanticReferences('const t = `fetch y Supabase`;'), []);
  assert.deepEqual(findForbiddenSemanticReferences("document.createElement('div');"), ["document"]);
});

test("findForbiddenSupabaseRuntimeImports detecta cualquier specifier node:", () => {
  const source = [
    'import { readFile } from "node:fs/promises";',
    'import { homedir } from "node:os";',
    'const stream = await import("node:stream");',
    'import { createTransport } from "@siys-sync/platform/supabase/transport.js";'
  ].join("\n");
  assert.deepEqual(
    findForbiddenSupabaseRuntimeImports(source).sort(),
    ["node:fs/promises", "node:os", "node:stream"]
  );
});

test("findForbiddenPackageReferences detecta paquetes excel/supabase", () => {
  assert.deepEqual(findForbiddenPackageReferences('import { read } from "xlsx";'), ["xlsx"]);
  assert.deepEqual(findForbiddenPackageReferences('import { createClient } from "@supabase/supabase-js";'), ["@supabase/supabase-js"]);
});

test("el bin CLI rechaza Web, persistencia browser y versión Web", async () => {
  const actual = await checkArchitecture();
  for (const target of ["apps/web/src/app.js", "apps/web/src/persistence/json-preferences.js", "apps/web/src/ui/web-version.js"]) {
    const graph = clonedGraph(actual);
    const importer = "apps/cli/bin/calendary.js";
    graph.set(importer, [...actual.graph.get(importer), { specifier: target, projectPath: target }]);
    const report = validateArchitectureGraph({ ...actual, graph });
    assert.ok(report.violations.some((item) => item.type === "forbidden-import" && item.importer === importer));
  }
});
