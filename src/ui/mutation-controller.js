import { createCalendarCommands } from "../application/calendar-commands.js";
import { createImportCommands } from "../application/import-commands.js";

export function createMutationController({
  getDocument,
  setDocument,
  canEdit,
  cloneDocument = structuredClone,
  executeOperation,
  appendAudit,
  appVersion,
  schemaVersion,
  holidayRuleSetVersion,
  render,
  scheduleSave,
  notify,
  afterUndo,
  importAdapter
}) {
  const commands = createCalendarCommands({
    getDocument,
    setDocument,
    executeOperation,
    cloneDocument
  });
  const importCommands = createImportCommands({
    getDocument,
    setDocument,
    cloneDocument,
    adapter: importAdapter
  });
  let undoSnapshot = null;

  function assertEditable() {
    if (!canEdit()) throw new TypeError("Esta pestaña está en modo de solo lectura.");
  }

  function finishChange(detail, toast, undo) {
    render();
    scheduleSave();
    if (toast) notify(toast, { undo });
    return detail;
  }

  function mutate(action, detail, callback, { undo = true, toast = detail } = {}) {
    assertEditable();
    const before = cloneDocument(getDocument());
    try {
      callback();
      const document = getDocument();
      document.appVersion = appVersion;
      document.schemaVersion = schemaVersion;
      document.calendarMeta.revision += 1;
      document.calendarMeta.updatedAt = new Date().toISOString();
      document.settings.holidayRuleSetVersion = holidayRuleSetVersion;
      appendAudit(action, detail);
    } catch (error) {
      setDocument(before);
      throw error;
    }
    if (undo) undoSnapshot = { document: before, label: detail };
    finishChange(detail, toast, undo);
  }

  function mutateWithContract(operation, payload, detail, { undo = true, toast = detail } = {}) {
    assertEditable();
    const before = cloneDocument(getDocument());
    const outcome = commands.dispatch(operation, payload);
    if (!outcome.changed) return outcome;
    if (undo) undoSnapshot = { document: before, label: detail };
    finishChange(detail, toast, undo);
    return outcome;
  }

  function mutateWithImport(
    kind,
    payload = {},
    detail,
    { undo = true, toast = detail, auditAction = `import.${kind}`, ...adapterOptions } = {}
  ) {
    assertEditable();
    const before = cloneDocument(getDocument());
    try {
      const enrichedPayload = { ...payload, kind };
      const outcome = importCommands.dispatch(enrichedPayload, adapterOptions);
      if (!outcome.changed) {
        setDocument(before);
        return outcome;
      }
      const document = getDocument();
      document.appVersion = appVersion;
      document.schemaVersion = schemaVersion;
      document.calendarMeta.revision += 1;
      document.calendarMeta.updatedAt = new Date().toISOString();
      document.settings.holidayRuleSetVersion = holidayRuleSetVersion;
      appendAudit(auditAction, detail);
      if (undo) undoSnapshot = { document: before, label: detail };
      finishChange(detail, toast, undo);
      return { ...outcome, document };
    } catch (error) {
      setDocument(before);
      throw error;
    }
  }

  function undo() {
    if (!undoSnapshot) return;
    const previous = undoSnapshot;
    undoSnapshot = null;
    setDocument(previous.document);
    afterUndo();
    render();
    scheduleSave();
    notify(`Se deshizo: ${previous.label}`);
  }

  return Object.freeze({
    mutate,
    mutateWithContract,
    mutateWithImport,
    undo,
    clearUndo: () => { undoSnapshot = null; },
    hasUndo: () => undoSnapshot !== null
  });
}
