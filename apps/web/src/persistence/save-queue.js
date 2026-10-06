export function createBeforeUnloadGuard(eventTarget = globalThis.window) {
  let active = false;

  const handleBeforeUnload = (event) => {
    if (!active) return;
    event.preventDefault();
    event.returnValue = true;
  };

  return Object.freeze({
    update(shouldWarn) {
      const next = Boolean(shouldWarn);
      if (next === active) return;
      active = next;
      if (active) eventTarget.addEventListener("beforeunload", handleBeforeUnload);
      else eventTarget.removeEventListener("beforeunload", handleBeforeUnload);
    },
    isActive() {
      return active;
    },
    dispose() {
      if (!active) return;
      active = false;
      eventTarget.removeEventListener("beforeunload", handleBeforeUnload);
    }
  });
}

export function createSaveQueue({
  getSnapshot,
  persist,
  canSave = () => true,
  debounceMs = 250,
  onSaving = () => {},
  onSaved = () => {},
  onError = () => {},
  onStateChange = () => {},
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout
}) {
  if (typeof getSnapshot !== "function" || typeof persist !== "function") {
    throw new TypeError("getSnapshot y persist deben ser funciones.");
  }

  let timer = null;
  let saveChain = Promise.resolve();
  let requestedGeneration = 0;
  let persistedGeneration = 0;
  let lastFailure = null;
  let waiters = [];

  function getState() {
    return Object.freeze({
      requestedGeneration,
      persistedGeneration,
      pending: requestedGeneration > persistedGeneration,
      timerPending: timer !== null
    });
  }

  function notifyState() {
    onStateChange(getState());
  }

  function settleThrough(generation, error = null) {
    const remaining = [];
    for (const waiter of waiters) {
      if (waiter.generation <= generation) {
        if (error) waiter.reject(error);
        else waiter.resolve();
      } else {
        remaining.push(waiter);
      }
    }
    waiters = remaining;
  }

  function waitForGeneration(generation) {
    if (generation <= persistedGeneration) return Promise.resolve();
    if (
      lastFailure &&
      generation > persistedGeneration &&
      generation <= lastFailure.generation
    ) {
      return Promise.reject(lastFailure.error);
    }
    return new Promise((resolve, reject) => {
      waiters.push({ generation, resolve, reject });
    });
  }

  async function reportError(error, generation) {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    const failedThroughGeneration = requestedGeneration;
    lastFailure = { generation: failedThroughGeneration, error };
    settleThrough(failedThroughGeneration, error);
    try {
      await onError(error, getState(), generation);
    } catch {
      // Persistence failure remains the outcome if error reporting also fails.
    }
    notifyState();
  }

  function enqueueSnapshot(snapshot, generation) {
    saveChain = saveChain.then(async () => {
      if (lastFailure && generation <= lastFailure.generation) return;
      try {
        await persist(snapshot);
      } catch (error) {
        await reportError(error, generation);
        return;
      }

      persistedGeneration = Math.max(persistedGeneration, generation);
      if (lastFailure && lastFailure.generation <= persistedGeneration) lastFailure = null;
      settleThrough(generation);
      try {
        await onSaved(getState(), generation, requestedGeneration);
      } catch {
        // UI reporting must not turn a confirmed persistence into a failed save.
      }
      notifyState();
    });
  }

  function captureAndEnqueue(generation) {
    try {
      enqueueSnapshot(getSnapshot(), generation);
    } catch (error) {
      void reportError(error, generation);
    }
    notifyState();
  }

  function scheduleSave({ immediate = false } = {}) {
    if (!canSave()) {
      return immediate
        ? Promise.reject(lastFailure?.error ?? new Error("No se pudo confirmar este guardado."))
        : Promise.resolve();
    }

    requestedGeneration += 1;
    const generation = requestedGeneration;
    const completion = new Promise((resolve, reject) => {
      waiters.push({ generation, resolve, reject });
    });

    if (timer !== null) clearTimer(timer);
    timer = setTimer(() => {
      timer = null;
      captureAndEnqueue(requestedGeneration);
    }, immediate ? 0 : debounceMs);

    try {
      onSaving(getState(), generation);
    } catch {
      // A status display failure must not prevent persistence from starting.
    }
    notifyState();

    return completion;
  }

  function flushSave() {
    const generation = requestedGeneration;
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
      captureAndEnqueue(generation);
    }
    return waitForGeneration(generation);
  }

  return Object.freeze({
    scheduleSave,
    flushSave,
    hasPendingChanges: () => requestedGeneration > persistedGeneration,
    getState
  });
}
