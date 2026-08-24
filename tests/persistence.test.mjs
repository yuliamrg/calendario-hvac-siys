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

function cloneValue(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function fakeIndexedDB() {
  let database = null;

  class FakeRequest {
    result = undefined;
    error = null;
    onupgradeneeded = null;
    onsuccess = null;
    onerror = null;
  }

  class FakeTransaction {
    constructor(owner, mode) {
      this.owner = owner;
      this.mode = mode;
      this.operations = [];
      this.pending = 0;
      this.processing = false;
      this.finished = false;
      this.oncomplete = null;
      this.onerror = null;
      this.onabort = null;
    }

    enqueue(operation) {
      this.operations.push(operation);
      this.pending += 1;
      queueMicrotask(() => this.drain());
    }

    drain() {
      if (this.processing || this.finished) return;
      this.processing = true;
      while (this.operations.length > 0) {
        const operation = this.operations.shift();
        this.pending -= 1;
        operation();
      }
      this.processing = false;
      if (this.pending === 0) {
        this.finished = true;
        this.owner.afterTransaction?.({ mode: this.mode });
        this.oncomplete?.();
      }
    }

    objectStore() {
      return new FakeObjectStore(this);
    }
  }

  class FakeObjectStore {
    constructor(transaction) {
      this.transaction = transaction;
    }

    get(key) {
      const request = new FakeRequest();
      this.transaction.enqueue(() => {
        this.transaction.owner.beforeGet?.({
          key,
          mode: this.transaction.mode
        });
        request.result = cloneValue(this.transaction.owner.records.get(key));
        request.onsuccess?.({ target: request });
      });
      return request;
    }

    put(value) {
      const request = new FakeRequest();
      this.transaction.enqueue(() => {
        this.transaction.owner.records.set(value.key, cloneValue(value));
        request.result = value.key;
        request.onsuccess?.({ target: request });
      });
      return request;
    }

    delete(key) {
      const request = new FakeRequest();
      this.transaction.enqueue(() => {
        this.transaction.owner.records.delete(key);
        request.result = undefined;
        request.onsuccess?.({ target: request });
      });
      return request;
    }
  }

  class FakeDatabase {
    constructor() {
      this.records = new Map();
      this.transactionModes = [];
      this.objectStoreNames = {
        contains: (name) => this.hasObjectStore === name
      };
      this.hasObjectStore = null;
      this.closed = false;
      this.closeCount = 0;
      this.onversionchange = null;
      this.beforeGet = null;
      this.afterTransaction = null;
    }

    createObjectStore(name) {
      this.hasObjectStore = name;
      return new FakeObjectStore(new FakeTransaction(this, "versionchange"));
    }

    transaction(_storeName, mode) {
      this.transactionModes.push(mode);
      return new FakeTransaction(this, mode);
    }

    close() {
      this.closed = true;
      this.closeCount += 1;
    }
  }

  const indexedDB = {
    open() {
      const request = new FakeRequest();
      queueMicrotask(() => {
        database = new FakeDatabase();
        request.result = database;
        request.onupgradeneeded?.({ target: request });
        request.onsuccess?.({ target: request });
      });
      return request;
    }
  };

  return {
    browserWindow: { indexedDB },
    get database() {
      return database;
    }
  };
}

async function openFakeStore() {
  const fake = fakeIndexedDB();
  const store = createIndexedDocumentStore({
    databaseName: "calendario-prueba",
    databaseVersion: 1,
    storeName: "documents",
    browserWindow: fake.browserWindow
  });
  const database = await store.open();
  return { fake, store, database };
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

test("la conexión IndexedDB se cierra ante un cambio de versión", async () => {
  const { database } = await openFakeStore();

  assert.equal(typeof database.onversionchange, "function");
  database.onversionchange();

  assert.equal(database.closed, true);
  assert.equal(database.closeCount, 1);
});

test("claimLock considera heartbeat inválido o ausente como stale", async (t) => {
  for (const [label, heartbeat] of [
    ["inválido", "no-es-un-fecha"],
    ["ausente", undefined]
  ]) {
    await t.test(label, async () => {
      const { store, database } = await openFakeStore();
      const key = "edit-lock";
      const current = { key, ownerId: "dueño-anterior" };
      if (heartbeat !== undefined) current.heartbeatAt = heartbeat;
      database.records.set(key, current);

      const claimed = await store.claimLock(database, {
        key,
        ownerId: "nuevo-dueño",
        staleAfterMs: Number.POSITIVE_INFINITY
      });

      assert.equal(claimed, true);
      assert.equal(database.records.get(key).ownerId, "nuevo-dueño");
    });
  }
});

test("claimLock no reemplaza un heartbeat válido y reciente", async () => {
  const { store, database } = await openFakeStore();
  const key = "edit-lock";
  database.records.set(key, {
    key,
    ownerId: "dueño-anterior",
    heartbeatAt: new Date().toISOString()
  });

  const claimed = await store.claimLock(database, {
    key,
    ownerId: "nuevo-dueño",
    staleAfterMs: 60_000
  });

  assert.equal(claimed, false);
  assert.equal(database.records.get(key).ownerId, "dueño-anterior");
});

test("releaseLock no borra el lock si el propietario cambió", async () => {
  const { store, database } = await openFakeStore();
  const key = "edit-lock";
  const replacement = {
    key,
    ownerId: "dueño-nuevo",
    heartbeatAt: new Date().toISOString()
  };
  database.records.set(key, {
    key,
    ownerId: "dueño-original",
    heartbeatAt: new Date().toISOString()
  });
  database.beforeGet = ({ mode }) => {
    if (mode === "readwrite") database.records.set(key, replacement);
  };
  database.afterTransaction = ({ mode }) => {
    if (mode === "readonly") database.records.set(key, replacement);
  };

  const released = await store.releaseLock(database, {
    key,
    ownerId: "dueño-original"
  });

  assert.equal(released, false);
  assert.deepEqual(database.transactionModes, ["readwrite"]);
  assert.deepEqual(database.records.get(key), replacement);
});
