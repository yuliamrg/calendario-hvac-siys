import test from "node:test";
import assert from "node:assert/strict";

import {
  applicationModulePaths,
  discoverApplicationModules,
  validateApplicationModuleManifest
} from "../scripts/build.mjs";

const indexOf = (modulePath) => applicationModulePaths.indexOf(modulePath);

test("el manifiesto cubre el grafo de app.js con orden dependency-first a través de workspaces", async () => {
  const report = await validateApplicationModuleManifest();

  assert.deepEqual(report.missing, []);
  assert.deepEqual(report.orderIssues, []);
  assert.deepEqual(report.duplicatePaths, []);
  assert.equal(report.discovered.every((modulePath) => report.listed.includes(modulePath)), true);

  for (const required of [
    "apps/web/src/importer.js",
    "apps/web/src/ui/activity-presentation.js",
    "apps/web/src/ui/export-layout.js",
    "apps/web/src/application/import-commands.js",
    "packages/platform/src/core.js",
    "packages/platform/src/calendar-contract.js",
    "packages/platform/src/supabase/transport.js"
  ]) {
    assert.equal(applicationModulePaths.includes(required), true, `Falta ${required}`);
  }

  assert.ok(
    indexOf("packages/platform/src/supabase/transport.js") < indexOf("apps/web/src/cloud.js"),
    "supabase/transport.js debe preceder a cloud.js"
  );
  assert.ok(
    indexOf("apps/web/src/ui/activity-presentation.js") < indexOf("apps/web/src/ui/export-layout.js")
  );
  assert.ok(
    indexOf("apps/web/src/importer.js") < indexOf("apps/web/src/app.js")
  );
  assert.ok(
    indexOf("packages/platform/src/core.js") < indexOf("apps/web/src/app.js")
  );

  const discovered = await discoverApplicationModules();
  assert.equal(discovered.modules.includes("apps/web/src/ui/three-motion.js"), false);
  assert.equal(applicationModulePaths.includes("apps/web/src/ui/three-motion.js"), true);
  assert.equal(
    discovered.modules.includes("packages/platform/src/supabase/transport.js"),
    true,
    "el grafo descubierto desde app.js debe incluir el transporte compartido"
  );
  assert.equal(
    discovered.modules.some((modulePath) => modulePath.startsWith("apps/cli/")),
    false,
    "el bundle web nunca debe incorporar la CLI"
  );
});

test("la validación detecta un módulo omitido sin marcar imports internos listados", async () => {
  const manifestWithoutExportLayout = applicationModulePaths.filter(
    (modulePath) => modulePath !== "apps/web/src/ui/export-layout.js"
  );
  const report = await validateApplicationModuleManifest({
    modulePaths: manifestWithoutExportLayout
  });

  assert.equal(
    report.missing.some(({ projectPath }) => projectPath === "apps/web/src/ui/export-layout.js"),
    true
  );
  assert.equal(
    report.missing.some(({ projectPath }) => projectPath === "apps/web/src/ui/activity-presentation.js"),
    false
  );
  assert.equal(
    report.missing.some(({ projectPath }) => projectPath === "apps/web/src/ui/calendar-constants.js"),
    false
  );
});
