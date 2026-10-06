import assert from "node:assert/strict";
import test from "node:test";

import {
  createBeforeUnloadGuard,
  createSaveQueue
} from "../apps/web/src/persistence/save-queue.js";
import { SupabaseCloudConflictError } from "../apps/web/src/cloud.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function createTimers() {
  let nextId = 0;
  const callbacks = new Map();
  return {
    set(callback) {
      const id = ++nextId;
      callbacks.set(id, callback);
      return id;
    },
    clear(id) {
      callbacks.delete(id);
    },
    fireLatest() {
      const entry = [...callbacks.entries()].at(-1);
      assert.ok(entry, "expected a scheduled save timer");
      callbacks.delete(entry[0]);
      entry[1]();
    },
    get size() {
      return callbacks.size;
    }
  };
}

async function waitUntil(predicate) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail("condition did not become true");
}

function createHarness({ onFailure, markOfflineOnFailure = true } = {}) {
  const timers = createTimers();
  const writes = [];
  const target = new EventTarget();
  const exitGuard = createBeforeUnloadGuard(target);
  let snapshot = "initial";
  let storageAvailable = true;
  let indicator = "Guardado";
  let activeWrites = 0;
  let maxConcurrentWrites = 0;
  const queue = createSaveQueue({
    getSnapshot: () => snapshot,
    persist: (value) => {
      const gate = deferred();
      activeWrites += 1;
      maxConcurrentWrites = Math.max(maxConcurrentWrites, activeWrites);
      writes.push({ value, gate });
      return gate.promise.finally(() => { activeWrites -= 1; });
    },
    canSave: () => storageAvailable,
    onSaving: () => { indicator = "Guardando…"; },
    onSaved: (_state, generation, latestGeneration) => {
      if (generation === latestGeneration) indicator = "Guardado";
    },
    onError: async (error, state, generation) => {
      indicator = error instanceof SupabaseCloudConflictError
        ? "Se requiere recargar"
        : "Sin guardado local";
      if (markOfflineOnFailure) storageAvailable = false;
      await onFailure?.(error, state, generation);
    },
    onStateChange: ({ pending }) => exitGuard.update(pending),
    debounceMs: 250,
    setTimer: (callback, delay) => timers.set(callback, delay),
    clearTimer: (id) => timers.clear(id)
  });
  return {
    queue,
    timers,
    writes,
    target,
    exitGuard,
    get indicator() { return indicator; },
    get maxConcurrentWrites() { return maxConcurrentWrites; },
    set snapshot(value) { snapshot = value; },
    setStorageAvailable(value) { storageAvailable = value; }
  };
}

function dispatchBeforeUnload(target) {
  const event = new Event("beforeunload", { cancelable: true });
  Object.defineProperty(event, "returnValue", {
    configurable: true,
    writable: true,
    value: false
  });
  target.dispatchEvent(event);
  return event;
}

test("an earlier save cannot settle a later waiter or show Guardado", async () => {
  const harness = createHarness();
  harness.snapshot = "A";
  let aSettled = false;
  const a = harness.queue.scheduleSave().then(() => { aSettled = true; });
  harness.timers.fireLatest();
  await waitUntil(() => harness.writes.length === 1);

  harness.snapshot = "B";
  let bSettled = false;
  const b = harness.queue.scheduleSave().then(() => { bSettled = true; });
  harness.timers.fireLatest();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(harness.writes.length, 1, "B stays serialized behind pending A");
  assert.equal(harness.queue.getState().timerPending, false, "B debounce elapsed");
  assert.equal(aSettled, false);
  assert.equal(bSettled, false);
  assert.equal(harness.indicator, "Guardando…");
  assert.equal(harness.exitGuard.isActive(), true);

  harness.writes[0].gate.resolve();
  await waitUntil(() => harness.writes.length === 2);
  await a;

  assert.equal(harness.writes[0].value, "A");
  assert.equal(harness.writes[1].value, "B");
  assert.equal(aSettled, true);
  assert.equal(bSettled, false, "A completion leaves B's waiter pending");
  assert.equal(harness.indicator, "Guardando…", "A cannot display Guardado for B");
  assert.equal(harness.queue.getState().persistedGeneration, 1);
  assert.equal(harness.queue.hasPendingChanges(), true);
  assert.equal(harness.exitGuard.isActive(), true);

  harness.writes[1].gate.resolve();
  await b;
  await waitUntil(() => harness.indicator === "Guardado");
  assert.equal(harness.queue.getState().persistedGeneration, 2);
  assert.equal(harness.queue.hasPendingChanges(), false);
  assert.equal(harness.exitGuard.isActive(), false);
  assert.equal(harness.maxConcurrentWrites, 1);
});

