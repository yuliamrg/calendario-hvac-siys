export function createCalendarCommands({
  getDocument,
  setDocument,
  executeOperation,
  cloneDocument = structuredClone
}) {
  if (typeof getDocument !== "function") {
    throw new TypeError("createCalendarCommands requiere getDocument.");
  }
  if (typeof setDocument !== "function") {
    throw new TypeError("createCalendarCommands requiere setDocument.");
  }
  if (typeof executeOperation !== "function") {
    throw new TypeError("createCalendarCommands requiere executeOperation.");
  }

  function dispatch(operation, payload = {}, options = {}) {
    const before = cloneDocument(getDocument());
    try {
      const outcome = executeOperation(getDocument(), { operation, payload }, options);
      if (outcome && outcome.changed) setDocument(outcome.document);
      return outcome;
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
