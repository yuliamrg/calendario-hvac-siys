import test from "node:test";
import assert from "node:assert/strict";

import {
  applicationModuleRelativePaths,
  discoverApplicationModules,
  validateApplicationModuleManifest
} from "../scripts/build.mjs";

test("el manifiesto cubre el grafo local de app.js y conserva el orden", async () => {
  const report = await validateApplicationModuleManifest();

  assert.deepEqual(report.missing, []);
  assert.deepEqual(report.orderIssues, []);
  assert.deepEqual(report.duplicatePaths, []);
  assert.equal(report.discovered.every((modulePath) => report.listed.includes(modulePath)), true);

  for (const required of [
    "importer.js",
    "ui/activity-presentation.js",
    "ui/export-layout.js",
    "application/import-commands.js"
  ]) {
    assert.equal(applicationModuleRelativePaths.includes(required), true, `Falta ${required}`);
  }

  assert.ok(
    applicationModuleRelativePaths.indexOf("ui/activity-presentation.js") <
      applicationModuleRelativePaths.indexOf("ui/export-layout.js")
  );
  assert.ok(
    applicationModuleRelativePaths.indexOf("importer.js") <
      applicationModuleRelativePaths.indexOf("app.js")
  );

  const discovered = await discoverApplicationModules();
  assert.equal(discovered.modules.includes("ui/three-motion.js"), false);
  assert.equal(applicationModuleRelativePaths.includes("ui/three-motion.js"), true);
});

test("la validacion detecta un modulo omitido sin marcar imports internos listados", async () => {
  const manifestWithoutExportLayout = applicationModuleRelativePaths.filter(
    (modulePath) => modulePath !== "ui/export-layout.js"
  );
  const report = await validateApplicationModuleManifest({
    moduleRelativePaths: manifestWithoutExportLayout
  });

  assert.equal(
    report.missing.some(({ relativePath }) => relativePath === "ui/export-layout.js"),
    true
  );
  assert.equal(
    report.missing.some(({ relativePath }) => relativePath === "ui/activity-presentation.js"),
    false
  );
  assert.equal(
    report.missing.some(({ relativePath }) => relativePath === "ui/calendar-constants.js"),
    false
  );
});
