import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { createImportCommands } from "../src/application/import-commands.js";

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

test("dispatch invoca adapter una vez y aplica el documento devuelto", () => {
  let document = fixtureDocument();
  let adapterCalls = 0;
  let setCalls = 0;
  const commands = createImportCommands({
    getDocument: () => document,
    setDocument: (next) => { document = next; setCalls += 1; },
    adapter: (current, payload) => {
      adapterCalls += 1;
      return { ...structuredClone(current), value: payload.value };
    }
  });

  const outcome = commands.dispatch({ value: 9 });

  assert.equal(adapterCalls, 1, "adapter debe invocarse una sola vez");
  assert.equal(setCalls, 1, "setDocument debe invocarse una sola vez al aplicar el cambio");
  assert.equal(document.value, 9);
  assert.equal(outcome.changed, true);
  assert.equal(outcome.document.value, 9);
  assert.deepEqual(outcome.result, {});
});

test("dispatch normaliza resultado cuando adapter devuelve {document, ...result}", () => {
  let document = fixtureDocument();
  const commands = createImportCommands({
    getDocument: () => document,
    setDocument: (next) => { document = next; },
    adapter: (current, payload) => ({
      document: { ...structuredClone(current), value: payload.value },
      importedCount: 5,
      warnings: ["advertencia 1"]
    })
  });

  const outcome = commands.dispatch({ value: 7 });

  assert.equal(document.value, 7);
  assert.equal(outcome.changed, true);
  assert.equal(outcome.document.value, 7);
  assert.deepEqual(outcome.result, { importedCount: 5, warnings: ["advertencia 1"] });
});

test("rollback restaura snapshot exacto ante error en adapter", () => {
  let document = fixtureDocument();
  const snapshot = structuredClone(document);
  const commands = createImportCommands({
    getDocument: () => document,
    setDocument: (next) => { document = next; },
    adapter: () => {
      throw new Error("adapter rechazado");
    }
  });

  assert.throws(
    () => commands.dispatch({}),
    (error) => {
      assert.match(error.message, /adapter rechazado/);
      return true;
    }
  );
  assert.equal(document.value, 1, "el documento permanece intacto tras el error");
  assert.deepEqual(document, snapshot, "el documento vivo no debe haberse reemplazado");
});

test("rollback restaura snapshot aunque el adapter mute el documento recibido y luego falle", () => {
  let document = fixtureDocument();
  const snapshot = structuredClone(document);
  const commands = createImportCommands({
    getDocument: () => document,
    setDocument: (next) => { document = next; },
    adapter: (current) => {
      current.value = 999;
      current.mutated = true;
      throw new Error("falla tras mutar");
    }
  });

  assert.throws(
    () => commands.dispatch({}),
    (error) => {
      assert.match(error.message, /falla tras mutar/);
      return true;
    }
  );
  assert.equal(document.value, 1, "el documento original no debe mutarse");
  assert.deepEqual(document, snapshot, "el snapshot debe restaurarse exactamente");
});

test("createImportCommands exige dependencias explícitas", () => {
  assert.throws(() => createImportCommands({}), /requiere/);
  assert.throws(
    () => createImportCommands({ getDocument: () => ({}) }),
    /requiere/
  );
  assert.throws(
    () => createImportCommands({ getDocument: () => ({}), setDocument: () => {} }),
    /requiere/
  );
});

test("run es un alias de dispatch", () => {
  let document = fixtureDocument();
  let adapterCalls = 0;
  const commands = createImportCommands({
    getDocument: () => document,
    setDocument: (next) => { document = next; },
    adapter: (current, payload) => {
      adapterCalls += 1;
      return { ...structuredClone(current), value: payload.value };
    }
  });

  const outcome = commands.run({ value: 42 });
  assert.equal(adapterCalls, 1);
  assert.equal(outcome.changed, true);
  assert.equal(document.value, 42);
});

test("adapter que devuelve null lanza error y hace rollback", () => {
  let document = fixtureDocument();
  const snapshot = structuredClone(document);
  const commands = createImportCommands({
    getDocument: () => document,
    setDocument: (next) => { document = next; },
    adapter: () => null
  });

  assert.throws(
    () => commands.dispatch({}),
    (error) => {
      assert.match(error.message, /no produjo un documento válido/);
      return true;
    }
  );
  assert.deepEqual(document, snapshot);
});

test("la capa de aplicación no acopla UI, persistence, cloud, cli ni src/import", async () => {
  const source = await readFile(resolve(sourceRoot, "application", "import-commands.js"), "utf8");
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