test("an immediate backup save waits for its snapshot and flushSave forces the debounce", async () => {
  const harness = createHarness();
  harness.snapshot = "backup snapshot";
  let backupReady = false;
  const backup = (async () => {
    await harness.queue.scheduleSave({ immediate: true });
    backupReady = true;
  })();
  harness.timers.fireLatest();
  await waitUntil(() => harness.writes.length === 1);
  assert.equal(backupReady, false);
  harness.writes[0].gate.resolve();
  await backup;
  assert.equal(backupReady, true);

  harness.snapshot = "flushed snapshot";
  const save = harness.queue.scheduleSave();
  const flushed = harness.queue.flushSave();
  assert.equal(harness.timers.size, 0);
  await waitUntil(() => harness.writes.length === 2);
  assert.equal(harness.writes[1].value, "flushed snapshot");
  harness.writes[1].gate.resolve();
  await Promise.all([save, flushed]);
});

test("a failed latest save rejects its waiter and keeps exit protection without retrying", async () => {
  const harness = createHarness();
  harness.snapshot = "failed snapshot";
  const save = harness.queue.scheduleSave({ immediate: true });
  harness.timers.fireLatest();
  await waitUntil(() => harness.writes.length === 1);

  harness.writes[0].gate.reject(new Error("local quota exceeded"));
  await assert.rejects(save, /local quota exceeded/);
  await waitUntil(() => harness.indicator === "Sin guardado local");

  assert.equal(harness.queue.hasPendingChanges(), true);
  assert.equal(harness.exitGuard.isActive(), true);
  assert.equal(harness.indicator, "Sin guardado local");
  await assert.rejects(harness.queue.flushSave(), /local quota exceeded/);
  await assert.rejects(harness.queue.scheduleSave({ immediate: true }), /local quota exceeded/);
  assert.equal(harness.writes.length, 1, "failure does not schedule a retry");
});

test("B failure after A completes never marks B as saved", async () => {
  const harness = createHarness();
  harness.snapshot = "A";
  const a = harness.queue.scheduleSave();
  harness.timers.fireLatest();
  await waitUntil(() => harness.writes.length === 1);

  harness.snapshot = "B";
  const b = harness.queue.scheduleSave();
  harness.timers.fireLatest();
  harness.writes[0].gate.resolve();
  await waitUntil(() => harness.writes.length === 2);
  await a;

  assert.equal(harness.indicator, "Guardando…");
  harness.writes[1].gate.reject(new Error("B failed"));
  await assert.rejects(b, /B failed/);
  await waitUntil(() => harness.indicator === "Sin guardado local");

  assert.equal(harness.indicator, "Sin guardado local");
  assert.equal(harness.queue.getState().persistedGeneration, 1);
  assert.equal(harness.queue.hasPendingChanges(), true);
  assert.equal(harness.exitGuard.isActive(), true);
  assert.equal(harness.writes.length, 2);
});

test("a failed earlier save cancels already queued snapshots without retrying", async () => {
  const harness = createHarness({ markOfflineOnFailure: false });
  harness.snapshot = "A";
  const a = harness.queue.scheduleSave();
  harness.timers.fireLatest();
  await waitUntil(() => harness.writes.length === 1);

  harness.snapshot = "B";
  const b = harness.queue.scheduleSave();
  harness.timers.fireLatest();
  assert.equal(harness.queue.getState().timerPending, false);
  assert.equal(harness.writes.length, 1, "B is queued behind A");

  harness.writes[0].gate.reject(new Error("CAS write failed"));
  await assert.rejects(a, /CAS write failed/);
  await assert.rejects(b, /CAS write failed/);
  await waitUntil(() => harness.indicator === "Sin guardado local");

  assert.equal(harness.writes.length, 1, "queued B is not retried after A fails");
  assert.equal(harness.queue.hasPendingChanges(), true);
  assert.equal(harness.exitGuard.isActive(), true);
  assert.equal(harness.indicator, "Sin guardado local");
});

test("a CAS conflict rejects only the attempted generation and keeps the page guarded", async () => {
  const conflict = new SupabaseCloudConflictError();
  const harness = createHarness({ markOfflineOnFailure: false });
  harness.snapshot = "conflicting snapshot";
  const save = harness.queue.scheduleSave({ immediate: true });
  harness.timers.fireLatest();
  await waitUntil(() => harness.writes.length === 1);

  harness.writes[0].gate.reject(conflict);
  await assert.rejects(save, SupabaseCloudConflictError);
  await waitUntil(() => harness.indicator === "Se requiere recargar");

  assert.equal(harness.queue.hasPendingChanges(), true);
  assert.equal(harness.exitGuard.isActive(), true);
  assert.equal(harness.indicator, "Se requiere recargar");
  assert.equal(harness.writes.length, 1, "CAS conflict does not trigger an automatic retry");
});

test("beforeunload protection is installed only while a save is unconfirmed", () => {
  const target = new EventTarget();
  const guard = createBeforeUnloadGuard(target);

  let event = dispatchBeforeUnload(target);
  assert.equal(event.defaultPrevented, false);

  guard.update(true);
  event = dispatchBeforeUnload(target);
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.returnValue, true);
  assert.equal(guard.isActive(), true);

  guard.update(false);
  event = dispatchBeforeUnload(target);
  assert.equal(event.defaultPrevented, false);
  assert.equal(guard.isActive(), false);
});
