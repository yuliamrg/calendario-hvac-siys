import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { createCalendarCommands } from "../src/application/calendar-commands.js";
import { createMutationController } from "../src/ui/mutation-controller.js";

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src");
const staticImportPattern = /\b(?:import|export)\s+(?:(?:[\s\S]*?)\s+from\s+)?["']([^"']+)["']/g;

function fixtureDocument() {
  return {
    appVersion: "old",
    schemaVersion: 1,
    calendarMeta: { revision: 2, updatedAt: "before" },
    settings: { holidayRuleSetVersion: "old" },
    audit: [],
    value: 1
  };
}

test("dispatch delega al contrato exactamente una vez y aplica el documento resultante", () => {
  let document = fixtureDocument();
  let executeCalls = 0;
  let setCalls = 0;
  const commands = createCalendarCommands({
    getDocument: () => document,
    setDocument: (next) => { document = next; setCalls += 1; },
    executeOperation: (source) => {
      executeCalls += 1;
      return { changed: true, document: { ...structuredClone(source), value: 9 } };
    }
  });

  const outcome = commands.dispatch("activity.edit", { activityId: "a1" });

  assert.equal(executeCalls, 1, "executeOperation debe invocarse una sola vez");
  assert.equal(setCalls, 1, "setDocument debe invocarse una sola vez al aplicar el cambio");
  assert.equal(document.value, 9);
  assert.equal(outcome.changed, true);
});

test("un error en el contrato no reemplaza el documento y preserva el mensaje", () => {
  let document = fixtureDocument();
  const snapshot = structuredClone(document);
  const commands = createCalendarCommands({
    getDocument: () => document,
    setDocument: (next) => { document = next; },
    executeOperation: () => {
      const error = new Error("operación rechazada");
      error.code = "VALIDATION_FAILED";
      throw error;
    }
  });

  assert.throws(
    () => commands.dispatch("activity.create", {}),
    (error) => {
      assert.match(error.message, /operación rechazada/);
      assert.equal(error.code, "VALIDATION_FAILED");
      return true;
    }
  );
  assert.equal(document.value, 1, "el documento permanece intacto tras el error");
  assert.deepEqual(document, snapshot, "el documento vivo no debe haberse reemplazado");
});

test("run es un alias de dispatch", () => {
  let document = fixtureDocument();
  let executeCalls = 0;
  const commands = createCalendarCommands({
    getDocument: () => document,
    setDocument: (next) => { document = next; },
    executeOperation: () => { executeCalls += 1; return { changed: false, document }; }
  });

  const outcome = commands.run("calendar.inspect", {});
  assert.equal(executeCalls, 1);
  assert.equal(outcome.changed, false);
});

test("createCalendarCommands exige dependencias explícitas", () => {
  assert.throws(() => createCalendarCommands({}), /requiere/);
  assert.throws(
    () => createCalendarCommands({ getDocument: () => ({}) }),
    /requiere/
  );
});

test("el controlador conserva undo, metadatos y restauración al usar la fachada", () => {
  let document = fixtureDocument();
  const events = [];
  const controller = createMutationController({
    getDocument: () => document,
    setDocument: (next) => { document = next; },
    canEdit: () => true,
    executeOperation: (source) => ({ changed: true, document: { ...structuredClone(source), value: 9 } }),
    appendAudit: (action, detail) => document.audit.push({ action, detail }),
    appVersion: "current",
    schemaVersion: 4,
    holidayRuleSetVersion: "rules",
    render: () => events.push("render"),
    scheduleSave: () => events.push("save"),
    notify: (message, options) => events.push([message, options]),
    afterUndo: () => events.push("afterUndo"),
    importAdapter: (source) => structuredClone(source)
  });

  const outcome = controller.mutateWithContract("activity.edit", {}, "Edición");
  assert.equal(outcome.changed, true);
  assert.equal(document.value, 9);
  assert.equal(controller.hasUndo(), true);
  controller.undo();
  assert.equal(document.value, 1);
  assert.deepEqual(events.slice(-4), ["afterUndo", "render", "save", ["Se deshizo: Edición", undefined]]);

  document = fixtureDocument();
  controller.clearUndo();
  controller.mutate("meta", "Cambio directo", () => { document.value = 5; });
  assert.equal(document.value, 5);
  assert.equal(document.appVersion, "current");
  assert.equal(document.schemaVersion, 4);
  assert.equal(document.calendarMeta.revision, 3);
  assert.equal(controller.hasUndo(), true);
  controller.undo();
  assert.equal(document.value, 1);
});

test("la capa de aplicación no acopla UI, persistence, cloud ni cli", async () => {
  const source = await readFile(resolve(sourceRoot, "application", "calendar-commands.js"), "utf8");
  const specifiers = [...source.matchAll(staticImportPattern)].map((match) => match[1]);
  const forbidden = specifiers.filter((spec) => {
    const normalized = spec.replaceAll("\\", "/");
    return (
      normalized.startsWith("./ui")
      || normalized.startsWith("../ui")
      || normalized.startsWith("./persistence")
      || normalized.startsWith("../persistence")
      || normalized === "./cloud.js"
      || normalized === "../cloud.js"
      || normalized.startsWith("./cloud/")
      || normalized.startsWith("../cloud/")
      || normalized.startsWith("./cli")
      || normalized.startsWith("../cli")
      || normalized.startsWith("./import")
      || normalized.startsWith("../import")
    );
  });
  assert.deepEqual(forbidden, [], `La capa de aplicación no debe importar infraestructura: ${forbidden.join(", ")}`);
});
