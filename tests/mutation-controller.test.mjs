import test from "node:test";
import assert from "node:assert/strict";

import { createMutationController } from "../src/ui/mutation-controller.js";

function fixture() {
  let document = {
    appVersion: "old",
    schemaVersion: 1,
    calendarMeta: { revision: 2, updatedAt: "before" },
    settings: { holidayRuleSetVersion: "old" },
    audit: [],
    value: 1
  };
  const events = [];
  const controller = createMutationController({
    getDocument: () => document,
    setDocument: (next) => { document = next; },
    canEdit: () => true,
    executeOperation: (source) => ({
      changed: true,
      document: { ...structuredClone(source), value: 9 }
    }),
    appendAudit: (action, detail) => document.audit.push({ action, detail }),
    appVersion: "current",
    schemaVersion: 4,
    holidayRuleSetVersion: "rules",
    render: () => events.push("render"),
    scheduleSave: () => events.push("save"),
    notify: (message, options) => events.push([message, options]),
    afterUndo: () => events.push("afterUndo")
  });
  return { controller, events, getDocument: () => document };
}

test("el controlador aplica metadatos y conserva una reversión", () => {
  const { controller, events, getDocument } = fixture();
  controller.mutate("changed", "Cambio", () => { getDocument().value = 2; });
  assert.equal(getDocument().value, 2);
  assert.equal(getDocument().appVersion, "current");
  assert.equal(getDocument().schemaVersion, 4);
  assert.equal(getDocument().calendarMeta.revision, 3);
  assert.equal(controller.hasUndo(), true);
  controller.undo();
  assert.equal(getDocument().value, 1);
  assert.deepEqual(events.slice(-4), ["afterUndo", "render", "save", ["Se deshizo: Cambio", undefined]]);
});

test("el controlador restaura el documento si falla una mutación directa", () => {
  const { controller, getDocument } = fixture();
  assert.throws(() => controller.mutate("failed", "Falla", () => {
    getDocument().value = 7;
    throw new Error("falló");
  }), /falló/);
  assert.equal(getDocument().value, 1);
});

test("las operaciones del contrato comparten render, guardado y undo", () => {
  const { controller, getDocument } = fixture();
  const outcome = controller.mutateWithContract("activity.edit", {}, "Edición");
  assert.equal(outcome.changed, true);
  assert.equal(getDocument().value, 9);
  assert.equal(controller.hasUndo(), true);
});
