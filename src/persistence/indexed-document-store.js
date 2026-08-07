export function createIndexedDocumentStore({
  databaseName,
  databaseVersion,
  storeName,
  browserWindow = globalThis.window
}) {
  function open() {
    return new Promise((resolve, reject) => {
      if (!browserWindow || !("indexedDB" in browserWindow)) {
        reject(new Error("IndexedDB no está disponible en este navegador."));
        return;
      }
      const request = browserWindow.indexedDB.open(databaseName, databaseVersion);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(storeName)) {
          database.createObjectStore(storeName, { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("No fue posible abrir IndexedDB."));
      request.onblocked = () => reject(new Error("La base local está bloqueada por otra pestaña."));
    });
  }

  function readRecord(database, key) {
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, "readonly");
      const request = transaction.objectStore(storeName).get(key);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  }

  async function readDocument(database, key) {
    return (await readRecord(database, key))?.document ?? null;
  }

  function writeWithRecovery(database, documentSnapshot) {
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      const currentRequest = store.get("current");
      currentRequest.onsuccess = () => {
        if (currentRequest.result?.document) {
          store.put({
            key: "recovery",
            savedAt: new Date().toISOString(),
            document: currentRequest.result.document
          });
        }
        store.put({
          key: "current",
          savedAt: new Date().toISOString(),
          document: documentSnapshot
        });
      };
      currentRequest.onerror = () => reject(currentRequest.error);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error("La escritura local fue cancelada."));
    });
  }

  function replaceCurrent(database, documentSnapshot) {
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, "readwrite");
      transaction.objectStore(storeName).put({
        key: "current",
        savedAt: new Date().toISOString(),
        document: documentSnapshot
      });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error("No se pudo restaurar la copia recuperable."));
    });
  }

  function clearDocuments(database) {
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      store.delete("current");
      store.delete("recovery");
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error("No se pudieron reiniciar los datos."));
    });
  }

  function claimLock(database, { key, ownerId, staleAfterMs, force = false }) {
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      const request = store.get(key);
      let claimed = false;
      request.onsuccess = () => {
        const current = request.result;
        const age = current?.heartbeatAt
          ? Date.now() - new Date(current.heartbeatAt).getTime()
          : Infinity;
        if (force || !current || current.ownerId === ownerId || age > staleAfterMs) {
          store.put({ key, ownerId, heartbeatAt: new Date().toISOString() });
          claimed = true;
        }
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve(claimed);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error("No se pudo reservar la edición."));
    });
  }

  async function releaseLock(database, { key, ownerId }) {
    const current = await readRecord(database, key);
    if (current?.ownerId !== ownerId) return false;
    await new Promise((resolve) => {
      const transaction = database.transaction(storeName, "readwrite");
      transaction.objectStore(storeName).delete(key);
      transaction.oncomplete = resolve;
      transaction.onerror = resolve;
      transaction.onabort = resolve;
    });
    return true;
  }

  return Object.freeze({
    open,
    readDocument,
    readRecord,
    writeWithRecovery,
    replaceCurrent,
    clearDocuments,
    claimLock,
    releaseLock
  });
}
