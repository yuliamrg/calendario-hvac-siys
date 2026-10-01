export function createImportCommands({
  getDocument,
  setDocument,
  cloneDocument = structuredClone,
  adapter
}) {
  if (typeof getDocument !== "function") {
    throw new TypeError("createImportCommands requiere getDocument.");
  }
  if (typeof setDocument !== "function") {
    throw new TypeError("createImportCommands requiere setDocument.");
  }
  if (typeof cloneDocument !== "function") {
    throw new TypeError("createImportCommands requiere cloneDocument.");
  }
  if (typeof adapter !== "function") {
    throw new TypeError("createImportCommands requiere adapter.");
  }

  function normalizeOutcome(adapterResult) {
    if (adapterResult === undefined || adapterResult === null) {
      return { document: null, result: {} };
    }
    if (typeof adapterResult === "object" && !Array.isArray(adapterResult)) {
      if ("document" in adapterResult) {
        const { document: nextDocument, ...rest } = adapterResult;
        return { document: nextDocument, result: rest };
      }
      return { document: adapterResult, result: {} };
    }
    throw new TypeError("El adapter debe devolver un documento o un objeto con propiedad document.");
  }

  function dispatch(payload = {}, options = {}) {
    const before = cloneDocument(getDocument());
    try {
      const workingDocument = cloneDocument(before);
      const adapterResult = adapter(workingDocument, payload, options);
      const { document: normalizedDocument, result } = normalizeOutcome(adapterResult);
      if (normalizedDocument === null || normalizedDocument === undefined) {
        throw new TypeError("El adapter no produjo un documento válido.");
      }
      const nextDocument = cloneDocument(normalizedDocument);
      setDocument(nextDocument);
      return { changed: true, document: nextDocument, result };
    } catch (error) {
      setDocument(before);
      throw error;
    }
  }

  return Object.freeze({
    dispatch,
    run: dispatch
  });
}
