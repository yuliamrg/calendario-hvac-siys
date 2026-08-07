import test from "node:test";
import assert from "node:assert/strict";

import { createIndexedDocumentStore } from "../src/persistence/indexed-document-store.js";
import { createJsonPreferences } from "../src/persistence/json-preferences.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
}

test("las preferencias JSON aíslan lectura, mezcla y limpieza", () => {
  const storage = memoryStorage({ preferences: '{"theme":"dark"}' });
  const preferences = createJsonPreferences(storage, "preferences");
  assert.deepEqual(preferences.read(), { theme: "dark" });
  assert.deepEqual(preferences.update({ catalogCollapsed: true }), {
    theme: "dark",
    catalogCollapsed: true
  });
  preferences.clear();
  assert.deepEqual(preferences.read(), {});
});

test("las preferencias inválidas conservan el fallback histórico", () => {
  const preferences = createJsonPreferences(memoryStorage({ preferences: "[" }), "preferences");
  assert.deepEqual(preferences.read(), {});
});

test("el adaptador IndexedDB informa navegadores sin almacenamiento", async () => {
  const store = createIndexedDocumentStore({
    databaseName: "calendario-prueba",
    databaseVersion: 1,
    storeName: "documents",
    browserWindow: {}
  });
  await assert.rejects(store.open(), /IndexedDB no está disponible/);
});
