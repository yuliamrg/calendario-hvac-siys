import test from "node:test";
import assert from "node:assert/strict";

import {
  checkArchitecture,
  classifyModule,
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
