import {
  ACTIVITY_STATUSES,
  APP_VERSION,
  BULK_EDIT_FIELDS,
  HOLIDAY_RULESET_VERSION,
  PLANNING_BUCKETS,
  RESPONSIBLE_TYPES,
  SERVICE_TYPES,
  STATUS_SCOPES,
  SCHEMA_VERSION,
  activityMatchesFilters,
  activityIdsForScope,
  addDaysISO,
  assignQuarantineDate,
  applyBulkEdit,
  applyStatus,
  buildMonthlyCsv,
  buildQuarantineCsv,
  colombianHolidays,
  compareISODate,
  createBackupEnvelope,
  createDefaultDocument,
  createQuarantineActivity,
  dayOfWeek,
  generateSeriesDates,
  holidayMapForRange,
  holidayMapForYears,
  importDiff,
  isNonWorkingDate,
  isQuarantineActivity,
  makeId,
  mergeBackupDocument,
  monthGridDates,
  moveActivities,
  moveActivityToQuarantine,
  normalizeKey,
  normalizeFilterArray,
  normalizeText,
  parseISODate,
  parseBackup,
  safeText,
  sanitizeDocument,
  todayInBogota,
  toISODate,
  validateActivity,
  validateHolidayOverride,
  validatePlanningDate
} from "./core.js";
import { executeCalendarOperation } from "./calendar-contract.js";
import {
  PROGRAMMING_COLUMNS,
  applyProgrammingImport,
  applyParsedImport,
  buildImportPreview,
  parseBaseWorkbook,
  parseProgrammingWorkbook
} from "./importer.js";
import {
  createSupabasePersistence,
  isSupabaseConfigEnabled,
  SupabaseCloudConflictError
} from "./cloud.js";

const RUNTIME_CHANNEL = location.pathname.includes("/beta/")
  ? "beta"
  : location.protocol === "file:"
    ? "local"
    : "stable";
const DATABASE_NAME = RUNTIME_CHANNEL === "beta"
  ? "calendario-hvac-siys-beta"
  : "calendario-hvac-siys";
const DATABASE_VERSION = 1;
const DOCUMENT_STORE = "documents";
const SUPABASE_CONFIG = globalThis.__SIYS_SUPABASE_CONFIG__ ?? {
  enabled: false,
  url: "",
  publishableKey: ""
};
// Supabase is deliberately beta-only. The stable channel remains the original
// local/IndexedDB release even if the Pages job exposes cloud variables while
// verifying a future stable tag.
const CLOUD_MODE = RUNTIME_CHANNEL === "beta" && isSupabaseConfigEnabled(SUPABASE_CONFIG);
const CLOUD_CALENDAR_KEY = RUNTIME_CHANNEL === "beta"
  ? "calendario-hvac-siys-beta"
  : "calendario-hvac-siys";
const MAX_VISIBLE_CARDS = 3;
const DAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const SERVICE_SHORT = {
  preventive: "Preventivo",
  corrective: "Correctivo",
  emergency: "Emergencia",
  diagnostic: "Diagnóstico",
  warranty: "Garantía",
  administrative: "Administrativo"
};
const STATUS_ICONS = {
  scheduled: "○",
  confirmed: "●",
  in_progress: "▶",
  completed: "✓",
  not_executed: "!",
  cancelled: "×",
  to_schedule: "○"
};

const dom = Object.fromEntries(
  [...document.querySelectorAll("[id]")].map((element) => [element.id, element])
);

let appDocument = createDefaultDocument();
let database = null;
let saveTimer = null;
let saveChain = Promise.resolve();
let saveWaiters = [];
let selectedActivityIds = new Set();
let catalogTab = "sites";
let activeDrawer = null;
let drawerReturnFocus = null;
let calendarFocusDate = null;
let pendingImport = null;
let pendingRestore = null;
let pendingMerge = null;
let pendingProgrammingImport = null;
let dragContext = null;
let pendingDrop = null;
let pendingTouchActivityId = null;
let pendingQuarantineActivityId = null;
let pendingQuarantineAssignId = null;
let mobileAgendaDate = null;
let undoSnapshot = null;
let forcedRangeDates = new Set();
let responsibleRenderTimer = null;
let storageAvailable = true;
let hasEditControl = false;
let editLockTimer = null;
let cloudPersistence = null;
let cloudAuthMode = "sign-in";
let cloudAuthWaiter = null;
const tabId = crypto.randomUUID();
const EDIT_LOCK_KEY = "edit-lock";
const EDIT_LOCK_HEARTBEAT_MS = 5000;
const EDIT_LOCK_STALE_MS = 15000;
const UI_PREFERENCES_KEY = `siys-sync-ui:${RUNTIME_CHANNEL}`;
const systemThemeQuery = window.matchMedia?.("(prefers-color-scheme: dark)") ?? null;
const compactLayoutQuery = window.matchMedia?.("(max-width: 899px)") ?? null;
const editChannel = "BroadcastChannel" in window
  ? new BroadcastChannel(`calendario-hvac-siys-edit-lock-${RUNTIME_CHANNEL}`)
  : null;

function clone(value) {
  return structuredClone(value);
}

function readUiPreferences() {
  try {
    const parsed = JSON.parse(localStorage.getItem(UI_PREFERENCES_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function updateUiPreferences(patch) {
  const next = { ...readUiPreferences(), ...patch };
  localStorage.setItem(UI_PREFERENCES_KEY, JSON.stringify(next));
  return next;
}

function applyCatalogPreference() {
  if (compactLayoutQuery?.matches) {
    const open = document.body.classList.contains("catalog-mobile-open");
    dom.toggleCatalogButton.setAttribute("aria-expanded", String(open));
    dom.toggleCatalogButton.title = open ? "Cerrar banco de tarjetas" : "Abrir banco de tarjetas";
    dom.toggleCatalogButton.querySelector(".visually-hidden").textContent = dom.toggleCatalogButton.title;
    return;
  }
  const collapsed = readUiPreferences().catalogCollapsed === true;
  document.body.classList.remove("catalog-mobile-open");
  document.body.classList.toggle("catalog-collapsed", collapsed);
  dom.toggleCatalogButton.setAttribute("aria-expanded", String(!collapsed));
  dom.toggleCatalogButton.title = collapsed ? "Mostrar banco de tarjetas" : "Ocultar banco de tarjetas";
  dom.toggleCatalogButton.querySelector(".visually-hidden").textContent = dom.toggleCatalogButton.title;
}

function toggleCatalog() {
  if (compactLayoutQuery?.matches) {
    document.body.classList.toggle("catalog-mobile-open");
    applyCatalogPreference();
    return;
  }
  const collapsed = !document.body.classList.contains("catalog-collapsed");
  updateUiPreferences({ catalogCollapsed: collapsed });
  applyCatalogPreference();
}

function themePreference() {
  const value = readUiPreferences().theme;
  return ["light", "dark", "system"].includes(value) ? value : "system";
}

function applyThemePreference() {
  const preference = themePreference();
  const resolved = preference === "system"
    ? systemThemeQuery?.matches ? "dark" : "light"
    : preference;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  const labels = { light: "Claro", dark: "Oscuro", system: "Sistema" };
  if (dom.themeButton) {
    const label = dom.themeButton.querySelector("strong");
    if (label) label.textContent = `Tema: ${labels[preference]}`;
    else dom.themeButton.textContent = `Tema: ${labels[preference]}`;
    const order = ["system", "light", "dark"];
    const next = order[(order.indexOf(preference) + 1) % order.length];
    dom.themeButton.title = `Tema: ${labels[preference]}. Cambiar a ${labels[next]}`;
    dom.themeButton.setAttribute("aria-label", dom.themeButton.title);
  }
}

function cycleThemePreference() {
  const order = ["system", "light", "dark"];
  const current = themePreference();
  const next = order[(order.indexOf(current) + 1) % order.length];
  updateUiPreferences({ theme: next });
  applyThemePreference();
  const labels = { light: "claro", dark: "oscuro", system: "del sistema" };
  showToast(`Tema ${labels[next]} aplicado.`);
}

function openThemeDialog() {
  const radio = dom.themeForm.querySelector(`input[name="themeMode"][value="${themePreference()}"]`);
  if (radio) radio.checked = true;
  openDialog("themeDialog");
}

function handleThemeSubmit(event) {
  event.preventDefault();
  const selected = dom.themeForm.querySelector('input[name="themeMode"]:checked')?.value ?? "system";
  updateUiPreferences({ theme: selected });
  applyThemePreference();
  closeDialog("themeDialog");
  showToast(`Tema ${selected === "system" ? "del sistema" : selected === "dark" ? "oscuro" : "claro"} aplicado.`);
}

function createElement(tagName, className = "", text = "") {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== "") element.textContent = text;
  return element;
}

function setChildren(parent, ...children) {
  parent.replaceChildren(...children.filter(Boolean));
  return parent;
}

function option(value, label) {
  const element = document.createElement("option");
  element.value = value;
  element.textContent = label;
  return element;
}

function formatDisplayDate(value, options = {}) {
  const date = parseISODate(value);
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: "UTC",
    day: options.day ?? "numeric",
    month: options.month ?? "long",
    year: options.year ?? "numeric",
    weekday: options.weekday
  }).format(date);
}

function formatMonthTitle(year, month) {
  const label = new Intl.DateTimeFormat("es-CO", {
    timeZone: "UTC",
    month: "long",
    year: "numeric"
  }).format(new Date(Date.UTC(year, month - 1, 1)));
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

function timestampLabel(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return safeText(value, 80);
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function currentMonthParts() {
  const [year, month] = appDocument.settings.currentDate.split("-").map(Number);
  return { year, month };
}

function lookupMaps() {
  return {
    clients: new Map(appDocument.catalog.clients.map((item) => [item.id, item])),
    sites: new Map(appDocument.catalog.sites.map((item) => [item.id, item])),
    responsibles: new Map(appDocument.catalog.responsibles.map((item) => [item.id, item]))
  };
}

function displayInitialsFor(name) {
  return safeText(name, 160)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function setSaveIndicator(state, text) {
  dom.saveIndicator.classList.toggle("saving", state === "saving");
  dom.saveIndicator.classList.toggle("error", state === "error");
  dom.saveIndicatorText.textContent = text;
}

function setCloudAuthMode(mode) {
  cloudAuthMode = mode === "sign-up" ? "sign-up" : "sign-in";
  const signUp = cloudAuthMode === "sign-up";
  dom.cloudAuthDialogTitle.textContent = signUp ? "Crear acceso a SIYS Sync" : "Conectar con SIYS Sync";
  dom.cloudAuthIntro.textContent = signUp
    ? "Crea una cuenta para que el cronograma pueda abrirse desde más de un equipo."
    : "Inicia sesión para acceder al cronograma guardado en Supabase.";
  dom.cloudAuthSubmitButton.textContent = signUp ? "Crear cuenta" : "Iniciar sesión";
  dom.cloudAuthModeButton.textContent = signUp ? "Ya tengo una cuenta" : "Crear una cuenta";
  dom.cloudAuthDisplayNameField.hidden = !signUp;
  dom.cloudAuthPassword.autocomplete = signUp ? "new-password" : "current-password";
}

function openCloudAuthDialog(message = "") {
  if (!dom.cloudAuthDialog) return;
  setCloudAuthMode(cloudAuthMode);
  showFormErrors(dom.cloudAuthErrors, message ? [message] : []);
  dom.cloudAuthDialog.hidden = false;
  if (!dom.cloudAuthDialog.open) dom.cloudAuthDialog.showModal();
  window.setTimeout(() => dom.cloudAuthEmail.focus(), 0);
}

function waitForCloudAuthentication() {
  openCloudAuthDialog();
  return new Promise((resolve, reject) => {
    cloudAuthWaiter = { resolve, reject };
  });
}

async function handleCloudAuthSubmit(event) {
  event.preventDefault();
  if (!cloudPersistence) return;
  const email = dom.cloudAuthEmail.value.trim();
  const password = dom.cloudAuthPassword.value;
  const displayName = dom.cloudAuthDisplayName.value.trim();
  if (!email || !password || (cloudAuthMode === "sign-up" && password.length < 6)) {
    showFormErrors(dom.cloudAuthErrors, ["Escribe un correo y una contraseña de al menos 6 caracteres."]);
    return;
  }
  dom.cloudAuthSubmitButton.disabled = true;
  showFormErrors(dom.cloudAuthErrors, []);
  try {
    const result = cloudAuthMode === "sign-up"
      ? await cloudPersistence.signUp(email, password, displayName)
      : { session: await cloudPersistence.signIn(email, password) };
    if (!result.session) {
      setCloudAuthMode("sign-in");
      showFormErrors(dom.cloudAuthErrors, [
        "La cuenta se creó. Revisa el correo de confirmación y luego inicia sesión."
      ]);
      return;
    }
    const waiter = cloudAuthWaiter;
    cloudAuthWaiter = null;
    dom.cloudAuthDialog.close();
    waiter?.resolve(result.session);
  } catch (error) {
    showFormErrors(dom.cloudAuthErrors, [error.message]);
  } finally {
    dom.cloudAuthSubmitButton.disabled = false;
  }
}

async function handleCloudSignOut() {
  if (!cloudPersistence || !window.confirm("¿Cerrar sesión de Supabase en este equipo?")) return;
  await cloudPersistence.signOut();
  window.location.reload();
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB no está disponible en este navegador."));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DOCUMENT_STORE)) {
        db.createObjectStore(DOCUMENT_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("No fue posible abrir IndexedDB."));
    request.onblocked = () => reject(new Error("La base local está bloqueada por otra pestaña."));
  });
}

function readStoredDocument(key) {
  if (CLOUD_MODE) {
    if (key !== "current") return Promise.resolve(null);
    return cloudPersistence.read().then((record) => record?.document ?? null);
  }
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(DOCUMENT_STORE, "readonly");
    const request = transaction.objectStore(DOCUMENT_STORE).get(key);
    request.onsuccess = () => resolve(request.result?.document ?? null);
    request.onerror = () => reject(request.error);
  });
}

function readStoredRecord(key) {
  if (CLOUD_MODE) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(DOCUMENT_STORE, "readonly");
    const request = transaction.objectStore(DOCUMENT_STORE).get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

function claimEditLock({ force = false } = {}) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(DOCUMENT_STORE, "readwrite");
    const store = transaction.objectStore(DOCUMENT_STORE);
    const request = store.get(EDIT_LOCK_KEY);
    let claimed = false;
    request.onsuccess = () => {
      const current = request.result;
      const age = current?.heartbeatAt ? Date.now() - new Date(current.heartbeatAt).getTime() : Infinity;
      if (force || !current || current.ownerId === tabId || age > EDIT_LOCK_STALE_MS) {
        store.put({
          key: EDIT_LOCK_KEY,
          ownerId: tabId,
          heartbeatAt: new Date().toISOString()
        });
        claimed = true;
      }
    };
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => resolve(claimed);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("No se pudo reservar la edición."));
  });
}

async function releaseEditLock() {
  if (!database || !hasEditControl) return;
  const current = await readStoredRecord(EDIT_LOCK_KEY);
  if (current?.ownerId !== tabId) return;
  await new Promise((resolve) => {
    const transaction = database.transaction(DOCUMENT_STORE, "readwrite");
    transaction.objectStore(DOCUMENT_STORE).delete(EDIT_LOCK_KEY);
    transaction.oncomplete = resolve;
    transaction.onerror = resolve;
    transaction.onabort = resolve;
  });
}

function renderAccessMode() {
  document.body.classList.toggle("read-only", !hasEditControl);
  dom.accessBanner.hidden = hasEditControl || (!storageAvailable && !CLOUD_MODE);
  dom.takeControlButton.hidden = CLOUD_MODE || hasEditControl || !storageAvailable;
  const guardedIds = [
    "newActivityButton", "importBaseButton", "newCatalogButton", "holidayButton",
    "bulkMoveButton", "bulkStatusButton", "bulkEditButton", "bulkDeleteButton",
    "calendarSettingsButton", "importProgrammingButton", "resetDataButton", "mergeJsonButton",
    "newQuarantineButton"
  ];
  for (const id of guardedIds) {
    if (dom[id]) dom[id].disabled = !hasEditControl;
  }
}

function setEditControl(value, message = "") {
  hasEditControl = Boolean(value);
  if (!hasEditControl) {
    selectedActivityIds.clear();
    dom.accessBannerText.textContent = message || "Otra pestaña está editando este cronograma.";
  }
  renderAccessMode();
  renderSelectionBar();
}

async function heartbeatEditLock() {
  if (!database || !storageAvailable) return;
  if (hasEditControl) {
    const claimed = await claimEditLock();
    if (!claimed) setEditControl(false, "Otra pestaña tomó el control de edición.");
    return;
  }
  const current = await readStoredRecord(EDIT_LOCK_KEY);
  const age = current?.heartbeatAt ? Date.now() - new Date(current.heartbeatAt).getTime() : Infinity;
  if (!current || age > EDIT_LOCK_STALE_MS) {
    const claimed = await claimEditLock();
    if (claimed) {
      setEditControl(true);
      showToast("Esta pestaña recuperó el control de edición.");
    }
  }
}

async function initializeEditLock() {
  if (CLOUD_MODE || !database || !storageAvailable) return;
  setEditControl(await claimEditLock());
  editLockTimer = window.setInterval(() => {
    heartbeatEditLock().catch(() => {});
  }, EDIT_LOCK_HEARTBEAT_MS);
  editChannel?.addEventListener("message", (event) => {
    if (event.data?.type === "control-taken" && event.data.ownerId !== tabId) {
      setEditControl(false, "Otra pestaña tomó el control de edición.");
    }
    if (event.data?.type === "data-reset" && event.data.ownerId !== tabId) {
      readStoredDocument("current")
        .then((stored) => {
          appDocument = stored ? sanitizeDocument(stored) : createDefaultDocument();
          selectedActivityIds.clear();
          activeDrawer = null;
          closeDrawer();
          renderAll();
          showToast("Los datos fueron reiniciados desde otra pestaña.", { duration: 8000 });
        })
        .catch(() => {});
    }
  });
}

function writeStoredDocument(documentSnapshot) {
  if (CLOUD_MODE) return cloudPersistence.write(documentSnapshot);
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(DOCUMENT_STORE, "readwrite");
    const store = transaction.objectStore(DOCUMENT_STORE);
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

function replaceCurrentDocument(documentSnapshot) {
  if (CLOUD_MODE) return cloudPersistence.write(documentSnapshot);
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(DOCUMENT_STORE, "readwrite");
    transaction.objectStore(DOCUMENT_STORE).put({
      key: "current",
      savedAt: new Date().toISOString(),
      document: documentSnapshot
    });
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("No se pudo restaurar la copia recuperable."));
  });
}

function clearStoredDocuments() {
  if (CLOUD_MODE) return Promise.resolve();
  if (!database) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(DOCUMENT_STORE, "readwrite");
    const store = transaction.objectStore(DOCUMENT_STORE);
    store.delete("current");
    store.delete("recovery");
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("No se pudieron reiniciar los datos."));
  });
}

function scheduleSave({ immediate = false } = {}) {
  if (!storageAvailable || !hasEditControl) return Promise.resolve();
  setSaveIndicator("saving", "Guardando…");
  if (saveTimer) clearTimeout(saveTimer);
  const delay = immediate ? 0 : 250;
  return new Promise((resolve) => {
    saveWaiters.push(resolve);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      const snapshot = clone(appDocument);
      saveChain = saveChain
        .then(() => writeStoredDocument(snapshot))
        .then(() => {
          setSaveIndicator("saved", CLOUD_MODE ? "Guardado en Supabase" : "Guardado");
          const waiters = saveWaiters;
          saveWaiters = [];
          waiters.forEach((waiter) => waiter());
        })
        .catch(async (error) => {
          if (CLOUD_MODE && error instanceof SupabaseCloudConflictError) {
            try {
              const latest = await cloudPersistence.read();
              if (latest?.document) {
                appDocument = sanitizeDocument(latest.document);
                renderAll();
                setSaveIndicator("error", "Se requiere recargar");
                showToast("Otro dispositivo guardó cambios. Se cargó la versión más reciente; revisa antes de editar de nuevo.", {
                  type: "error",
                  duration: 11000
                });
              }
            } catch (reloadError) {
              showToast(`No se pudo actualizar desde Supabase: ${reloadError.message}`, {
                type: "error",
                duration: 9000
              });
            }
          } else {
            storageAvailable = false;
            setSaveIndicator("error", CLOUD_MODE ? "Sin conexión con Supabase" : "Sin guardado local");
            showToast(`${CLOUD_MODE ? "No se pudo guardar en Supabase" : "No se pudo guardar en el navegador"}: ${error.message}`, {
              type: "error",
              duration: 9000
            });
          }
          const waiters = saveWaiters;
          saveWaiters = [];
          waiters.forEach((waiter) => waiter());
        });
    }, delay);
  });
}

async function flushSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    const snapshot = clone(appDocument);
    saveChain = saveChain.then(() => writeStoredDocument(snapshot)).finally(() => {
      const waiters = saveWaiters;
      saveWaiters = [];
      waiters.forEach((waiter) => waiter());
    });
  }
  await saveChain;
}

function appendAudit(action, detail) {
  appDocument.audit ??= [];
  appDocument.audit.push({
    at: new Date().toISOString(),
    action: safeText(action, 80),
    detail: safeText(detail, 500)
  });
  if (appDocument.audit.length > 500) {
    appDocument.audit.splice(0, appDocument.audit.length - 500);
  }
}

function mutate(action, detail, callback, { undo = true, toast = detail } = {}) {
  if (!hasEditControl) {
    throw new TypeError("Esta pestaña está en modo de solo lectura.");
  }
  const before = clone(appDocument);
  try {
    callback();
    appDocument.appVersion = APP_VERSION;
    appDocument.schemaVersion = SCHEMA_VERSION;
    appDocument.calendarMeta.revision += 1;
    appDocument.calendarMeta.updatedAt = new Date().toISOString();
    appDocument.settings.holidayRuleSetVersion = HOLIDAY_RULESET_VERSION;
    appendAudit(action, detail);
  } catch (error) {
    appDocument = before;
    throw error;
  }
  if (undo) undoSnapshot = { document: before, label: detail };
  renderAll();
  scheduleSave();
  if (toast) showToast(toast, { undo });
}

function mutateWithContract(operation, payload, detail, { undo = true, toast = detail } = {}) {
  if (!hasEditControl) throw new TypeError("Esta pestaña está en modo de solo lectura.");
  const before = clone(appDocument);
  const outcome = executeCalendarOperation(appDocument, { operation, payload });
  if (!outcome.changed) return outcome;
  appDocument = outcome.document;
  if (undo) undoSnapshot = { document: before, label: detail };
  renderAll();
  scheduleSave();
  if (toast) showToast(toast, { undo });
  return outcome;
}

function undoLastMutation() {
  if (!undoSnapshot) return;
  const previous = undoSnapshot;
  undoSnapshot = null;
  appDocument = previous.document;
  selectedActivityIds.clear();
  activeDrawer = null;
  closeDrawer();
  renderAll();
  scheduleSave();
  showToast(`Se deshizo: ${previous.label}`);
}

function showToast(message, { type = "normal", undo = false, duration = 5000 } = {}) {
  const toast = createElement("div", `toast ${type === "error" ? "error" : ""}`.trim());
  const copy = createElement("span", "", safeText(message, 500));
  toast.append(copy);
  if (undo && undoSnapshot) {
    const undoButton = createElement("button", "", "Deshacer");
    undoButton.type = "button";
    undoButton.addEventListener("click", () => {
      undoLastMutation();
      toast.remove();
    });
    toast.append(undoButton);
  }
  dom.toastRegion.append(toast);
  window.setTimeout(() => toast.remove(), duration);
}

function showFormErrors(container, errors) {
  if (!errors.length) {
    container.hidden = true;
    container.replaceChildren();
    return;
  }
  const list = createElement("ul");
  for (const error of errors) list.append(createElement("li", "", error));
  setChildren(container, list);
  container.hidden = false;
}

function downloadBlob(content, mimeType, fileName) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function timestampForFile(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(value);
  const part = (type) => parts.find((item) => item.type === type)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")}_${part("hour")}-${part("minute")}-${part("second")}`;
}

async function sha256Hex(arrayBuffer) {
  if (!crypto?.subtle) return null;
  const digest = await crypto.subtle.digest("SHA-256", arrayBuffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function closeDialog(id) {
  const dialog = dom[id];
  if (dialog?.open) dialog.close();
}

function openDialog(id) {
  const dialog = dom[id];
  if (!dialog.open) dialog.showModal();
}

function focusReferenceFor(element) {
  if (!(element instanceof HTMLElement) || element === document.body) return null;
  return {
    element,
    id: element.id || null,
    activityId: element.closest("[data-activity-id]")?.dataset.activityId || null
  };
}

function resolveFocusReference(reference) {
  if (!reference) return null;
  if (reference.element?.isConnected) return reference.element;
  if (reference.id) return document.getElementById(reference.id);
  if (reference.activityId) {
    const card = [...document.querySelectorAll("[data-activity-id]")]
      .find((element) => element.dataset.activityId === reference.activityId);
    return card?.querySelector(".quick-open") ?? card ?? null;
  }
  return null;
}

function closeDrawer({ restoreFocus = true } = {}) {
  const focusReference = drawerReturnFocus;
  const focusTarget = restoreFocus ? resolveFocusReference(focusReference) : null;
  if (dom.detailDrawer.contains(document.activeElement)) {
    (focusTarget ?? dom.newActivityButton).focus({ preventScroll: true });
  }
  dom.detailDrawer.classList.remove("open");
  dom.detailDrawer.setAttribute("aria-hidden", "true");
  if (dom.detailDrawer.open) dom.detailDrawer.close();
  activeDrawer = null;
  drawerReturnFocus = null;
  if (focusTarget && document.activeElement !== focusTarget) {
    window.requestAnimationFrame(() => focusTarget.focus({ preventScroll: true }));
  }
}

function openDrawer() {
  const wasOpen = dom.detailDrawer.classList.contains("open");
  if (!wasOpen) drawerReturnFocus = focusReferenceFor(document.activeElement);
  if (!dom.detailDrawer.open) dom.detailDrawer.showModal();
  dom.detailDrawer.classList.add("open");
  dom.detailDrawer.setAttribute("aria-hidden", "false");
  if (!wasOpen) {
    window.requestAnimationFrame(() => dom.closeDrawerButton.focus());
  }
}

function closeAllActionMenus(except = null) {
  for (const menu of document.querySelectorAll(".action-menu[open]")) {
    if (menu !== except) menu.removeAttribute("open");
  }
}

function closeMobileMore() {
  document.body.classList.remove("mobile-more-open");
  dom.mobileMoreButton.setAttribute("aria-expanded", "false");
}

function toggleMobileMore() {
  const open = !document.body.classList.contains("mobile-more-open");
  document.body.classList.toggle("mobile-more-open", open);
  dom.mobileMoreButton.setAttribute("aria-expanded", String(open));
  if (!open) closeAllActionMenus();
}

function openMobileMonthPicker() {
  closeMobileMore();
  dom.mobileMonthGridHost.append(dom.monthGridWrap);
  dom.mobileMonthTitle.textContent = dom.monthTitle.textContent;
  if (!dom.mobileMonthDialog.open) dom.mobileMonthDialog.showModal();
}

function closeMobileMonthPicker({ restoreFocus = true } = {}) {
  if (dom.monthGridWrap.parentElement === dom.mobileMonthGridHost) {
    dom.calendarPanel.insertBefore(dom.monthGridWrap, dom.mobileAgenda);
  }
  if (dom.mobileMonthDialog.open) dom.mobileMonthDialog.close();
  if (restoreFocus) dom.mobileMonthButton.focus();
}

function activitySearchText(activity, maps = lookupMaps()) {
  const client = maps.clients.get(activity.clientId);
  const site = maps.sites.get(activity.siteId);
  const responsibles = activity.responsibleIds.map((id) => maps.responsibles.get(id)?.name ?? "");
  return normalizeText([
    client?.name,
    site?.name,
    site?.shoppingCenter,
    activity.city,
    SERVICE_TYPES[activity.serviceType],
    ACTIVITY_STATUSES[activity.status],
    PLANNING_BUCKETS[activity.planningBucket ?? "calendar"],
    activity.observations,
    ...responsibles
  ].filter(Boolean).join(" "));
}

function matchesActivityFilters(activity, maps, filters = appDocument.settings.filters) {
  return activityMatchesFilters(activity, filters, maps);
}

function responsibleVisualClass(activity, maps) {
  const types = new Set(
    activity.responsibleIds
      .map((id) => maps.responsibles.get(id)?.responsibleType)
      .filter(Boolean)
  );
  if (!types.size) return "unassigned";
  if (types.size > 1) return "mixed";
  return types.has("contractor") ? "contractor" : "payroll";
}

function renderFilters() {
  dom.globalSearch.value = appDocument.settings.filters.query ?? "";
  const definitions = filterDefinitions();
  const chips = document.createDocumentFragment();
  let count = 0;
  for (const definition of definitions) {
    const selected = normalizeFilterArray(appDocument.settings.filters[definition.key]);
    count += selected.length;
    for (const value of selected) {
      const label = definition.options.find((item) => item.value === value)?.label ?? value;
      const chip = createElement("button", "filter-chip", `${definition.singular}: ${label} ×`);
      chip.type = "button";
      chip.addEventListener("click", () => {
        appDocument.settings.filters[definition.key] = selected.filter((item) => item !== value);
        renderAll();
        scheduleSave();
      });
      chips.append(chip);
    }
  }
  dom.filterChips.replaceChildren(chips);
  dom.filterCount.textContent = String(count);
  dom.clearFiltersButton.hidden = count === 0 && !appDocument.settings.filters.query;
}

function filterDefinitions() {
  const uniqueCities = [...new Set([
    ...appDocument.catalog.cities.map((item) => item.name),
    ...appDocument.catalog.sites.map((item) => item.city),
    ...appDocument.activities.map((item) => item.city)
  ].filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
  return [
    { key: "cities", title: "Ciudades", singular: "Ciudad", options: uniqueCities.map((value) => ({ value, label: value })) },
    {
      key: "clients", title: "Clientes", singular: "Cliente",
      options: appDocument.catalog.clients.filter((item) => item.active !== false).map((item) => ({ value: item.id, label: item.name }))
    },
    {
      key: "sites", title: "Sedes", singular: "Sede",
      options: appDocument.catalog.sites.filter((item) => item.active !== false).map((item) => ({ value: item.id, label: item.name }))
    },
    {
      key: "responsibles", title: "Responsables", singular: "Responsable",
      options: appDocument.catalog.responsibles.filter((item) => item.active !== false).map((item) => ({ value: item.id, label: item.name }))
    },
    {
      key: "serviceTypes", title: "Tipos de servicio", singular: "Servicio",
      options: Object.entries(SERVICE_TYPES).map(([value, label]) => ({ value, label }))
    },
    {
      key: "statuses", title: "Estados", singular: "Estado",
      options: Object.entries(ACTIVITY_STATUSES).map(([value, label]) => ({ value, label }))
    },
    {
      key: "planningBuckets", title: "Bandejas", singular: "Bandeja",
      options: Object.entries(PLANNING_BUCKETS).map(([value, label]) => ({ value, label }))
    }
  ].map((definition) => ({
    ...definition,
    options: definition.options.sort((a, b) => a.label.localeCompare(b.label, "es"))
  }));
}

function renderFilterDialog() {
  const maps = lookupMaps();
  const fragment = document.createDocumentFragment();
  for (const definition of filterDefinitions()) {
    const section = createElement("fieldset", "filter-group");
    section.append(createElement("legend", "", definition.title));
    const selected = new Set(normalizeFilterArray(appDocument.settings.filters[definition.key]));
    for (const item of definition.options) {
      const candidateFilters = clone(appDocument.settings.filters);
      candidateFilters[definition.key] = [item.value];
      const matches = appDocument.activities.filter((activity) =>
        matchesActivityFilters(activity, maps, candidateFilters)
      ).length;
      const label = createElement("label", "check-row");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.name = `filter-${definition.key}`;
      input.value = item.value;
      input.checked = selected.has(item.value);
      input.disabled = matches === 0 && !input.checked;
      label.append(input, createElement("span", "", `${item.label} (${matches})`));
      section.append(label);
    }
    if (!definition.options.length) section.append(createElement("p", "field-note", "Sin opciones disponibles."));
    fragment.append(section);
  }
  dom.filterGrid.replaceChildren(fragment);
}

function openFilterDialog() {
  renderFilterDialog();
  openDialog("filterDialog");
}

function clearAllFilters({ close = false } = {}) {
  appDocument.settings.filters = {
    ...appDocument.settings.filters,
    query: "",
    cities: [],
    clients: [],
    sites: [],
    responsibles: [],
    serviceTypes: [],
    statuses: [],
    planningBuckets: []
  };
  if (close) closeDialog("filterDialog");
  renderAll();
  scheduleSave();
}

function handleFilterSubmit(event) {
  event.preventDefault();
  for (const definition of filterDefinitions()) {
    appDocument.settings.filters[definition.key] = [
      ...dom.filterGrid.querySelectorAll(`input[name="filter-${definition.key}"]:checked`)
    ].map((input) => input.value);
  }
  closeDialog("filterDialog");
  renderAll();
  scheduleSave();
}

function renderBackupReminder() {
  const hasData = appDocument.activities.length > 0;
  if (!hasData) {
    dom.backupBanner.hidden = true;
    return;
  }
  const lastBackup = appDocument.settings.lastBackupAt
    ? new Date(appDocument.settings.lastBackupAt)
    : null;
  const ageDays = lastBackup ? (Date.now() - lastBackup.getTime()) / 86400000 : Infinity;
  const threshold = Number(appDocument.settings.backupReminderDays) || 7;
  dom.backupBanner.hidden = ageDays < threshold || appDocument.settings.backupReminderDismissed === todayInBogota();
  dom.backupBannerText.textContent = lastBackup
    ? `El último respaldo fue el ${timestampLabel(lastBackup.toISOString())}.`
    : "Aún no has descargado un respaldo de tus actividades.";
}

async function renderStorageStatus() {
  if (CLOUD_MODE) {
    const user = cloudPersistence?.getUser();
    dom.storageStatusTitle.textContent = "Datos guardados en Supabase";
    dom.storageStatusText.textContent = user?.email
      ? `Base compartida · ${user.email}`
      : "Base compartida · sesión autenticada";
    dom.requestPersistenceButton.hidden = true;
    dom.cloudSignOutButton.hidden = false;
    return;
  }
  dom.storageStatusTitle.textContent = "Datos guardados solamente en este navegador";
  if (!navigator.storage) {
    dom.storageStatusText.textContent = "Guardado en este navegador · Descarga copias periódicas para proteger tus datos.";
    dom.requestPersistenceButton.hidden = true;
    return;
  }
  try {
    const [persisted, estimate] = await Promise.all([
      navigator.storage.persisted?.() ?? false,
      navigator.storage.estimate?.() ?? {}
    ]);
    const used = Number(estimate.usage) || 0;
    const quota = Number(estimate.quota) || 0;
    const usageLabel = quota
      ? ` Uso aproximado: ${(used / 1024 / 1024).toFixed(1)} MB de ${(quota / 1024 / 1024).toFixed(0)} MB.`
      : "";
    dom.storageStatusText.textContent = persisted
      ? `Guardado en este navegador · Protección activa.${usageLabel}`
      : `Guardado en este navegador · Puede borrarse al limpiar datos o por falta de espacio.${usageLabel}`;
    dom.requestPersistenceButton.hidden = Boolean(persisted) || typeof navigator.storage.persist !== "function";
  } catch {
    dom.storageStatusText.textContent = "Guardado en este navegador · No fue posible comprobar la protección.";
    dom.requestPersistenceButton.hidden = true;
  }
}

async function requestStoragePersistence() {
  try {
    const granted = await navigator.storage.persist();
    await renderStorageStatus();
    showToast(granted
      ? "El navegador concedió protección al almacenamiento."
      : "El navegador no concedió protección. Usa respaldos JSON frecuentes.");
  } catch (error) {
    showToast(`No se pudo solicitar protección: ${error.message}`, { type: "error" });
  }
}

function openCalendarSettingsDialog() {
  dom.calendarName.value = appDocument.calendarMeta.name;
  dom.calendarCoordinator.value = appDocument.calendarMeta.coordinator;
  const summary = createElement("div", "detail-grid");
  summary.append(detailItem("Revisión", String(appDocument.calendarMeta.revision)));
  summary.append(detailItem("Creado", timestampLabel(appDocument.calendarMeta.createdAt)));
  summary.append(detailItem("Última modificación", timestampLabel(appDocument.calendarMeta.updatedAt)));
  dom.calendarMetaSummary.replaceChildren(summary);
  showFormErrors(dom.calendarSettingsErrors, []);
  openDialog("calendarSettingsDialog");
}

function handleCalendarSettingsSubmit(event) {
  event.preventDefault();
  const name = safeText(dom.calendarName.value, 160);
  const coordinator = safeText(dom.calendarCoordinator.value, 160);
  if (!name) {
    showFormErrors(dom.calendarSettingsErrors, ["Escribe un nombre para el cronograma."]);
    return;
  }
  try {
    mutate("calendar_identified", "Identificación del cronograma actualizada", () => {
      appDocument.calendarMeta.name = name;
      appDocument.calendarMeta.coordinator = coordinator;
    });
    closeDialog("calendarSettingsDialog");
  } catch (error) {
    showFormErrors(dom.calendarSettingsErrors, [error.message]);
  }
}

function renderSelectionBar() {
  const count = selectedActivityIds.size;
  dom.selectionBar.hidden = count === 0 || !hasEditControl;
  dom.selectionCount.textContent = String(count);
}

function refreshSelectionUi() {
  renderCalendar();
  renderSelectionBar();
}

function clearActivitySelection() {
  selectedActivityIds.clear();
  refreshSelectionUi();
}

function runtimeMode() {
  if (CLOUD_MODE) return RUNTIME_CHANNEL === "beta" ? "Supabase · BETA" : "Supabase";
  if (RUNTIME_CHANNEL === "beta") return "GitHub Pages BETA";
  return location.protocol === "https:" && /\.github\.io$/i.test(location.hostname)
    ? "GitHub Pages"
    : location.protocol === "file:"
      ? "archivo local"
      : "servidor local";
}

function updateCatalogSemantics() {
  const activeTab = catalogTab === "sites"
    ? dom.sitesTab
    : catalogTab === "responsibles"
      ? dom.responsiblesTab
      : dom.quarantineTab;
  dom.catalogList.setAttribute("aria-labelledby", activeTab.id);
}

function applyDesignContract() {
  if (!["beta", "stable"].includes(RUNTIME_CHANNEL)) return;
  document.documentElement.dataset.channel = RUNTIME_CHANNEL;
  document.querySelector(".segmented[role=\"tablist\"]")?.setAttribute("aria-orientation", "horizontal");
  dom.catalogList.setAttribute("role", "tabpanel");
  dom.catalogList.setAttribute("tabindex", "0");
  for (const tab of [dom.sitesTab, dom.responsiblesTab, dom.quarantineTab]) {
    tab.setAttribute("aria-controls", "catalogList");
  }
  updateCatalogSemantics();
}

function renderCalendarIdentity() {
  const coordinator = appDocument.calendarMeta.coordinator;
  dom.calendarIdentity.textContent = coordinator
    ? `${appDocument.calendarMeta.name} · ${coordinator}`
    : appDocument.calendarMeta.name;
  dom.runtimeModeLabel.textContent = CLOUD_MODE
    ? "Los datos se guardan en la base compartida de Supabase. Descarga copias JSON como respaldo adicional."
    : "Los datos se guardan en este navegador. Descarga una copia para conservarlos.";
}

function renderAll() {
  renderCalendarIdentity();
  renderFilters();
  renderCatalog();
  renderCalendar();
  renderSelectionBar();
  renderBackupReminder();
  renderAccessMode();
  if (activeDrawer?.type === "activity") renderActivityDrawer(activeDrawer.id);
  if (activeDrawer?.type === "day") renderDayDrawer(activeDrawer.date);
}

function renderCatalog() {
  dom.sitesTab.classList.toggle("active", catalogTab === "sites");
  dom.responsiblesTab.classList.toggle("active", catalogTab === "responsibles");
  dom.quarantineTab.classList.toggle("active", catalogTab === "quarantine");
  dom.sitesTab.setAttribute("aria-selected", String(catalogTab === "sites"));
  dom.responsiblesTab.setAttribute("aria-selected", String(catalogTab === "responsibles"));
  dom.quarantineTab.setAttribute("aria-selected", String(catalogTab === "quarantine"));
  const quarantineCount = appDocument.activities.filter((activity) => isQuarantineActivity(activity)).length;
  dom.quarantineCount.textContent = String(quarantineCount);
  updateCatalogSemantics();
  dom.catalogList.classList.toggle("pending-drop-zone", catalogTab === "quarantine");
  dom.dragHint.textContent = catalogTab === "sites"
    ? "Arrastra un cliente o una sede hasta un día."
    : catalogTab === "responsibles"
      ? "Los colores distinguen nómina y contratistas."
      : "Arrastra una tarjeta del calendario hasta la zona Pendiente o un pendiente hasta una fecha.";
  dom.newQuarantineButton.hidden = catalogTab !== "quarantine";
  dom.newCatalogButton.hidden = catalogTab === "quarantine";

  const query = normalizeText(dom.catalogSearch.value);
  const fragment = document.createDocumentFragment();

  if (catalogTab === "quarantine") {
    const maps = lookupMaps();
    const items = appDocument.activities
      .filter((activity) => isQuarantineActivity(activity))
      .filter((activity) => matchesActivityFilters(activity, maps))
      .filter((activity) => !query || activitySearchText(activity, maps).includes(query))
      .sort((a, b) => (a.updatedAt ?? "").localeCompare(b.updatedAt ?? "") || a.id.localeCompare(b.id));
    for (const activity of items) {
      const card = buildActivityCard(activity, maps, { quarantine: true });
      const assign = createElement("button", "button small quarantine-assign", "Asignar fecha");
      assign.type = "button";
      assign.disabled = !hasEditControl;
      assign.addEventListener("click", (event) => {
        event.stopPropagation();
        openQuarantineAssignDialog(activity.id);
      });
      card.append(assign);
      fragment.append(card);
    }
    if (!items.length) {
      const placeholder = createElement("div", "pending-drop-placeholder");
      placeholder.append(
        createElement("strong", "", "No hay pendientes"),
        createElement("span", "", "Arrastra aquí una tarjeta del calendario para enviarla a actividades por programar.")
      );
      fragment.append(placeholder);
    }
    dom.catalogList.replaceChildren(fragment);
    dom.emptyCatalog.hidden = true;
    dom.catalogList.hidden = false;
    dom.emptyImportButton.hidden = true;
    return;
  }

  dom.emptyImportButton.hidden = false;
  dom.emptyCatalog.querySelector("strong").textContent = "Aún no hay catálogo";
  dom.emptyCatalog.querySelector("p").textContent = "Importa la Base Operativa o crea tus primeros registros manualmente.";

  if (catalogTab === "sites") {
    const activeClients = appDocument.catalog.clients
      .filter((client) => client.active !== false)
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
    for (const client of activeClients) {
      const clientSites = appDocument.catalog.sites
        .filter((site) => site.clientId === client.id && site.active !== false)
        .filter((site) => !query || normalizeText(`${client.name} ${site.name} ${site.city}`).includes(query))
        .sort((a, b) => a.name.localeCompare(b.name, "es"));
      if (query && !normalizeText(client.name).includes(query) && !clientSites.length) continue;

      const group = createElement("section", "catalog-client-group");
      const clientRow = createElement("div", "catalog-client");
      clientRow.draggable = hasEditControl;
      clientRow.dataset.dragType = "client";
      clientRow.dataset.clientId = client.id;
      clientRow.title = "Arrastrar cliente al calendario";
      clientRow.append(createElement("span", "drag-grip", "⋮⋮"));
      clientRow.append(createElement("span", "", client.name));
      const editClient = createElement("button", "mini-edit", "✎");
      editClient.type = "button";
      editClient.disabled = !hasEditControl;
      editClient.title = `Editar ${client.name}`;
      editClient.setAttribute("aria-label", `Editar cliente ${client.name}`);
      editClient.addEventListener("click", (event) => {
        event.stopPropagation();
        openCatalogDialog("client", client.id);
      });
      clientRow.append(editClient);
      clientRow.addEventListener("dragstart", handleCatalogDragStart);
      group.append(clientRow);

      for (const site of clientSites) {
        const row = createElement("div", "catalog-site");
        row.draggable = hasEditControl;
        row.dataset.dragType = "site";
        row.dataset.siteId = site.id;
        row.title = "Arrastrar sede al calendario";
        row.append(createElement("span", "drag-grip", "⋮⋮"));
        const main = createElement("span", "catalog-main");
        main.append(createElement("strong", "", site.name));
        main.append(createElement("small", "", [site.city, site.zone].filter(Boolean).join(" · ") || "Sin ciudad"));
        row.append(main);
        const edit = createElement("button", "mini-edit", "✎");
        edit.type = "button";
        edit.disabled = !hasEditControl;
        edit.title = `Editar ${site.name}`;
        edit.setAttribute("aria-label", `Editar sede ${site.name}`);
        edit.addEventListener("click", (event) => {
          event.stopPropagation();
          openCatalogDialog("site", site.id);
        });
        row.append(edit);
        row.addEventListener("dragstart", handleCatalogDragStart);
        group.append(row);
      }
      fragment.append(group);
    }
  } else {
    const responsibles = appDocument.catalog.responsibles
      .filter((item) => item.active !== false)
      .filter((item) => !query || normalizeText(`${item.name} ${item.company} ${item.baseCity} ${item.group}`).includes(query))
      .sort((a, b) => {
        if (Boolean(a.favorite) !== Boolean(b.favorite)) return a.favorite ? -1 : 1;
        if (a.responsibleType !== b.responsibleType) return a.responsibleType === "payroll" ? -1 : 1;
        return a.name.localeCompare(b.name, "es");
      });
    for (const responsible of responsibles) {
      const row = createElement("div", "responsible-row");
      const dot = createElement("span", `responsible-type-dot ${responsible.responsibleType === "contractor" ? "contractor" : ""}`.trim());
      row.append(dot);
      const main = createElement("span", "catalog-main");
      main.append(createElement("strong", "", `${responsible.favorite ? "★ " : ""}${responsible.name}`));
      main.append(createElement("small", "", [
        RESPONSIBLE_TYPES[responsible.responsibleType] ?? responsible.responsibleType,
        responsible.baseCity
      ].filter(Boolean).join(" · ")));
      row.append(main);
      const edit = createElement("button", "mini-edit", "✎");
      edit.type = "button";
      edit.title = `Editar ${responsible.name}`;
      edit.setAttribute("aria-label", `Editar responsable ${responsible.name}`);
      edit.addEventListener("click", () => openCatalogDialog("responsible", responsible.id));
      row.append(edit);
      fragment.append(row);
    }
  }

  dom.catalogList.replaceChildren(fragment);
  const count = dom.catalogList.childElementCount;
  dom.emptyCatalog.hidden = count > 0;
  dom.catalogList.hidden = count === 0;
}

function handleCatalogDragStart(event) {
  const row = event.currentTarget;
  const payload = row.dataset.dragType === "site"
    ? { type: "site", siteId: row.dataset.siteId }
    : { type: "client", clientId: row.dataset.clientId };
  dragContext = payload;
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData("application/x-calendario-hvac", JSON.stringify(payload));
}

function dragPayloadFromEvent(event) {
  if (dragContext) return dragContext;
  try {
    const raw = event.dataTransfer?.getData("application/x-calendario-hvac");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearPlanningBucketDropState() {
  dom.catalogList.classList.remove("drag-over");
}

function handlePlanningBucketDragOver(event) {
  if (!hasEditControl || catalogTab !== "quarantine") return;
  const payload = dragPayloadFromEvent(event);
  if (payload?.type !== "activity") return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  dom.catalogList.classList.add("drag-over");
}

function handlePlanningBucketDragLeave(event) {
  if (!dom.catalogList.contains(event.relatedTarget)) clearPlanningBucketDropState();
}

function handlePlanningBucketDrop(event) {
  event.preventDefault();
  clearPlanningBucketDropState();
  if (!hasEditControl || catalogTab !== "quarantine") return;
  const payload = dragPayloadFromEvent(event);
  dragContext = null;
  if (payload?.type !== "activity") return;
  if (payload.activityIds?.length !== 1) {
    showToast("Pendiente se maneja una tarjeta a la vez.", { type: "error" });
    return;
  }
  const activity = appDocument.activities.find((item) => item.id === payload.anchorId);
  if (!activity || isQuarantineActivity(activity)) return;
  openQuarantineDialog(activity.id);
}

function buildActivityCard(activity, maps, { quarantine = false } = {}) {
  const card = createElement("article", `activity-card ${responsibleVisualClass(activity, maps)} ${activity.status.replaceAll("_", "-")}${quarantine ? " quarantine-card" : ""}`);
  card.draggable = hasEditControl;
  card.dataset.activityId = activity.id;
  card.setAttribute("aria-label", `${maps.clients.get(activity.clientId)?.name ?? SERVICE_TYPES[activity.serviceType] ?? "Actividad"} ${maps.sites.get(activity.siteId)?.name ?? ""}, ${ACTIVITY_STATUSES[activity.status]}`);
  if (selectedActivityIds.has(activity.id)) card.classList.add("selected");

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "activity-select";
  checkbox.checked = selectedActivityIds.has(activity.id);
  checkbox.disabled = !hasEditControl || quarantine;
  checkbox.hidden = quarantine;
  checkbox.title = quarantine ? "Las operaciones Pendiente son individuales" : "Seleccionar tarjeta";
  checkbox.setAttribute("aria-label", "Seleccionar tarjeta");
  checkbox.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleActivitySelection(activity.id, checkbox.checked);
  });
  card.append(checkbox);

  const copyBlock = createElement("span", "activity-copy");
  const client = maps.clients.get(activity.clientId);
  const site = maps.sites.get(activity.siteId);
  const title = activity.serviceType === "administrative" && !client
    ? "Administrativo"
    : client?.name ?? SERVICE_TYPES[activity.serviceType] ?? "Cliente sin catálogo";
  const assigned = activity.responsibleIds
    .map((id) => maps.responsibles.get(id))
    .filter(Boolean)
    .map((item) => item.initials || displayInitialsFor(item.name))
    .join(" · ");
  copyBlock.append(createElement("strong", "", title));
  copyBlock.append(createElement("small", "", [
    site?.name || activity.city,
    assigned || "Sin responsable",
    quarantine ? PLANNING_BUCKETS.quarantine : ""
  ].filter(Boolean).join(" · ")));
  card.append(copyBlock);

  const flags = createElement("span", "card-flags");
  const openDetail = createElement("button", "quick-open", STATUS_ICONS[activity.status] ?? "•");
  openDetail.type = "button";
  openDetail.title = "Abrir detalle";
  openDetail.setAttribute("aria-label", `Abrir detalle de ${title}`);
  openDetail.addEventListener("click", (event) => {
    event.stopPropagation();
    renderActivityDrawer(activity.id);
  });
  flags.append(openDetail);
  if (activity.history?.some((item) => item.action === "rescheduled")) {
    const moved = createElement("span", "", "↪");
    moved.title = "Actividad reprogramada";
    flags.append(moved);
  }
  if (!quarantine && hasEditControl && activity.status !== "completed" && activity.status !== "cancelled") {
    const complete = createElement("button", "quick-complete", "✓");
    complete.type = "button";
    complete.title = "Marcar como terminada";
    complete.setAttribute("aria-label", "Marcar como terminada");
    complete.addEventListener("click", (event) => {
      event.stopPropagation();
      markActivityCompleted(activity.id);
    });
    flags.append(complete);
  }
  card.append(flags);

  card.addEventListener("click", (event) => {
    if (event.ctrlKey || event.metaKey) {
      toggleActivitySelection(activity.id);
      return;
    }
    renderActivityDrawer(activity.id);
  });
  card.addEventListener("dragstart", (event) => {
    if (!hasEditControl) {
      event.preventDefault();
      return;
    }
    const ids = selectedActivityIds.has(activity.id) && selectedActivityIds.size > 1
      ? [...selectedActivityIds]
      : [activity.id];
    const payload = { type: "activity", activityIds: ids, anchorId: activity.id };
    dragContext = payload;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-calendario-hvac", JSON.stringify(payload));
  });
  card.addEventListener("dragend", () => {
    dragContext = null;
    document.querySelectorAll(".day-cell.drag-over").forEach((cell) => cell.classList.remove("drag-over"));
    clearPlanningBucketDropState();
  });
  return card;
}

function selectMobileAgendaDate(date) {
  mobileAgendaDate = date;
  appDocument.settings.currentDate = date;
  if (dom.mobileMonthDialog.open) closeMobileMonthPicker({ restoreFocus: false });
  renderCalendar();
  scheduleSave();
}

function changeMobileAgendaDay(delta) {
  selectMobileAgendaDate(addDaysISO(
    mobileAgendaDate || appDocument.settings.currentDate || todayInBogota(),
    delta
  ));
}

function renderMobileAgenda(date, items, maps, holiday) {
  mobileAgendaDate = date;
  dom.mobileAgendaTitle.textContent = formatDisplayDate(date, { weekday: "long" });
  dom.mobileAgendaMeta.textContent = [
    holiday?.name,
    `${items.length} actividad${items.length === 1 ? "" : "es"} visible${items.length === 1 ? "" : "s"}`
  ].filter(Boolean).join(" · ");
  dom.mobileAgendaAddButton.disabled = !hasEditControl;
  const fragment = document.createDocumentFragment();
  if (!items.length) {
    const empty = createElement("div", "mobile-agenda-empty");
    empty.append(
      createElement("strong", "", "No hay actividades en este día"),
      createElement("p", "", "Selecciona otra fecha o agrega una nueva actividad.")
    );
    fragment.append(empty);
  }
  for (const activity of items) {
    const card = buildActivityCard(activity, maps);
    card.draggable = false;
    fragment.append(card);
  }
  dom.mobileAgendaList.replaceChildren(fragment);
}

function renderCalendar() {
  const { year, month } = currentMonthParts();
  dom.monthTitle.textContent = formatMonthTitle(year, month);
  dom.mobileMonthTitle.textContent = dom.monthTitle.textContent;
  const gridDates = monthGridDates(year, month);
  const years = [...new Set(gridDates.map((date) => Number(date.slice(0, 4))))];
  const holidays = holidayMapForYears(years, appDocument.holidayOverrides);
  const maps = lookupMaps();
  const activitiesByDate = new Map();
  for (const activity of appDocument.activities) {
    if (isQuarantineActivity(activity) || !activity.date) continue;
    if (!matchesActivityFilters(activity, maps)) continue;
    const items = activitiesByDate.get(activity.date) ?? [];
    items.push(activity);
    activitiesByDate.set(activity.date, items);
  }
  for (const items of activitiesByDate.values()) {
    items.sort((a, b) => {
      const completedDifference = Number(a.status === "completed") - Number(b.status === "completed");
      return completedDifference || a.createdAt.localeCompare(b.createdAt);
    });
  }

  const today = todayInBogota();
  const fragment = document.createDocumentFragment();
  const preferredFocusDate = gridDates.includes(calendarFocusDate)
    ? calendarFocusDate
    : gridDates.includes(appDocument.settings.currentDate)
      ? appDocument.settings.currentDate
      : gridDates.find((date) => Number(date.slice(5, 7)) === month) ?? gridDates[0];
  calendarFocusDate = preferredFocusDate;
  const agendaDate = gridDates.includes(mobileAgendaDate)
    ? mobileAgendaDate
    : gridDates.includes(appDocument.settings.currentDate)
      ? appDocument.settings.currentDate
      : preferredFocusDate;
  for (const date of gridDates) {
    const day = Number(date.slice(8, 10));
    const weekday = dayOfWeek(date);
    const holiday = holidays.get(date);
    const cell = createElement("div", "day-cell");
    cell.dataset.date = date;
    cell.setAttribute("role", "group");
    cell.setAttribute("aria-label", `${DAY_NAMES[weekday]} ${formatDisplayDate(date)}${holiday ? `, ${holiday.name}` : ""}`);
    if (Number(date.slice(5, 7)) !== month) cell.classList.add("outside-month");
    if (weekday === 6) cell.classList.add("saturday");
    if (weekday === 0) cell.classList.add("sunday");
    if (holiday?.occurrences?.length || holiday?.manualClosure) cell.classList.add("holiday");
    if (date === today) cell.classList.add("today");
    if (date === agendaDate) cell.classList.add("agenda-selected");

    const header = createElement("div", "day-header");
    const number = createElement("button", "day-number", String(day));
    number.type = "button";
    const compact = compactLayoutQuery?.matches;
    number.title = `${compact ? "Ver agenda del" : "Crear actividad el"} ${formatDisplayDate(date)}`;
    number.setAttribute("aria-label", number.title);
    number.tabIndex = date === preferredFocusDate ? 0 : -1;
    number.addEventListener("focus", () => {
      calendarFocusDate = date;
    });
    number.addEventListener("click", () => {
      if (compactLayoutQuery?.matches) selectMobileAgendaDate(date);
      else openActivityDialog({ date });
    });
    number.addEventListener("keydown", (event) => {
      const weekdayOffset = (dayOfWeek(date) + 6) % 7;
      const offsets = {
        ArrowLeft: -1,
        ArrowRight: 1,
        ArrowUp: -7,
        ArrowDown: 7,
        Home: -weekdayOffset,
        End: 6 - weekdayOffset
      };
      if (!(event.key in offsets)) return;
      event.preventDefault();
      const targetDate = addDaysISO(date, offsets[event.key]);
      if (!gridDates.includes(targetDate)) return;
      calendarFocusDate = targetDate;
      number.tabIndex = -1;
      const target = dom.calendarGrid.querySelector(`[data-date="${targetDate}"] .day-number`);
      if (target) {
        target.tabIndex = 0;
        target.focus();
      }
    });
    header.append(number);
    if (holiday) {
      const holidayLabel = createElement("span", "holiday-label", holiday.name);
      const policy = holiday.allowScheduling ? " · programación habilitada" : "";
      holidayLabel.title = `${holiday.name}${policy}`;
      header.append(holidayLabel);
    } else if (weekday === 0) {
      header.append(createElement("span", "holiday-label", "Domingo"));
    }
    cell.append(header);

    const cardContainer = createElement("div", "day-cards");
    const items = activitiesByDate.get(date) ?? [];
    if (items.length) {
      const count = createElement("span", "mobile-day-count", String(items.length));
      count.title = `${items.length} actividad${items.length === 1 ? "" : "es"}`;
      count.setAttribute("aria-label", count.title);
      header.append(count);
    }
    for (const activity of items.slice(0, MAX_VISIBLE_CARDS)) {
      cardContainer.append(buildActivityCard(activity, maps));
    }
    if (items.length > MAX_VISIBLE_CARDS) {
      const more = createElement("button", "more-button", `＋${items.length - MAX_VISIBLE_CARDS} más`);
      more.type = "button";
      more.addEventListener("click", () => renderDayDrawer(date));
      cardContainer.append(more);
    }
    cell.append(cardContainer);

    cell.addEventListener("dragover", (event) => {
      if (!dragContext) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = dragContext.type === "activity" ? "move" : "copy";
      cell.classList.add("drag-over");
    });
    cell.addEventListener("dragleave", (event) => {
      if (!cell.contains(event.relatedTarget)) cell.classList.remove("drag-over");
    });
    cell.addEventListener("drop", (event) => handleCalendarDrop(event, date, holidays));
    cell.addEventListener("click", (event) => {
      if (event.target.closest("button, input, .activity-card")) return;
      if (compactLayoutQuery?.matches) {
        selectMobileAgendaDate(date);
        return;
      }
      if (!hasEditControl) return;
      openActivityDialog({ date });
    });
    fragment.append(cell);
  }
  dom.calendarGrid.replaceChildren(fragment);
  if (compactLayoutQuery?.matches) {
    renderMobileAgenda(
      agendaDate,
      activitiesByDate.get(agendaDate) ?? [],
      maps,
      holidays.get(agendaDate)
    );
  } else {
    dom.mobileAgendaList.replaceChildren();
  }
}

function renderQuarantineAssignWarning() {
  const date = dom.quarantineAssignDate.value;
  if (!date) {
    dom.quarantineAssignWarning.hidden = true;
    dom.quarantineAssignWarning.replaceChildren();
    return;
  }
  const holidays = holidayMapForYears([Number(date.slice(0, 4))], appDocument.holidayOverrides);
  const validation = validatePlanningDate(date, holidays);
  dom.quarantineAssignWarning.hidden = validation.valid;
  dom.quarantineAssignWarning.replaceChildren();
  if (!validation.valid) {
    dom.quarantineAssignWarning.append(
      createElement("p", "", `${validation.reason} Podrás asignarla sólo después de confirmar la decisión.`)
    );
  }
  dom.confirmQuarantineAssignButton.disabled = !parseISODateSafely(date);
}

function parseISODateSafely(value) {
  try {
    parseISODate(value);
    return true;
  } catch {
    return false;
  }
}

function openQuarantineAssignDialog(activityId, date = null) {
  const activity = appDocument.activities.find((item) => item.id === activityId);
  if (!activity || !isQuarantineActivity(activity) || !hasEditControl) return;
  pendingQuarantineAssignId = activityId;
  const maps = lookupMaps();
  const client = maps.clients.get(activity.clientId);
  dom.quarantineAssignSummary.textContent = `${client?.name ?? SERVICE_TYPES[activity.serviceType] ?? "Actividad"}. Elige una fecha laborable para devolverla al calendario.`;
  dom.quarantineAssignDate.value = date || appDocument.settings.currentDate || todayInBogota();
  showFormErrors(dom.quarantineAssignErrors, []);
  renderQuarantineAssignWarning();
  openDialog("quarantineAssignDialog");
}

function applyQuarantineAssignment(activityId, date) {
  const holidays = holidayMapForYears([Number(date.slice(0, 4))], appDocument.holidayOverrides);
  const validation = validatePlanningDate(date, holidays);
  if (!validation.valid && !window.confirm(`${validation.reason}\n\n¿Asignar de todos modos?`)) return false;
  mutateWithContract("activity.assign-date", {
    activityId,
    targetDate: date,
    allowNonWorking: !validation.valid
  }, "Actividad devuelta al calendario");
  return true;
}

function handleCalendarDrop(event, date, holidayMap) {
  event.preventDefault();
  if (!hasEditControl) return;
  event.currentTarget.classList.remove("drag-over");
  let payload = dragContext;
  if (!payload) {
    try {
      payload = JSON.parse(event.dataTransfer.getData("application/x-calendario-hvac"));
    } catch {
      return;
    }
  }
  dragContext = null;
  if (payload.type === "client") {
    openActivityDialog({ date, clientId: payload.clientId });
    return;
  }
  if (payload.type === "site") {
    const site = appDocument.catalog.sites.find((item) => item.id === payload.siteId);
    openActivityDialog({ date, clientId: site?.clientId, siteId: payload.siteId });
    return;
  }
  if (payload.type === "activity") {
    const anchor = appDocument.activities.find((item) => item.id === payload.anchorId);
    if (!anchor) return;
    if (isQuarantineActivity(anchor)) {
      if (payload.activityIds.length !== 1) {
        showToast("Las tarjetas Pendiente se asignan una por una.", { type: "error" });
        return;
      }
      try {
        applyQuarantineAssignment(anchor.id, date);
      } catch (error) {
        showToast(error.message, { type: "error" });
      }
      return;
    }
    if (anchor.date === date) return;
    pendingDrop = { ...payload, date, holidayMap };
    dom.dropActionSummary.textContent = payload.activityIds.length > 1
      ? `${payload.activityIds.length} tarjetas seleccionadas. Se conservará la distancia entre sus fechas.`
      : `Actividad del ${formatDisplayDate(anchor.date)} hacia el ${formatDisplayDate(date)}.`;
    dom.dropExtendButton.hidden = payload.activityIds.length !== 1;
    openDialog("dropActionDialog");
  }
}

function applyPendingDrop(action) {
  if (!pendingDrop) return;
  const payload = pendingDrop;
  pendingDrop = null;
  closeDialog("dropActionDialog");
  try {
    if (action === "move") {
      const label = payload.activityIds.length > 1
        ? `${payload.activityIds.length} tarjetas movidas`
        : "Actividad movida";
      mutateWithContract("activity.move", {
        activityIds: payload.activityIds,
        targetDate: payload.date,
        anchorId: payload.anchorId,
        mode: "preserve",
        allowNonWorking: true
      }, label);
    } else if (action === "duplicate") {
      const outcome = mutateWithContract("activity.duplicate", {
        activityIds: payload.activityIds,
        targetDate: payload.date,
        anchorId: payload.anchorId,
        allowNonWorking: true
      }, `${payload.activityIds.length} tarjeta(s) duplicada(s)`);
      clearActivitySelection();
      if (outcome.result.activityIds[0]) renderActivityDrawer(outcome.result.activityIds[0]);
    } else if (action === "extend") {
      if (payload.activityIds.length !== 1) throw new TypeError("Sólo se puede ampliar una tarjeta a la vez.");
      const outcome = mutateWithContract("activity.extend", {
        activityId: payload.activityIds[0],
        targetDate: payload.date,
        allowNonWorking: true
      }, "Actividad ampliada a otro día");
      if (outcome.result.activityId) renderActivityDrawer(outcome.result.activityId);
    }
    if (isNonWorkingDate(payload.date, payload.holidayMap)) {
      showToast("La fecha elegida es domingo o festivo. La programación se conservó por decisión manual.", {
        duration: 7500
      });
    }
  } catch (error) {
    showToast(error.message, { type: "error" });
  }
}

function updateActivityDateActionWarning() {
  const activity = appDocument.activities.find((item) => item.id === pendingTouchActivityId);
  const date = dom.activityDateActionDate.value;
  if (!activity || !date) return;
  const sameDate = activity.date === date;
  dom.touchMoveButton.disabled = sameDate;
  dom.touchExtendButton.disabled = sameDate;
  const holidays = holidayMapForYears([Number(date.slice(0, 4))], appDocument.holidayOverrides);
  const holiday = holidays.get(date);
  if (sameDate) {
    dom.activityDateActionWarning.textContent = "La fecha elegida ya pertenece a esta tarjeta. Puedes duplicarla, pero mover o ampliar no haría cambios.";
    dom.activityDateActionWarning.hidden = false;
  } else if (isNonWorkingDate(date, holidays)) {
    dom.activityDateActionWarning.textContent = holiday?.name
      ? `${holiday.name}. La operación requiere una decisión manual.`
      : "La fecha elegida es domingo. La operación requiere una decisión manual.";
    dom.activityDateActionWarning.hidden = false;
  } else {
    dom.activityDateActionWarning.hidden = true;
  }
}

function openActivityDateActionDialog(activityId) {
  const activity = appDocument.activities.find((item) => item.id === activityId);
  if (!activity || !hasEditControl) return;
  pendingTouchActivityId = activityId;
  dom.activityDateActionSummary.textContent = `Actividad del ${formatDisplayDate(activity.date)}. Elige otra fecha y luego Mover, Duplicar o Ampliar.`;
  dom.activityDateActionDate.value = addDaysISO(activity.date, 1);
  updateActivityDateActionWarning();
  openDialog("activityDateActionDialog");
}

function applyTouchDateAction(action) {
  const activity = appDocument.activities.find((item) => item.id === pendingTouchActivityId);
  const date = dom.activityDateActionDate.value;
  if (!activity || !date) return;
  const holidayMap = holidayMapForYears([Number(date.slice(0, 4))], appDocument.holidayOverrides);
  pendingDrop = {
    type: "activity",
    activityIds: [activity.id],
    anchorId: activity.id,
    date,
    holidayMap
  };
  pendingTouchActivityId = null;
  closeDialog("activityDateActionDialog");
  applyPendingDrop(action);
}

function toggleActivitySelection(activityId, force) {
  if (!hasEditControl) return;
  const shouldSelect = force ?? !selectedActivityIds.has(activityId);
  if (shouldSelect) selectedActivityIds.add(activityId);
  else selectedActivityIds.delete(activityId);
  renderCalendar();
  renderSelectionBar();
}

function markActivityCompleted(activityId) {
  try {
    mutateWithContract("activity.status", { activityId, status: "completed", scope: "single" }, "Actividad marcada como terminada");
  } catch (error) {
    showToast(error.message, { type: "error" });
  }
}

function detailItem(label, content, { wide = false } = {}) {
  const wrapper = createElement("div", `detail-item${wide ? " detail-item-wide" : ""}`);
  wrapper.append(createElement("span", "", label));
  if (content instanceof Node) wrapper.append(content);
  else wrapper.append(createElement("p", "", content || "—"));
  return wrapper;
}

function openQuarantineDialog(activityId) {
  const activity = appDocument.activities.find((item) => item.id === activityId);
  if (!activity || isQuarantineActivity(activity) || !hasEditControl) return;
  pendingQuarantineActivityId = activityId;
  const maps = lookupMaps();
  const client = maps.clients.get(activity.clientId);
  const site = maps.sites.get(activity.siteId);
  dom.quarantineSummary.textContent = `${client?.name ?? SERVICE_TYPES[activity.serviceType] ?? "Actividad"}${site?.name ? ` · ${site.name}` : ""} · ${formatDisplayDate(activity.date)}.`;
  dom.quarantineScopeFieldset.hidden = !activity.seriesId;
  dom.quarantineSeriesScopeRow.hidden = !activity.seriesId;
  dom.quarantineForm.querySelector('input[value="single"]').checked = true;
  showFormErrors(dom.quarantineErrors, []);
  openDialog("quarantineDialog");
}

function handleQuarantineSubmit(event) {
  event.preventDefault();
  const activity = appDocument.activities.find((item) => item.id === pendingQuarantineActivityId);
  if (!activity) return;
  const scope = dom.quarantineForm.querySelector('input[name="quarantineScope"]:checked')?.value ?? "single";
  if (scope === "series" && !window.confirm("Toda la actividad se convertirá en un solo Pendiente y las demás fechas se eliminarán. ¿Continuar?")) {
    return;
  }
  try {
    mutateWithContract(
      "activity.quarantine",
      { activityId: activity.id, scope },
      scope === "series" ? "Toda la actividad enviada a Pendiente" : "Tarjeta enviada a Pendiente"
    );
    pendingQuarantineActivityId = null;
    closeDialog("quarantineDialog");
    renderActivityDrawer(activity.id);
  } catch (error) {
    showFormErrors(dom.quarantineErrors, [error.message]);
  }
}

function handleQuarantineAssignSubmit(event) {
  event.preventDefault();
  const activityId = pendingQuarantineAssignId;
  const date = dom.quarantineAssignDate.value;
  if (!activityId || !parseISODateSafely(date)) {
    showFormErrors(dom.quarantineAssignErrors, ["Selecciona una fecha válida."]);
    return;
  }
  try {
    const applied = applyQuarantineAssignment(activityId, date);
    if (!applied) return;
    pendingQuarantineAssignId = null;
    closeDialog("quarantineAssignDialog");
    renderActivityDrawer(activityId);
  } catch (error) {
    showFormErrors(dom.quarantineAssignErrors, [error.message]);
  }
}

function renderActivityDrawer(activityId) {
  const activity = appDocument.activities.find((item) => item.id === activityId);
  if (!activity) {
    closeDrawer();
    return;
  }
  activeDrawer = { type: "activity", id: activityId };
  const maps = lookupMaps();
  const client = maps.clients.get(activity.clientId);
  const site = maps.sites.get(activity.siteId);
  const assigned = activity.responsibleIds.map((id) => maps.responsibles.get(id)).filter(Boolean);
  dom.drawerEyebrow.textContent = SERVICE_TYPES[activity.serviceType] ?? "Actividad";
  dom.drawerTitle.textContent = client?.name ?? (activity.serviceType === "administrative" ? "Administrativo" : "Actividad");

  const body = createElement("div", "detail-grid activity-detail-grid");
  const badgeRow = createElement("div", "responsible-chips");
  badgeRow.append(createElement("span", `status-badge ${activity.status}`, `${STATUS_ICONS[activity.status]} ${ACTIVITY_STATUSES[activity.status]}`));
  badgeRow.append(createElement("span", "service-badge", SERVICE_SHORT[activity.serviceType] ?? activity.serviceType));
  if (activity.history?.some((item) => item.action === "rescheduled")) {
    badgeRow.append(createElement("span", "chip", "↪ Reprogramada"));
  }
  body.append(badgeRow);
  body.append(detailItem(
    "Fecha",
    activity.date
      ? formatDisplayDate(activity.date, { weekday: "long" })
      : "Sin fecha · Pendiente"
  ));
  body.append(detailItem("Bandeja", PLANNING_BUCKETS[activity.planningBucket ?? "calendar"]));
  body.append(detailItem("Cliente", client?.name));
  body.append(detailItem("Sede", site?.name));
  body.append(detailItem("Ciudad", activity.city || site?.city));

  const responsibleChips = createElement("div", "responsible-chips");
  if (!assigned.length) responsibleChips.append(createElement("span", "chip", "Sin responsable"));
  for (const responsible of assigned) {
    const typeClass = responsible.responsibleType === "contractor" ? "contractor" : "payroll";
    const chip = createElement("span", `chip ${typeClass}`, responsible.name);
    chip.title = [RESPONSIBLE_TYPES[responsible.responsibleType], responsible.baseCity, responsible.company]
      .filter(Boolean)
      .join(" · ");
    responsibleChips.append(chip);
  }
  body.append(detailItem("Responsables", responsibleChips));
  body.append(detailItem("Tipo de servicio", SERVICE_TYPES[activity.serviceType]));
  body.append(detailItem("Estado", ACTIVITY_STATUSES[activity.status]));
  body.append(detailItem("Observaciones", activity.observations, { wide: true }));

  if (site?.entryConditions || site?.requiresApp != null || site?.address) {
    const operational = createElement("div");
    const lines = [
      site.address ? `Dirección: ${site.address}` : "",
      site.entryConditions ? `Ingreso: ${site.entryConditions}` : "",
      site.requiresApp === true ? "Requiere App SI&S" : site.requiresApp === false ? "No requiere App SI&S" : "Requisito de App sin confirmar"
    ].filter(Boolean);
    for (const line of lines) operational.append(createElement("p", "", line));
    body.append(detailItem("Datos operativos de sede", operational, { wide: true }));
  }
  if (Array.isArray(site?.coverageHints) && site.coverageHints.length) {
    const equipmentCount = site.coverageHints.reduce((sum, hint) => sum + (Number(hint.equipmentCount) || 0), 0);
    const groups = [...new Set(site.coverageHints.flatMap((hint) => hint.responsibleGroups ?? []))];
    const frequencies = [...new Set(site.coverageHints.flatMap((hint) => hint.frequencies ?? []))];
    const hint = [
      `${equipmentCount} equipos en la Base Operativa`,
      ...groups,
      ...frequencies
    ].join(" · ");
    body.append(detailItem("Referencia de equipos", `${hint}. Es una pista; no asigna personal automáticamente.`, { wide: true }));
  }

  const actions = createElement("div", "detail-actions");
  const edit = createElement("button", "button small", "Editar tarjeta");
  edit.type = "button";
  edit.addEventListener("click", () => openActivityDialog({ activityId }));
  const organize = createElement("button", "button small", isQuarantineActivity(activity) ? "Asignar fecha" : "Mover · Duplicar · Ampliar");
  organize.type = "button";
  organize.addEventListener("click", () => isQuarantineActivity(activity)
    ? openQuarantineAssignDialog(activityId)
    : openActivityDateActionDialog(activityId));
  if (!isQuarantineActivity(activity) && ["scheduled", "confirmed"].includes(activity.status)) {
  const quarantine = createElement("button", "button small", "Enviar a Pendiente");
    quarantine.type = "button";
    quarantine.addEventListener("click", () => openQuarantineDialog(activityId));
    actions.append(quarantine);
  }
  const remove = createElement("button", "button small ghost", "Eliminar");
  remove.type = "button";
  remove.addEventListener("click", () => deleteActivity(activityId));
  actions.append(edit, organize, remove);
  body.append(actions);

  const statusEditor = createElement("div", "detail-item detail-item-wide");
  if (isQuarantineActivity(activity)) {
    statusEditor.append(createElement("span", "", "Estado operativo"));
    statusEditor.append(createElement("p", "", "Pendiente · actividad por programar. Asigna una fecha para devolverla al calendario."));
    body.append(statusEditor);
  } else {
  statusEditor.append(createElement("span", "", "Actualizar estado"));
  const statusSelect = document.createElement("select");
  statusSelect.id = "drawerStatusSelect";
  statusSelect.setAttribute("aria-label", "Nuevo estado de la actividad");
  for (const [value, label] of Object.entries(ACTIVITY_STATUSES)) {
    if (value !== "to_schedule") statusSelect.append(option(value, label));
  }
  statusSelect.value = activity.status;
  statusSelect.style.minHeight = "36px";
  const scopeRow = createElement("div", "status-scope");
  for (const [value, label] of Object.entries(STATUS_SCOPES)) {
    if (!activity.seriesId && value !== "single") continue;
    const labelElement = createElement("label", "radio-row");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "drawerStatusScope";
    input.value = value;
    input.checked = value === "single";
    labelElement.append(input, createElement("span", "", label));
    scopeRow.append(labelElement);
  }
  const apply = createElement("button", "button primary small", "Aplicar estado");
  apply.type = "button";
  apply.addEventListener("click", () => {
    const scope = scopeRow.querySelector("input:checked")?.value ?? "single";
    updateActivityStatus(activityId, statusSelect.value, scope);
  });
  statusEditor.append(statusSelect, scopeRow, apply);
  body.append(statusEditor);
  }

  if (activity.seriesId) {
    const seriesItems = appDocument.activities
      .filter((item) => item.seriesId === activity.seriesId)
      .sort((a, b) => compareISODate(a.date, b.date));
    body.append(detailItem(
      "Actividad multidía",
      `${seriesItems.length} tarjetas independientes · ${formatDisplayDate(seriesItems[0].date)} a ${formatDisplayDate(seriesItems.at(-1).date)}`,
      { wide: true }
    ));
  }

  if (activity.history?.length) {
    const list = createElement("ol", "history-list");
    for (const item of [...activity.history].reverse().slice(0, 20)) {
      list.append(createElement("li", "", `${timestampLabel(item.at)} · ${item.detail}`));
    }
    body.append(detailItem("Historial", list, { wide: true }));
  }
  dom.drawerBody.replaceChildren(body);
  openDrawer();
}

function renderDayDrawer(date) {
  activeDrawer = { type: "day", date };
  dom.drawerEyebrow.textContent = "Agenda del día";
  dom.drawerTitle.textContent = formatDisplayDate(date, { weekday: "long" });
  const maps = lookupMaps();
  const items = appDocument.activities
    .filter((activity) => !isQuarantineActivity(activity) && activity.date === date)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const body = createElement("div", "detail-grid day-detail-grid");
  if (!items.length) body.append(createElement("p", "", "No hay actividades programadas."));
  for (const activity of items) {
    const card = buildActivityCard(activity, maps);
    card.draggable = false;
    body.append(card);
  }
  const add = createElement("button", "button primary", "Nueva actividad en esta fecha");
  add.type = "button";
  add.addEventListener("click", () => openActivityDialog({ date }));
  body.append(add);
  dom.drawerBody.replaceChildren(body);
  openDrawer();
}

function updateActivityStatus(activityId, status, scope) {
  try {
    const count = activityIdsForScope(appDocument, activityId, scope).length;
    mutateWithContract("activity.status", { activityId, status, scope }, `Estado actualizado en ${count} tarjeta${count === 1 ? "" : "s"}`);
  } catch (error) {
    showToast(error.message, { type: "error" });
  }
}

function deleteActivity(activityId) {
  const activity = appDocument.activities.find((item) => item.id === activityId);
  if (!activity) return;
  if (!window.confirm("¿Eliminar esta tarjeta? Las demás fechas de la actividad multidía no se modificarán.")) return;
  mutateWithContract("activity.delete", { activityIds: [activityId] }, "Tarjeta eliminada");
  selectedActivityIds.delete(activityId);
  refreshSelectionUi();
  closeDrawer();
}

function populateActivitySelects({ clientId = "", siteId = "", responsibleIds = [] } = {}) {
  const clients = appDocument.catalog.clients
    .filter((item) => item.active !== false || item.id === clientId)
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
  setChildren(
    dom.activityClient,
    option("", "Selecciona un cliente"),
    ...clients.map((item) => option(item.id, item.name))
  );
  dom.activityClient.value = clientId || "";
  populateSiteSelect(clientId, siteId);

  setChildren(
    dom.citySuggestions,
    ...[...new Set([
      ...appDocument.catalog.cities.map((item) => item.name),
      ...appDocument.catalog.sites.map((item) => item.city),
      ...appDocument.catalog.responsibles.map((item) => item.baseCity)
    ].filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "es"))
      .map((city) => option(city, city))
  );
  renderResponsiblePicker(responsibleIds);
}

function populateSiteSelect(clientId, selectedSiteId = "") {
  const sites = appDocument.catalog.sites
    .filter((site) => (!clientId || site.clientId === clientId))
    .filter((site) => site.active !== false || site.id === selectedSiteId)
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
  setChildren(
    dom.activitySite,
    option("", clientId ? "Selecciona una sede" : "Selecciona primero un cliente"),
    ...sites.map((site) => option(site.id, `${site.name}${site.city ? ` · ${site.city}` : ""}`))
  );
  dom.activitySite.value = sites.some((site) => site.id === selectedSiteId) ? selectedSiteId : "";
}

function responsibleScore(responsible, city) {
  const target = normalizeText(city);
  if (!target) return 9;
  if (normalizeText(responsible.baseCity) === target) return 0;
  if ((responsible.coverage ?? []).some((item) => normalizeText(item) === target)) return 1;
  if (normalizeText(responsible.group).includes(target)) return 2;
  if (normalizeText(responsible.baseCity) === "nacional" || normalizeText(responsible.group) === "nacional") return 3;
  return 9;
}

function renderResponsiblePicker(selectedIds = null) {
  const checked = new Set(
    selectedIds ?? [...dom.responsiblePicker.querySelectorAll("input:checked")].map((input) => input.value)
  );
  const city = dom.activityCity.value;
  const query = normalizeText(dom.responsibleSearch?.value || "");
  const active = appDocument.catalog.responsibles
    .filter((item) => item.active !== false || checked.has(item.id))
    .filter((item) => {
      if (!query) return true;
      if (checked.has(item.id)) return true;
      return normalizeText([
        item.name,
        item.baseCity,
        item.group,
        item.company,
        ...(item.coverage ?? []),
        ...(item.responsibleGroups ?? [])
      ].filter(Boolean).join(" ")).includes(query);
    })
    .sort((a, b) => {
      const score = responsibleScore(a, city) - responsibleScore(b, city);
      if (score) return score;
      if (Boolean(a.favorite) !== Boolean(b.favorite)) return a.favorite ? -1 : 1;
      return a.name.localeCompare(b.name, "es");
    });
  const groups = [
    ["payroll", "Personal de nómina"],
    ["contractor", "Contratistas"]
  ];
  const fragment = document.createDocumentFragment();
  for (const [type, title] of groups) {
    const group = createElement("section", "responsible-group");
    group.append(createElement("h4", "", title));
    const items = active.filter((item) => item.responsibleType === type);
    if (!items.length) group.append(createElement("p", "field-note", query ? "Sin coincidencias." : "Sin registros activos."));
    for (const responsible of items) {
      const score = responsibleScore(responsible, city);
      const label = createElement("label", `responsible-option ${score < 4 ? "recommended" : ""}`.trim());
      const input = document.createElement("input");
      input.type = "checkbox";
      input.name = "responsibleIds";
      input.value = responsible.id;
      input.checked = checked.has(responsible.id);
      const copyBlock = createElement("span");
      copyBlock.append(createElement("strong", "", `${responsible.favorite ? "★ " : ""}${responsible.name}`));
      copyBlock.append(createElement("small", "", [
        responsible.baseCity,
        responsible.group,
        score < 4 ? "Sugerido para esta ciudad" : ""
      ].filter(Boolean).join(" · ")));
      label.append(input, copyBlock);
      group.append(label);
    }
    fragment.append(group);
  }
  dom.responsiblePicker.dataset.filteredCount = String(active.length);
  dom.responsiblePicker.replaceChildren(fragment);
}

function scheduleResponsiblePickerRender() {
  if (responsibleRenderTimer != null) clearTimeout(responsibleRenderTimer);
  responsibleRenderTimer = setTimeout(() => {
    responsibleRenderTimer = null;
    renderResponsiblePicker();
  }, 120);
}

function syncActivityLocationFromSite() {
  const site = appDocument.catalog.sites.find((item) => item.id === dom.activitySite.value);
  if (site) {
    dom.activityClient.value = site.clientId || dom.activityClient.value;
    dom.activityCity.value = site.city || dom.activityCity.value;
  }
  renderResponsiblePicker();
}

function setActivityFormMode(mode, planningBucket = "calendar") {
  const editing = mode === "edit";
  dom.activityDialog.dataset.mode = mode;
  dom.activityDialog.dataset.planningBucket = planningBucket;
  dom.activityDialogTitle.textContent = editing ? "Editar tarjeta" : "Nueva actividad";
  dom.activityDialogEyebrow.textContent = planningBucket === "quarantine"
    ? "Bandeja Pendiente"
    : editing
      ? "Edición individual"
      : "Programación";
  const quarantined = planningBucket === "quarantine";
  dom.activityScheduleSection.hidden = quarantined;
  dom.activityDate.required = !quarantined;
  dom.activityDate.disabled = quarantined;
  dom.activityEndDate.disabled = quarantined || editing;
  dom.endDateLabel.hidden = editing || quarantined;
  dom.includeNonWorkingLabel.hidden = editing || quarantined;
  dom.rangePreview.hidden = editing || quarantined;
  dom.activityStatus.value = quarantined ? "to_schedule" : dom.activityStatus.value;
  dom.activityStatus.disabled = quarantined;
  dom.saveActivityButton.textContent = quarantined && !editing
    ? "Guardar pendiente"
    : editing
      ? "Guardar cambios"
      : "Guardar actividad";
}

function openActivityDialog({ date = todayInBogota(), clientId = "", siteId = "", activityId = "", duplicateId = "", planningBucket = "calendar" } = {}) {
  dom.activityForm.reset();
  showFormErrors(dom.activityFormErrors, []);
  forcedRangeDates = new Set();
  const source = activityId
    ? appDocument.activities.find((item) => item.id === activityId)
    : duplicateId
      ? appDocument.activities.find((item) => item.id === duplicateId)
      : null;
  const mode = activityId ? "edit" : "create";
  const bucket = source?.planningBucket ?? planningBucket;
  setActivityFormMode(mode, bucket);
  dom.activityId.value = activityId;
  dom.activityDate.value = source?.date ?? (bucket === "quarantine" ? "" : date);
  dom.activityEndDate.value = "";
  dom.includeNonWorking.checked = false;
  dom.activityServiceType.value = source?.serviceType ?? "preventive";
  dom.activityStatus.value = source?.status ?? (bucket === "quarantine" ? "to_schedule" : "scheduled");
  dom.activityCity.value = source?.city ?? "";
  dom.activityObservations.value = source?.observations ?? "";
  const resolvedClient = source?.clientId ?? clientId;
  const resolvedSite = source?.siteId ?? siteId;
  populateActivitySelects({
    clientId: resolvedClient,
    siteId: resolvedSite,
    responsibleIds: source?.responsibleIds ?? []
  });
  const linked = Boolean(source?.seriesId);
  dom.activityEditScopePanel.hidden = !(mode === "edit" && linked);
  dom.activityEditScope.value = "single";
  dom.activityEditStatusScope.value = "single";
  if (!source && resolvedSite) syncActivityLocationFromSite();
  updateAdministrativeFormState();
  updateRangePreview();
  openDialog("activityDialog");
}

function updateAdministrativeFormState() {
  const administrative = dom.activityServiceType.value === "administrative";
  dom.administrativeNote.hidden = !administrative;
  const quarantined = dom.activityDialog.dataset.planningBucket === "quarantine";
  dom.activityStatus.value = quarantined ? "to_schedule" : dom.activityStatus.value;
  dom.activityStatus.disabled = quarantined;
}

function updateRangePreview() {
  if (dom.activityDialog.dataset.mode === "edit") return;
  const startDate = dom.activityDate.value;
  const endDate = dom.activityEndDate.value || startDate;
  if (!startDate || !endDate || compareISODate(endDate, startDate) < 0) {
    dom.rangePreview.hidden = true;
    dom.rangePreview.replaceChildren();
    return;
  }
  const holidays = holidayMapForRange(startDate, endDate, appDocument.holidayOverrides);
  const result = generateSeriesDates(startDate, endDate, holidays, {
    includeAllNonWorking: dom.includeNonWorking.checked,
    forceIncludeDates: [...forcedRangeDates]
  });
  const wrapper = createElement("div");
  wrapper.append(createElement("strong", "", `${result.included.length} tarjeta${result.included.length === 1 ? "" : "s"} se crearán.`));
  if (result.omitted.length) {
    wrapper.append(createElement("p", "", `${result.omitted.length} fecha${result.omitted.length === 1 ? "" : "s"} no laborable${result.omitted.length === 1 ? "" : "s"} se omitirán:`));
    for (const item of result.omitted) {
      const label = createElement("label", "check-row");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.forceDate = item.date;
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) forcedRangeDates.add(item.date);
        else forcedRangeDates.delete(item.date);
        updateRangePreview();
      });
      label.append(
        checkbox,
        createElement("span", "", `${formatDisplayDate(item.date, { weekday: "long" })}: ${item.reason}. Incluir sólo esta fecha`)
      );
      wrapper.append(label);
    }
  }
  dom.rangePreview.replaceChildren(wrapper);
  dom.rangePreview.hidden = startDate === endDate && !result.omitted.length;
}

function activityInputFromForm() {
  const responsibleIds = [...dom.responsiblePicker.querySelectorAll("input:checked")].map((input) => input.value);
  return {
    date: dom.activityDialog.dataset.planningBucket === "quarantine" ? null : dom.activityDate.value,
    endDate: dom.activityDialog.dataset.planningBucket === "quarantine"
      ? null
      : dom.activityEndDate.value || dom.activityDate.value,
    planningBucket: dom.activityDialog.dataset.planningBucket || "calendar",
    includeNonWorking: dom.includeNonWorking.checked,
    forceIncludeDates: [...forcedRangeDates],
    clientId: dom.activityClient.value || null,
    siteId: dom.activitySite.value || null,
    city: safeText(dom.activityCity.value, 120) || null,
    responsibleIds,
    serviceType: dom.activityServiceType.value,
    status: dom.activityDialog.dataset.planningBucket === "quarantine" ? "to_schedule" : dom.activityStatus.value,
    observations: safeText(dom.activityObservations.value, 5000)
  };
}

function validateActivityInput(input) {
  const candidate = {
    ...input,
    date: input.planningBucket === "quarantine" ? null : input.date,
    planningBucket: input.planningBucket,
    status: input.planningBucket === "quarantine" ? "to_schedule" : input.status,
    responsibleIds: input.responsibleIds
  };
  const errors = validateActivity(candidate);
  if (input.planningBucket !== "quarantine" && input.endDate && input.date && compareISODate(input.endDate, input.date) < 0) {
    errors.push("La fecha final no puede ser anterior a la inicial.");
  }
  return [...new Set(errors)];
}

function handleActivitySubmit(event) {
  event.preventDefault();
  const input = activityInputFromForm();
  const errors = validateActivityInput(input);
  if (errors.length) {
    showFormErrors(dom.activityFormErrors, errors);
    return;
  }
  if (dom.activityDialog.dataset.mode === "edit") {
    const activityId = dom.activityId.value;
    const existing = appDocument.activities.find((item) => item.id === activityId);
    if (!existing) {
      showFormErrors(dom.activityFormErrors, ["La actividad ya no existe."]);
      return;
    }
    try {
      mutateWithContract("activity.edit", {
        activityId,
        commonScope: existing.seriesId ? dom.activityEditScope.value : "single",
        statusScope: existing.seriesId ? dom.activityEditStatusScope.value : "single",
        allowNonWorking: true,
        patch: {
          date: input.date,
          planningBucket: input.planningBucket,
          clientId: input.clientId,
          siteId: input.siteId,
          city: input.city,
          responsibleIds: [...input.responsibleIds],
          serviceType: input.serviceType,
          status: input.status,
          observations: input.observations
        }
      }, "Tarjeta actualizada");
      closeDialog("activityDialog");
      renderActivityDrawer(activityId);
    } catch (error) {
      showFormErrors(dom.activityFormErrors, [error.message]);
    }
    return;
  }

  try {
    const outcome = mutateWithContract("activity.create", input, "Actividad creada");
    closeDialog("activityDialog");
    renderActivityDrawer(outcome.result.activityIds[0]);
  } catch (error) {
    showFormErrors(dom.activityFormErrors, [error.message]);
  }
}

function populateCatalogClientSelect(selected = "") {
  setChildren(
    dom.catalogSiteClient,
    option("", "Selecciona un cliente"),
    ...appDocument.catalog.clients
      .filter((item) => item.active !== false || item.id === selected)
      .sort((a, b) => a.name.localeCompare(b.name, "es"))
      .map((item) => option(item.id, item.name))
  );
  dom.catalogSiteClient.value = selected;
}

function setCatalogFieldVisibility(type) {
  dom.clientFields.hidden = type !== "client";
  dom.siteFields.hidden = type !== "site";
  dom.responsibleFields.hidden = type !== "responsible";
}

function openCatalogDialog(type = "client", itemId = "") {
  dom.catalogForm.reset();
  dom.catalogActive.checked = true;
  dom.catalogItemId.value = itemId;
  dom.catalogType.value = type;
  dom.catalogType.disabled = Boolean(itemId);
  setCatalogFieldVisibility(type);
  showFormErrors(dom.catalogFormErrors, []);
  let item = null;
  if (type === "client") item = appDocument.catalog.clients.find((candidate) => candidate.id === itemId);
  if (type === "site") item = appDocument.catalog.sites.find((candidate) => candidate.id === itemId);
  if (type === "responsible") item = appDocument.catalog.responsibles.find((candidate) => candidate.id === itemId);
  dom.catalogDialogTitle.textContent = item ? "Editar registro" : "Nuevo registro";

  if (type === "client") {
    dom.catalogClientName.value = item?.name ?? "";
  } else if (type === "site") {
    populateCatalogClientSelect(item?.clientId ?? "");
    dom.catalogSiteName.value = item?.name ?? "";
    dom.catalogSiteCity.value = item?.city ?? "";
    dom.catalogSiteZone.value = item?.zone ?? "";
    dom.catalogSiteCenter.value = item?.shoppingCenter ?? "";
    dom.catalogSiteAddress.value = item?.address ?? "";
    dom.catalogSiteEntry.value = item?.entryConditions ?? "";
    dom.catalogSiteApp.checked = item?.requiresApp === true;
  } else {
    dom.catalogResponsibleName.value = item?.name ?? "";
    dom.catalogResponsibleType.value = item?.responsibleType ?? "payroll";
    dom.catalogResponsibleCompany.value = item?.company ?? "";
    dom.catalogResponsibleCity.value = item?.baseCity ?? "";
    dom.catalogResponsibleGroup.value = item?.group ?? "";
    dom.catalogResponsibleInitials.value = item?.initials ?? "";
    dom.catalogResponsibleCoverage.value = (item?.coverage ?? []).join(", ");
    dom.catalogResponsibleFavorite.checked = Boolean(item?.favorite);
  }
  dom.catalogActive.checked = item?.active !== false;
  openDialog("catalogDialog");
}

function handleCatalogSubmit(event) {
  event.preventDefault();
  const type = dom.catalogType.value;
  const itemId = dom.catalogItemId.value;
  const errors = [];
  if (type === "client" && !safeText(dom.catalogClientName.value, 160)) errors.push("Escribe el nombre del cliente.");
  if (type === "site") {
    if (!dom.catalogSiteClient.value) errors.push("Selecciona el cliente de la sede.");
    if (!safeText(dom.catalogSiteName.value, 160)) errors.push("Escribe el nombre de la sede.");
  }
  if (type === "responsible" && !safeText(dom.catalogResponsibleName.value, 160)) {
    errors.push("Escribe el nombre del responsable.");
  }
  if (errors.length) {
    showFormErrors(dom.catalogFormErrors, errors);
    return;
  }

  let values;
  if (type === "client") {
    values = { name: safeText(dom.catalogClientName.value, 160), active: dom.catalogActive.checked };
  } else if (type === "site") {
    values = {
      clientId: dom.catalogSiteClient.value,
      name: safeText(dom.catalogSiteName.value, 160),
      city: safeText(dom.catalogSiteCity.value, 120) || null,
      zone: safeText(dom.catalogSiteZone.value, 120) || null,
      shoppingCenter: safeText(dom.catalogSiteCenter.value, 160) || null,
      address: safeText(dom.catalogSiteAddress.value, 240) || null,
      entryConditions: safeText(dom.catalogSiteEntry.value, 1000) || null,
      requiresApp: dom.catalogSiteApp.checked,
      active: dom.catalogActive.checked
    };
  } else {
    values = {
      name: safeText(dom.catalogResponsibleName.value, 160),
      responsibleType: dom.catalogResponsibleType.value,
      company: safeText(dom.catalogResponsibleCompany.value, 160) || null,
      baseCity: safeText(dom.catalogResponsibleCity.value, 120) || null,
      group: safeText(dom.catalogResponsibleGroup.value, 120) || null,
      initials: safeText(dom.catalogResponsibleInitials.value, 5).toUpperCase() || displayInitialsFor(dom.catalogResponsibleName.value),
      coverage: safeText(dom.catalogResponsibleCoverage.value, 500)
        .split(",")
        .map((value) => safeText(value, 120))
        .filter(Boolean),
      favorite: dom.catalogResponsibleFavorite.checked,
      active: dom.catalogActive.checked
    };
  }
  mutateWithContract("catalog.upsert", { type, ...(itemId ? { id: itemId } : {}), values }, itemId ? "Registro del catálogo actualizado" : "Registro agregado al catálogo");
  closeDialog("catalogDialog");
  if (type === "responsible" && dom.activityDialog.open) {
    renderResponsiblePicker([...dom.responsiblePicker.querySelectorAll("input:checked")].map((input) => input.value));
  }
}

function renderHolidayDialog() {
  const { year } = currentMonthParts();
  dom.holidayYearTitle.textContent = `Festivos calculados de ${year}`;
  const holidays = colombianHolidays(year, appDocument.holidayOverrides);
  const holidayFragment = document.createDocumentFragment();
  for (const holiday of holidays.filter((item) => item.occurrences.length)) {
    const row = createElement("div", "holiday-row");
    row.append(createElement("time", "", holiday.date.slice(5)));
    const copyBlock = createElement("span", "catalog-main");
    copyBlock.append(createElement("strong", "", holiday.name));
    const nominal = holiday.occurrences
      .filter((item) => item.shifted)
      .map((item) => `${item.label}: ${item.nominalDate}`)
      .join(" · ");
    copyBlock.append(createElement("small", "", [
      nominal ? `Trasladado (${nominal})` : "Fecha observada",
      holiday.allowScheduling ? "Programación habilitada manualmente" : ""
    ].filter(Boolean).join(" · ")));
    row.append(copyBlock);
    row.append(createElement("span", "chip", holiday.sources.join(" · ")));
    holidayFragment.append(row);
  }
  dom.holidayList.replaceChildren(holidayFragment);

  const overrideFragment = document.createDocumentFragment();
  const overrides = [...appDocument.holidayOverrides].sort((a, b) => compareISODate(a.date, b.date));
  for (const override of overrides) {
    const row = createElement("div", "override-row");
    row.append(createElement("time", "", override.date));
    const copyBlock = createElement("span", "catalog-main");
    copyBlock.append(createElement("strong", "", override.name));
    copyBlock.append(createElement("small", "", [
      override.type === "allow-scheduling" ? "Programación habilitada" : "Cierre adicional",
      override.reason
    ].filter(Boolean).join(" · ")));
    row.append(copyBlock);
    const remove = createElement("button", "mini-edit", "×");
    remove.type = "button";
    remove.title = "Eliminar excepción";
    remove.setAttribute("aria-label", `Eliminar excepción ${override.name}`);
    remove.addEventListener("click", () => {
      mutateWithContract("holiday.delete", { overrideId: override.id }, "Excepción eliminada");
      renderHolidayDialog();
    });
    row.append(remove);
    overrideFragment.append(row);
  }
  if (!overrides.length) {
    overrideFragment.append(createElement("p", "field-note", "No hay excepciones manuales."));
  }
  dom.overrideList.replaceChildren(overrideFragment);
}

function handleHolidaySubmit(event) {
  event.preventDefault();
  const override = {
    date: dom.overrideDate.value,
    type: dom.overrideType.value,
    name: safeText(dom.overrideName.value, 120),
    reason: safeText(dom.overrideReason.value, 500),
  };
  const errors = validateHolidayOverride({ ...override, id: "preview" });
  if (appDocument.holidayOverrides.some((item) => item.active !== false && item.date === override.date)) {
    errors.push("Ya existe una excepción activa para esta fecha.");
  }
  if (errors.length) {
    showFormErrors(dom.holidayFormErrors, errors);
    return;
  }
  mutateWithContract("holiday.add", override, "Excepción de calendario agregada");
  dom.overrideDate.value = "";
  dom.overrideName.value = "";
  dom.overrideReason.value = "";
  showFormErrors(dom.holidayFormErrors, []);
  renderHolidayDialog();
}

function openBulkMoveDialog() {
  const activities = [...selectedActivityIds]
    .map((id) => appDocument.activities.find((item) => item.id === id))
    .filter(Boolean)
    .sort((a, b) => compareISODate(a.date, b.date));
  if (!activities.length) return;
  dom.bulkMoveSummary.textContent = `${activities.length} tarjetas seleccionadas. La referencia será ${formatDisplayDate(activities[0].date)}.`;
  dom.bulkMoveDate.value = activities[0].date;
  updateBulkMoveWarning();
  openDialog("bulkMoveDialog");
}

function updateBulkMoveWarning() {
  const target = dom.bulkMoveDate.value;
  if (!target) {
    dom.bulkMoveWarning.hidden = true;
    return;
  }
  const holidays = holidayMapForRange(target, target, appDocument.holidayOverrides);
  const holiday = holidays.get(target);
  const nonWorking = isNonWorkingDate(target, holidays);
  if (nonWorking) {
    dom.bulkMoveWarning.textContent = holiday?.name
      ? `La fecha de referencia es festiva: ${holiday.name}. Puedes conservarla como decisión manual.`
      : "La fecha de referencia es domingo. Puedes conservarla como decisión manual.";
    dom.bulkMoveWarning.hidden = false;
  } else {
    dom.bulkMoveWarning.hidden = true;
  }
}

function handleBulkMoveSubmit(event) {
  event.preventDefault();
  const activities = [...selectedActivityIds]
    .map((id) => appDocument.activities.find((item) => item.id === id))
    .filter(Boolean)
    .sort((a, b) => compareISODate(a.date, b.date));
  if (!activities.length) return;
  const mode = dom.bulkMoveForm.elements.moveMode.value;
  try {
    mutateWithContract("activity.move", {
      activityIds: activities.map((item) => item.id),
      targetDate: dom.bulkMoveDate.value,
      anchorId: activities[0].id,
      mode,
      allowNonWorking: true
    }, `${activities.length} tarjetas movidas`);
    clearActivitySelection();
    closeDialog("bulkMoveDialog");
  } catch (error) {
    showToast(error.message, { type: "error" });
  }
}

function openBulkStatusDialog() {
  if (!selectedActivityIds.size) return;
  dom.bulkStatusSummary.textContent = `${selectedActivityIds.size} tarjetas seleccionadas. El cambio sólo afectará esas tarjetas.`;
  setChildren(
    dom.bulkStatusValue,
    ...Object.entries(ACTIVITY_STATUSES)
      .filter(([value]) => value !== "to_schedule")
      .map(([value, label]) => option(value, label))
  );
  openDialog("bulkStatusDialog");
}

function handleBulkStatusSubmit(event) {
  event.preventDefault();
  const status = dom.bulkStatusValue.value;
  const activities = appDocument.activities.filter((item) => selectedActivityIds.has(item.id));
  if (status === "confirmed" && activities.some((item) => !item.responsibleIds.length)) {
    showToast("No se puede confirmar una selección que contiene tarjetas sin responsables.", { type: "error" });
    return;
  }
  mutateWithContract("activity.bulk-edit", {
    activityIds: activities.map((activity) => activity.id),
    field: "status",
    value: status,
    mode: "replace"
  }, `Estado actualizado en ${activities.length} tarjetas`);
  clearActivitySelection();
  closeDialog("bulkStatusDialog");
}

function selectedActivities() {
  return appDocument.activities.filter((activity) => selectedActivityIds.has(activity.id));
}

function renderBulkEditControls() {
  const field = dom.bulkEditField.value;
  const requestedMode = dom.bulkEditMode.value;
  dom.bulkEditSelect.hidden = true;
  dom.bulkEditText.hidden = true;
  dom.bulkEditTextarea.hidden = true;
  dom.bulkResponsiblePicker.hidden = true;
  dom.bulkEditModeLabel.hidden = ["serviceType", "status"].includes(field);
  const modes = field === "responsibleIds"
    ? [["replace", "Reemplazar"], ["add", "Agregar"], ["remove", "Quitar"]]
    : field === "city"
      ? [["replace", "Reemplazar"], ["clear", "Vaciar"]]
      : field === "observations"
        ? [["replace", "Reemplazar"], ["append", "Agregar al final"], ["clear", "Vaciar"]]
        : [["replace", "Reemplazar"]];
  setChildren(dom.bulkEditMode, ...modes.map(([value, label]) => option(value, label)));
  if (modes.some(([value]) => value === requestedMode)) dom.bulkEditMode.value = requestedMode;
  if (field === "serviceType") {
    dom.bulkEditSelect.hidden = false;
    setChildren(dom.bulkEditSelect, ...Object.entries(SERVICE_TYPES).map(([value, label]) => option(value, label)));
  } else if (field === "status") {
    dom.bulkEditSelect.hidden = false;
    setChildren(
      dom.bulkEditSelect,
      ...Object.entries(ACTIVITY_STATUSES)
        .filter(([value]) => value !== "to_schedule")
        .map(([value, label]) => option(value, label))
    );
  } else if (field === "responsibleIds") {
    dom.bulkResponsiblePicker.hidden = false;
    const fragment = document.createDocumentFragment();
    for (const responsible of appDocument.catalog.responsibles
      .filter((item) => item.active !== false)
      .sort((a, b) => a.name.localeCompare(b.name, "es"))) {
      const label = createElement("label", "check-row");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = responsible.id;
      label.append(input, createElement("span", "", `${responsible.name} · ${RESPONSIBLE_TYPES[responsible.responsibleType] ?? responsible.responsibleType}`));
      fragment.append(label);
    }
    dom.bulkResponsiblePicker.replaceChildren(createElement("legend", "", "Responsables"), fragment);
  } else if (field === "city") {
    dom.bulkEditText.hidden = false;
    dom.bulkEditValueTitle.textContent = "Ciudad";
  } else {
    dom.bulkEditTextarea.hidden = false;
    dom.bulkEditValueTitle.textContent = "Observaciones";
  }
  const clearMode = dom.bulkEditMode.value === "clear";
  dom.bulkEditValueLabel.hidden = clearMode || field === "responsibleIds";
}

function openBulkEditDialog() {
  if (!selectedActivityIds.size) return;
  dom.bulkEditSummary.textContent = `${selectedActivityIds.size} tarjetas seleccionadas. La operación será atómica: si una tarjeta no es válida, no cambiará ninguna.`;
  dom.bulkEditField.value = "serviceType";
  dom.bulkEditText.value = "";
  dom.bulkEditTextarea.value = "";
  showFormErrors(dom.bulkEditErrors, []);
  renderBulkEditControls();
  openDialog("bulkEditDialog");
}

function handleBulkEditSubmit(event) {
  event.preventDefault();
  const field = dom.bulkEditField.value;
  const mode = dom.bulkEditMode.value || "replace";
  const ids = [...selectedActivityIds];
  let value = dom.bulkEditSelect.value;
  if (field === "responsibleIds") {
    value = [...dom.bulkResponsiblePicker.querySelectorAll("input:checked")].map((input) => input.value);
  } else if (field === "city") {
    value = dom.bulkEditText.value;
  } else if (field === "observations") {
    value = dom.bulkEditTextarea.value;
  }
  try {
    mutateWithContract("activity.bulk-edit", { activityIds: ids, field, value, mode }, `${BULK_EDIT_FIELDS[field]} actualizado en ${ids.length} tarjetas`);
    clearActivitySelection();
    closeDialog("bulkEditDialog");
  } catch (error) {
    showFormErrors(dom.bulkEditErrors, [error.message]);
  }
}

function deleteSelectedActivities() {
  const activities = selectedActivities();
  if (!activities.length) return;
  if (!window.confirm(`¿Eliminar ${activities.length} tarjeta(s) seleccionada(s)? Podrás deshacer esta operación una vez.`)) return;
  try {
    mutateWithContract("activity.delete", { activityIds: activities.map((activity) => activity.id) }, `${activities.length} tarjetas eliminadas`);
    clearActivitySelection();
    closeDrawer();
  } catch (error) {
    showToast(error.message, { type: "error" });
  }
}

async function createBackup() {
  appDocument.settings.lastBackupAt = new Date().toISOString();
  appendAudit("backup_created", "Respaldo JSON descargado");
  renderBackupReminder();
  await scheduleSave({ immediate: true });
  const fileIdentity = normalizeKey(appDocument.calendarMeta.coordinator || appDocument.calendarMeta.name) || "cronograma";
  const envelope = createBackupEnvelope(appDocument, {
    exportedAt: appDocument.settings.lastBackupAt,
    origin: `${runtimeMode()} · ${location.origin}`,
    channel: RUNTIME_CHANNEL
  });
  downloadBlob(
    JSON.stringify(envelope, null, 2),
    "application/json;charset=utf-8",
    `${timestampForFile()}_respaldo-cronograma_${fileIdentity}.json`
  );
  showToast("Copia del cronograma descargada.");
}

function openResetDataDialog() {
  dom.resetDataForm.reset();
  showFormErrors(dom.resetDataErrors, []);
  openDialog("resetDataDialog");
}

async function handleResetDataSubmit(event) {
  event.preventDefault();
  if (dom.resetConfirmation.value.trim() !== "REINICIAR") {
    showFormErrors(dom.resetDataErrors, ["Escribe REINICIAR exactamente para confirmar."]);
    return;
  }
  try {
    await createBackup();
    await flushSave();
    await clearStoredDocuments();
    appDocument = createDefaultDocument();
    appDocument.appVersion = APP_VERSION;
    undoSnapshot = null;
    selectedActivityIds.clear();
    activeDrawer = null;
    if (dom.resetPreferences.checked) {
      localStorage.removeItem(UI_PREFERENCES_KEY);
      applyCatalogPreference();
      applyThemePreference();
    }
    if (storageAvailable) await replaceCurrentDocument(clone(appDocument));
    editChannel?.postMessage({ type: "data-reset", ownerId: tabId });
    closeDialog("resetDataDialog");
    closeDrawer();
    renderAll();
    setSaveIndicator(
      storageAvailable ? "saved" : "error",
      storageAvailable ? (CLOUD_MODE ? "Guardado en Supabase" : "Guardado") : (CLOUD_MODE ? "Sin conexión con Supabase" : "Sin guardado local")
    );
    showToast("Los datos persistentes se reiniciaron. El respaldo quedó en Descargas.", { duration: 8500 });
  } catch (error) {
    showFormErrors(dom.resetDataErrors, [`No se pudo reiniciar: ${error.message}`]);
  }
}

function exportCurrentMonthCsv() {
  const { year, month } = currentMonthParts();
  const csv = executeCalendarOperation(appDocument, {
    operation: "calendar.export-csv",
    payload: { year, month }
  }).result.content;
  const fileMonth = `${year}-${String(month).padStart(2, "0")}`;
  const identity = normalizeKey(appDocument.calendarMeta.name) || "cronograma";
  downloadBlob(csv, "text/csv;charset=utf-8", `${fileMonth}_programacion_${identity}.csv`);
  appendAudit("csv_exported", `Mes exportado: ${fileMonth}`);
  scheduleSave();
  showToast(`Listado de ${formatMonthTitle(year, month)} descargado.`);
}

function exportQuarantineCsv() {
  const csv = buildQuarantineCsv(appDocument);
  const identity = normalizeKey(appDocument.calendarMeta.name) || "cronograma";
  downloadBlob(csv, "text/csv;charset=utf-8", `pendientes_${identity}.csv`);
  appendAudit("quarantine_csv_exported", "Listado de pendientes descargado");
  scheduleSave();
  showToast("Listado de pendientes descargado.");
}

function canvasText(context, text, x, y, maxWidth, { font = "24px Arial", color = "#1e2a21", bold = false } = {}) {
  context.font = `${bold ? "700 " : ""}${font}`;
  context.fillStyle = color;
  const value = safeText(text, 500);
  if (context.measureText(value).width <= maxWidth) {
    context.fillText(value, x, y);
    return value;
  }
  let shortened = value;
  while (shortened.length > 1 && context.measureText(`${shortened}…`).width > maxWidth) {
    shortened = shortened.slice(0, -1);
  }
  context.fillText(`${shortened}…`, x, y);
  return shortened;
}

async function exportCurrentMonthImage() {
  const { year, month } = currentMonthParts();
  const darkExport = document.documentElement.dataset.theme === "dark";
  const palette = darkExport
    ? {
        page: "#101713", header: "#315f35", headerText: "#f4faf5", headerSubtle: "#d7ead9",
        meta: "#c4cec6", weekday: "#27352b", day: "#1b241e", nonWorking: "#3a281f",
        outside: "#151c17", grid: "#465247", text: "#edf4ee", secondary: "#c1ccc3", holiday: "#ffc196"
      }
    : {
        page: "#f5f7f3", header: "#4f7d32", headerText: "#ffffff", headerSubtle: "#eaf2e6",
        meta: "#465148", weekday: "#e4ebe0", day: "#ffffff", nonWorking: "#fff0e7",
        outside: "#eef1ed", grid: "#cfd8cf", text: "#1e2a21", secondary: "#566057", holiday: "#9a4e1e"
      };
  const dates = monthGridDates(year, month);
  const maps = lookupMaps();
  const filtered = appDocument.activities.filter((activity) =>
    dates.includes(activity.date) && matchesActivityFilters(activity, maps)
  );
  const byDate = new Map();
  for (const activity of filtered) {
    const list = byDate.get(activity.date) ?? [];
    list.push(activity);
    byDate.set(activity.date, list);
  }
  const weekHeights = Array.from({ length: 6 }, (_, week) => {
    const maxCards = Math.max(...dates.slice(week * 7, week * 7 + 7).map((date) => byDate.get(date)?.length ?? 0));
    return Math.max(150, 62 + maxCards * 54);
  });
  const logicalWidth = 1680;
  const headerHeight = 180;
  const weekdayHeight = 48;
  const logicalHeight = headerHeight + weekdayHeight + weekHeights.reduce((sum, value) => sum + value, 0) + 40;
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = logicalWidth * scale;
  canvas.height = logicalHeight * scale;
  const context = canvas.getContext("2d");
  context.scale(scale, scale);
  context.fillStyle = palette.page;
  context.fillRect(0, 0, logicalWidth, logicalHeight);
  context.fillStyle = palette.header;
  context.fillRect(0, 0, logicalWidth, 112);
  canvasText(context, appDocument.calendarMeta.name, 34, 48, 1050, { font: "30px Arial", color: palette.headerText, bold: true });
  canvasText(context, appDocument.calendarMeta.coordinator || "Sin coordinador registrado", 34, 82, 1050, { font: "18px Arial", color: palette.headerSubtle });
  canvasText(context, formatMonthTitle(year, month), 1250, 60, 390, { font: "28px Arial", color: palette.headerText, bold: true });
  const filterLabels = [...dom.filterChips.querySelectorAll(".filter-chip")].map((chip) => chip.textContent.replace(/ ×$/, ""));
  if (appDocument.settings.filters.query) filterLabels.unshift(`Búsqueda: ${appDocument.settings.filters.query}`);
  canvasText(context, filterLabels.length ? `Filtros: ${filterLabels.join(" · ")}` : "Vista completa", 34, 142, 1250, { font: "17px Arial", color: palette.meta });
  canvasText(context, `Generado ${timestampLabel(new Date().toISOString())}`, 1290, 142, 350, { font: "15px Arial", color: palette.meta });

  const columnWidth = logicalWidth / 7;
  const weekdays = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
  context.fillStyle = palette.weekday;
  context.fillRect(0, headerHeight, logicalWidth, weekdayHeight);
  weekdays.forEach((label, index) => {
    canvasText(context, label, index * columnWidth + 14, headerHeight + 31, columnWidth - 28, { font: "18px Arial", color: palette.text, bold: true });
  });
  const holidayMap = holidayMapForYears([...new Set(dates.map((date) => Number(date.slice(0, 4))))], appDocument.holidayOverrides);
  let y = headerHeight + weekdayHeight;
  for (let week = 0; week < 6; week += 1) {
    const height = weekHeights[week];
    for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
      const date = dates[week * 7 + dayIndex];
      const x = dayIndex * columnWidth;
      const holiday = holidayMap.get(date);
      context.fillStyle = dayOfWeek(date) === 0 || holiday ? palette.nonWorking : palette.day;
      if (Number(date.slice(5, 7)) !== month) context.fillStyle = palette.outside;
      context.fillRect(x, y, columnWidth, height);
      context.strokeStyle = palette.grid;
      context.strokeRect(x, y, columnWidth, height);
      canvasText(context, String(Number(date.slice(8, 10))), x + 12, y + 28, 40, { font: "18px Arial", color: palette.text, bold: true });
      if (holiday) canvasText(context, holiday.name, x + 48, y + 27, columnWidth - 60, { font: "13px Arial", color: palette.holiday });
      let cardY = y + 42;
      for (const activity of byDate.get(date) ?? []) {
        const client = maps.clients.get(activity.clientId);
        const site = maps.sites.get(activity.siteId);
        const visual = responsibleVisualClass(activity, maps);
        const colors = visual === "contractor"
          ? [darkExport ? "#4a3022" : "#fff0e4", "#ed7d31"]
          : visual === "mixed"
            ? [darkExport ? "#3c3029" : "#f7eee6", "#a87c63"]
            : visual === "unassigned"
              ? [darkExport ? "#303630" : "#f0f1ef", "#8b928b"]
              : [darkExport ? "#223b38" : "#e6f1ef", "#58a29a"];
        context.globalAlpha = ["completed", "cancelled"].includes(activity.status) ? 0.55 : 1;
        context.fillStyle = colors[0];
        context.fillRect(x + 8, cardY, columnWidth - 16, 46);
        context.fillStyle = colors[1];
        context.fillRect(x + 8, cardY, 5, 46);
        canvasText(context, client?.name || SERVICE_TYPES[activity.serviceType], x + 20, cardY + 18, columnWidth - 36, { font: "14px Arial", color: palette.text, bold: true });
        canvasText(context, `${site?.name || activity.city || ""} · ${ACTIVITY_STATUSES[activity.status]}`, x + 20, cardY + 37, columnWidth - 36, { font: "12px Arial", color: palette.secondary });
        context.globalAlpha = 1;
        cardY += 54;
      }
    }
    y += height;
  }
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error("El navegador no generó la imagen.")), "image/png")
  );
  const fileMonth = `${year}-${String(month).padStart(2, "0")}`;
  const identity = normalizeKey(appDocument.calendarMeta.name) || "cronograma";
  downloadBlob(blob, "image/png", `${fileMonth}_cronograma_${identity}.png`);
  appendAudit("png_exported", `Vista filtrada exportada: ${fileMonth}`);
  scheduleSave();
  showToast(`Imagen de ${formatMonthTitle(year, month)} descargada.`);
}

function downloadProgrammingTemplate() {
  const workbook = XLSX.utils.book_new();
  const example = [
    PROGRAMMING_COLUMNS,
    [
      todayInBogota(), todayInBogota(), PLANNING_BUCKETS.calendar, "Ejemplo Cliente", "Ejemplo Sede", "Pereira",
      "Responsable Uno; Responsable Dos", SERVICE_TYPES.preventive,
      ACTIVITY_STATUSES.scheduled, "Fila de ejemplo: reemplazar o eliminar", "No"
    ]
  ];
  const catalogRows = [
    ["Tipo", "Cliente", "Sede", "Ciudad", "Responsable", "Clasificación"],
    ...appDocument.catalog.sites.map((site) => {
      const client = appDocument.catalog.clients.find((item) => item.id === site.clientId);
      return ["Sede", client?.name ?? "", site.name, site.city ?? "", "", ""];
    }),
    ...appDocument.catalog.responsibles.map((responsible) => [
      "Responsable", "", "", responsible.baseCity ?? "", responsible.name,
      RESPONSIBLE_TYPES[responsible.responsibleType] ?? responsible.responsibleType
    ])
  ];
  const instructions = [
    ["Plantilla de programación HVAC SI&S"],
    ["Una fila crea una actividad; un rango crea tarjetas independientes enlazadas."],
    ["Los nombres de cliente, sede y responsables deben coincidir exactamente con Catalogos."],
    ["Separe varios responsables con punto y coma (;)."],
    [`Bandeja: ${Object.values(PLANNING_BUCKETS).join(" | ")}. Si se omite, se interpreta como Calendario.`],
    [`TipoServicio: ${Object.values(SERVICE_TYPES).join(" | ")}`],
    [`Estado: ${Object.values(ACTIVITY_STATUSES).join(" | ")}`],
    ["Las filas Pendiente deben venir sin fechas y con estado Por programar."],
    ["Las filas Calendario deben tener fecha y no pueden usar Por programar."],
    ["Cliente y Sede pueden quedar vacíos solamente para Administrativo."],
    ["IncluirNoLaborables acepta Sí/No. Por defecto domingos y festivos se omiten."],
    ["La importación no crea registros faltantes del catálogo."]
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(example), "Programacion");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(catalogRows), "Catalogos");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(instructions), "Instrucciones");
  const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  downloadBlob(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "plantilla_programacion_SIYS-Sync.xlsx");
  showToast("Plantilla Excel descargada.");
}

function renderProgrammingImportPreview(preview, file) {
  dom.programmingImportSummary.textContent = `${file.name} · ${(file.size / 1024).toFixed(1)} KB`;
  const stats = [
    [preview.counts.valid, "Filas válidas"],
    [preview.counts.errors, "Filas con error"],
    [preview.counts.duplicates, "Duplicadas"],
    [preview.counts.omitted, "Fechas no laborables omitidas"]
  ];
  dom.programmingImportStats.replaceChildren(...stats.map(([count, label]) => {
    const element = createElement("div", "import-stat");
    element.append(createElement("strong", "", String(count)), createElement("span", "", label));
    return element;
  }));
  const messages = [
    ...preview.warnings.map((item) => item.message),
    ...preview.rows.flatMap((row) => [
      ...row.errors.map((message) => `Fila ${row.rowNumber}: ${message}`),
      ...row.warnings.map((message) => `Fila ${row.rowNumber}: ${message}`)
    ])
  ];
  dom.programmingImportWarnings.hidden = messages.length === 0;
  dom.programmingImportWarnings.replaceChildren(...messages.map((message) => createElement("p", "", message)));
  showFormErrors(dom.programmingImportErrors, preview.structuralErrors);
  dom.includeDuplicatesLabel.hidden = preview.counts.duplicates === 0;
  dom.includeProgrammingDuplicates.checked = false;
  dom.applyProgrammingImportButton.disabled = preview.structuralErrors.length > 0 || preview.counts.valid === 0;
}

async function handleProgrammingFile(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", raw: true, cellDates: true });
    const preview = parseProgrammingWorkbook(workbook, appDocument);
    pendingProgrammingImport = preview;
    renderProgrammingImportPreview(preview, file);
    openDialog("programmingImportDialog");
  } catch (error) {
    showToast(`No se pudo analizar la programación: ${error.message}`, { type: "error", duration: 9000 });
  }
}

function handleProgrammingImportSubmit(event) {
  event.preventDefault();
  if (!pendingProgrammingImport) return;
  try {
    const includeDuplicates = dom.includeProgrammingDuplicates.checked;
    const count = pendingProgrammingImport.rows.filter((row) =>
      !row.errors.length && (includeDuplicates || !row.duplicate)
    ).length;
    mutate("programming_imported", `${count} filas de programación importadas`, () => {
      appDocument = applyProgrammingImport(appDocument, pendingProgrammingImport, { includeDuplicates }).document;
    });
    pendingProgrammingImport = null;
    closeDialog("programmingImportDialog");
  } catch (error) {
    showFormErrors(dom.programmingImportErrors, [error.message]);
  }
}

async function handleRestoreFile(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  if (file.size > 25 * 1024 * 1024) {
    showToast("El respaldo supera el límite de 25 MB.", { type: "error" });
    return;
  }
  try {
    const raw = JSON.parse(await file.text());
    const parsed = parseBackup(raw);
    const restored = parsed.document;
    pendingRestore = restored;
    const summary = createElement("div", "detail-grid");
    summary.append(detailItem("Archivo", file.name));
    summary.append(detailItem("Cronograma", restored.calendarMeta.name));
    summary.append(detailItem("Coordinador", restored.calendarMeta.coordinator || "Sin registrar"));
    summary.append(detailItem("Revisión", String(restored.calendarMeta.revision)));
    summary.append(detailItem("Formato", parsed.envelope ? "Respaldo versionado" : "Respaldo heredado"));
    if (parsed.exportedAt) summary.append(detailItem("Exportado", timestampLabel(parsed.exportedAt)));
    summary.append(detailItem("Actividades", String(restored.activities.length)));
    summary.append(detailItem("Clientes y sedes", `${restored.catalog.clients.length} clientes · ${restored.catalog.sites.length} sedes`));
    summary.append(detailItem("Responsables", String(restored.catalog.responsibles.length)));
    dom.restoreSummary.replaceChildren(summary);
    const difference = restored.calendarMeta.revision - appDocument.calendarMeta.revision;
    dom.restoreWarning.textContent = difference < 0
      ? `Advertencia: el respaldo es ${Math.abs(difference)} revisión(es) más antiguo que el cronograma actual. La restauración reemplazará los datos.`
      : difference === 0
        ? "Advertencia: el respaldo tiene la misma revisión que el cronograma actual. La restauración reemplazará los datos."
        : `El respaldo contiene ${difference} revisión(es) más nuevas. La restauración reemplazará los datos actuales.`;
    openDialog("restoreDialog");
  } catch (error) {
    showToast(`No se pudo leer el respaldo: ${error.message}`, { type: "error", duration: 8000 });
  }
}

function handleRestoreSubmit(event) {
  event.preventDefault();
  if (!pendingRestore) return;
  if (!hasEditControl) {
    showToast("Esta pestaña está en modo de solo lectura.", { type: "error" });
    return;
  }
  mutateWithContract("backup.restore", { document: pendingRestore }, "restauración del respaldo", {
    toast: "Respaldo restaurado correctamente."
  });
  pendingRestore = null;
  selectedActivityIds.clear();
  closeDrawer();
  scheduleSave({ immediate: true });
  closeDialog("restoreDialog");
}

function renderMergeJsonPreview(parsed, result, file) {
  const summary = createElement("div", "detail-grid");
  summary.append(detailItem("Archivo", file.name));
  summary.append(detailItem("Origen", parsed.channel || parsed.origin || "Desconocido"));
  summary.append(detailItem("Cronograma importado", parsed.document.calendarMeta.name));
  summary.append(detailItem("Revisión importada", String(parsed.document.calendarMeta.revision)));
  dom.mergeJsonSummary.replaceChildren(summary);

  const stats = [
    [result.counts.added, "Nuevos"],
    [result.counts.updated, "Actualizados"],
    [result.counts.skipped, "Sin cambios"],
    [result.counts.conflicts, "Conflictos"]
  ];
  dom.mergeJsonStats.replaceChildren(...stats.map(([value, label]) => {
    const stat = createElement("div", "import-stat");
    stat.append(createElement("strong", "", String(value)), createElement("span", "", label));
    return stat;
  }));

  const messages = [...result.warnings];
  if (parsed.channel && parsed.channel !== RUNTIME_CHANNEL) {
    messages.unshift(`El respaldo proviene del canal ${parsed.channel} y se añadirá al canal ${RUNTIME_CHANNEL}.`);
  }
  dom.mergeJsonWarnings.hidden = messages.length === 0;
  dom.mergeJsonWarnings.replaceChildren(...messages.map((message) => createElement("p", "", message)));
  dom.applyMergeJsonButton.disabled = result.counts.added + result.counts.updated === 0;
}

async function handleMergeJsonFile(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  if (file.size > 25 * 1024 * 1024) {
    showToast("El archivo supera el límite de 25 MB.", { type: "error" });
    return;
  }
  try {
    const parsed = parseBackup(JSON.parse(await file.text()));
    const result = mergeBackupDocument(appDocument, parsed.document);
    pendingMerge = { parsed, result };
    renderMergeJsonPreview(parsed, result, file);
    openDialog("mergeJsonDialog");
  } catch (error) {
    pendingMerge = null;
    showToast(`No se pudo preparar la combinación: ${error.message}`, { type: "error", duration: 9000 });
  }
}

function handleMergeJsonSubmit(event) {
  event.preventDefault();
  if (!pendingMerge) return;
  const { parsed, result } = pendingMerge;
  try {
    mutateWithContract("backup.merge", { document: parsed.document }, `${result.counts.added} registros añadidos y ${result.counts.updated} actualizados desde JSON`);
    pendingMerge = null;
    closeDialog("mergeJsonDialog");
  } catch (error) {
    showToast(`La combinación no se aplicó: ${error.message}`, { type: "error" });
  }
}

function renderImportPreview(preview, parsed, file) {
  const fileSummary = createElement("div");
  fileSummary.append(createElement("strong", "", file.name));
  fileSummary.append(createElement("p", "field-note", `${(file.size / 1024).toFixed(1)} KB · sólo lectura · ${parsed.fileMetadata?.sha256 ? `SHA-256 ${parsed.fileMetadata.sha256.slice(0, 12)}…` : "hash no disponible"}`));
  dom.importFileSummary.replaceChildren(fileSummary);

  const entityNames = {
    cities: "Ciudades",
    clients: "Clientes",
    sites: "Sedes",
    responsibles: "Responsables"
  };
  const statFragment = document.createDocumentFragment();
  let totalNew = 0;
  let totalUpdated = 0;
  let totalUnchanged = 0;
  let totalMissing = 0;
  for (const key of Object.keys(entityNames)) {
    const diff = preview.diffs?.[key] ?? {};
    totalNew += diff.newItems?.length ?? 0;
    totalUpdated += diff.updated?.length ?? 0;
    totalUnchanged += diff.unchanged?.length ?? 0;
    totalMissing += diff.missing?.length ?? 0;
  }
  const stats = [
    [totalNew, "Nuevos"],
    [totalUpdated, "Actualizados"],
    [totalUnchanged, "Sin cambios"],
    [totalMissing, "Ausentes (no se borran)"]
  ];
  for (const [value, label] of stats) {
    const stat = createElement("div", "import-stat");
    stat.append(createElement("strong", "", String(value)));
    stat.append(createElement("span", "", label));
    statFragment.append(stat);
  }
  dom.importStatGrid.replaceChildren(statFragment);

  const warnings = parsed.warnings ?? preview.warnings ?? [];
  if (warnings.length) {
    const list = createElement("ul");
    for (const warning of warnings) {
      list.append(createElement("li", "", typeof warning === "string" ? warning : warning.message));
    }
    dom.importWarnings.replaceChildren(list);
    dom.importWarnings.hidden = false;
  } else {
    dom.importWarnings.hidden = true;
    dom.importWarnings.replaceChildren();
  }

  const details = createElement("div", "detail-grid");
  for (const [key, label] of Object.entries(entityNames)) {
    const diff = preview.diffs?.[key] ?? {};
    details.append(detailItem(label, [
      `${diff.newItems?.length ?? 0} nuevos`,
      `${diff.updated?.length ?? 0} actualizados`,
      `${diff.unchanged?.length ?? 0} sin cambios`,
      `${diff.missing?.length ?? 0} ausentes`
    ].join(" · ")));
  }
  if (parsed.equipmentHints?.length) {
    details.append(detailItem(
      "Pistas de equipos",
      `${preview.equipmentHints?.exact ?? 0} coincidencias exactas de ${parsed.equipmentHints.length} subsidiarias. No se asignará ninguna persona automáticamente.`
    ));
  }
  dom.importDetails.replaceChildren(details);
}

async function handleBaseFile(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  if (!/\.(xlsx|xls)$/i.test(file.name)) {
    showToast("Selecciona un archivo Excel .xlsx o .xls.", { type: "error" });
    return;
  }
  try {
    setSaveIndicator("saving", "Leyendo Excel…");
    const arrayBuffer = await file.arrayBuffer();
    const hash = await sha256Hex(arrayBuffer.slice(0));
    const workbook = XLSX.read(arrayBuffer, {
      type: "array",
      raw: false,
      cellDates: false,
      cellFormula: false,
      dense: false
    });
    const metadata = {
      fileName: file.name,
      fileSize: file.size,
      lastModified: file.lastModified ? new Date(file.lastModified).toISOString() : null,
      sha256: hash,
      importedAt: new Date().toISOString()
    };
    const parsed = parseBaseWorkbook(workbook, metadata);
    const preview = buildImportPreview(appDocument, parsed);
    pendingImport = { parsed, preview };
    renderImportPreview(preview, parsed, file);
    setSaveIndicator("saved", "Guardado");
    openDialog("importDialog");
  } catch (error) {
    setSaveIndicator(
      storageAvailable ? "saved" : "error",
      storageAvailable ? (CLOUD_MODE ? "Guardado en Supabase" : "Guardado") : (CLOUD_MODE ? "Sin conexión con Supabase" : "Sin guardado local")
    );
    showToast(`No se pudo importar el Excel: ${error.message}`, { type: "error", duration: 9000 });
  }
}

function handleImportSubmit(event) {
  event.preventDefault();
  if (!pendingImport) return;
  try {
    mutate("base_imported", "Base Operativa importada", () => {
      appDocument = applyParsedImport(appDocument, pendingImport.parsed, new Date().toISOString());
    });
    pendingImport = null;
    closeDialog("importDialog");
  } catch (error) {
    showToast(`La importación no se aplicó: ${error.message}`, { type: "error" });
  }
}

function changeVisibleMonth(delta) {
  const { year, month } = currentMonthParts();
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  appDocument.settings.currentDate = toISODate(date);
  mobileAgendaDate = appDocument.settings.currentDate;
  renderCalendar();
  renderHolidayDialogIfOpen();
  scheduleSave();
}

function renderHolidayDialogIfOpen() {
  if (dom.holidayDialog.open) renderHolidayDialog();
}

function updateFilter(name, value) {
  appDocument.settings.filters[name] = value;
  renderCalendar();
  scheduleSave();
}

function initializeStaticOptions() {
  setChildren(
    dom.activityServiceType,
    ...Object.entries(SERVICE_TYPES).map(([value, label]) => option(value, label))
  );
  setChildren(
    dom.activityStatus,
    ...Object.entries(ACTIVITY_STATUSES).map(([value, label]) => option(value, label))
  );
  setChildren(
    dom.bulkStatusValue,
    ...Object.entries(ACTIVITY_STATUSES)
      .filter(([value]) => value !== "to_schedule")
      .map(([value, label]) => option(value, label))
  );
  dom.versionLabel.textContent = `Versión ${APP_VERSION} · festivos ${HOLIDAY_RULESET_VERSION}`;
  dom.betaBadge.hidden = RUNTIME_CHANNEL !== "beta";
}

function bindEvents() {
  dom.cloudAuthForm?.addEventListener("submit", handleCloudAuthSubmit);
  dom.cloudAuthModeButton?.addEventListener("click", () => {
    setCloudAuthMode(cloudAuthMode === "sign-up" ? "sign-in" : "sign-up");
    showFormErrors(dom.cloudAuthErrors, []);
  });
  dom.cloudSignOutButton?.addEventListener("click", () => {
    handleCloudSignOut().catch((error) => showToast(`No se pudo cerrar sesión: ${error.message}`, { type: "error" }));
  });
  dom.newActivityButton.addEventListener("click", () => openActivityDialog({
    date: appDocument.settings.currentDate || todayInBogota()
  }));
  dom.newQuarantineButton.addEventListener("click", () => openActivityDialog({
    planningBucket: "quarantine"
  }));
  dom.importBaseButton.addEventListener("click", () => dom.baseFileInput.click());
  dom.toggleCatalogButton.addEventListener("click", toggleCatalog);
  dom.mobileMoreButton.addEventListener("click", toggleMobileMore);
  dom.mobileMonthButton.addEventListener("click", openMobileMonthPicker);
  dom.closeMobileMonthButton.addEventListener("click", () => closeMobileMonthPicker());
  dom.mobilePreviousMonthButton.addEventListener("click", () => changeVisibleMonth(-1));
  dom.mobileNextMonthButton.addEventListener("click", () => changeVisibleMonth(1));
  dom.mobilePreviousDayButton.addEventListener("click", () => changeMobileAgendaDay(-1));
  dom.mobileNextDayButton.addEventListener("click", () => changeMobileAgendaDay(1));
  dom.mobileTodayButton.addEventListener("click", () => selectMobileAgendaDate(todayInBogota()));
  dom.closeCatalogMobileButton.addEventListener("click", () => {
    document.body.classList.remove("catalog-mobile-open");
    applyCatalogPreference();
    dom.toggleCatalogButton.focus();
  });
  dom.mobileAgendaAddButton.addEventListener("click", () => openActivityDialog({
    date: mobileAgendaDate || appDocument.settings.currentDate || todayInBogota()
  }));
  dom.emptyImportButton.addEventListener("click", () => dom.baseFileInput.click());
  dom.backupButton.addEventListener("click", createBackup);
  dom.backupBannerButton.addEventListener("click", createBackup);
  dom.restoreButton.addEventListener("click", () => dom.restoreFileInput.click());
  dom.mergeJsonButton.addEventListener("click", () => dom.mergeJsonFileInput.click());
  dom.exportCsvButton.addEventListener("click", exportCurrentMonthCsv);
  dom.exportQuarantineCsvButton.addEventListener("click", exportQuarantineCsv);
  dom.exportImageButton.addEventListener("click", () => {
    exportCurrentMonthImage().catch((error) => showToast(error.message, { type: "error" }));
  });
  dom.programmingTemplateButton.addEventListener("click", downloadProgrammingTemplate);
  dom.importProgrammingButton.addEventListener("click", () => dom.programmingFileInput.click());
  dom.holidayButton.addEventListener("click", () => {
    renderHolidayDialog();
    openDialog("holidayDialog");
  });
  dom.helpButton.addEventListener("click", () => openDialog("helpDialog"));
  dom.calendarSettingsButton.addEventListener("click", openCalendarSettingsDialog);
  dom.themeButton.addEventListener("click", cycleThemePreference);
  dom.themeForm.addEventListener("submit", handleThemeSubmit);
  dom.resetDataButton.addEventListener("click", openResetDataDialog);
  dom.resetDataForm.addEventListener("submit", handleResetDataSubmit);
  dom.dropMoveButton.addEventListener("click", () => applyPendingDrop("move"));
  dom.dropDuplicateButton.addEventListener("click", () => applyPendingDrop("duplicate"));
  dom.dropExtendButton.addEventListener("click", () => applyPendingDrop("extend"));
  dom.activityDateActionForm.addEventListener("submit", (event) => event.preventDefault());
  dom.activityDateActionDate.addEventListener("change", updateActivityDateActionWarning);
  dom.touchMoveButton.addEventListener("click", () => applyTouchDateAction("move"));
  dom.touchDuplicateButton.addEventListener("click", () => applyTouchDateAction("duplicate"));
  dom.touchExtendButton.addEventListener("click", () => applyTouchDateAction("extend"));
  dom.quarantineForm.addEventListener("submit", handleQuarantineSubmit);
  dom.quarantineAssignForm.addEventListener("submit", handleQuarantineAssignSubmit);
  dom.quarantineAssignDate.addEventListener("change", renderQuarantineAssignWarning);
  dom.calendarSettingsForm.addEventListener("submit", handleCalendarSettingsSubmit);
  dom.requestPersistenceButton.addEventListener("click", requestStoragePersistence);
  dom.takeControlButton.addEventListener("click", async () => {
    if (!window.confirm("¿Tomar el control de edición? La otra pestaña pasará a solo lectura.")) return;
    try {
      const claimed = await claimEditLock({ force: true });
      if (!claimed) throw new Error("No se pudo reservar la edición.");
      const stored = await readStoredDocument("current");
      if (stored) appDocument = sanitizeDocument(stored);
      setEditControl(true);
      editChannel?.postMessage({ type: "control-taken", ownerId: tabId });
      renderAll();
      showToast("Esta pestaña tomó el control de edición.");
    } catch (error) {
      showToast(error.message, { type: "error" });
    }
  });
  dom.previousMonthButton.addEventListener("click", () => changeVisibleMonth(-1));
  dom.nextMonthButton.addEventListener("click", () => changeVisibleMonth(1));
  dom.todayButton.addEventListener("click", () => {
    appDocument.settings.currentDate = todayInBogota();
    mobileAgendaDate = appDocument.settings.currentDate;
    renderCalendar();
    scheduleSave();
  });
  dom.globalSearch.addEventListener("input", () => updateFilter("query", dom.globalSearch.value));
  dom.filterButton.addEventListener("click", openFilterDialog);
  dom.filterForm.addEventListener("submit", handleFilterSubmit);
  dom.clearFiltersButton.addEventListener("click", () => clearAllFilters());
  dom.clearFiltersDialogButton.addEventListener("click", () => clearAllFilters({ close: true }));
  dom.catalogSearch.addEventListener("input", renderCatalog);
  dom.sitesTab.addEventListener("click", () => {
    catalogTab = "sites";
    renderCatalog();
  });
  dom.responsiblesTab.addEventListener("click", () => {
    catalogTab = "responsibles";
    renderCatalog();
  });
  dom.quarantineTab.addEventListener("click", () => {
    catalogTab = "quarantine";
    renderCatalog();
  });
  dom.catalogList.addEventListener("dragover", handlePlanningBucketDragOver);
  dom.catalogList.addEventListener("dragleave", handlePlanningBucketDragLeave);
  dom.catalogList.addEventListener("drop", handlePlanningBucketDrop);
  dom.newCatalogButton.addEventListener("click", () => openCatalogDialog(catalogTab === "responsibles" ? "responsible" : "client"));
  dom.closeDrawerButton.addEventListener("click", closeDrawer);
  dom.detailDrawer.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDrawer();
  });
  dom.detailDrawer.addEventListener("close", () => {
    if (activeDrawer) closeDrawer();
  });
  dom.mobileMonthDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeMobileMonthPicker();
  });
  dom.clearSelectionButton.addEventListener("click", () => {
    selectedActivityIds.clear();
    renderCalendar();
    renderSelectionBar();
  });
  dom.bulkMoveButton.addEventListener("click", openBulkMoveDialog);
  dom.bulkStatusButton.addEventListener("click", openBulkStatusDialog);
  dom.bulkEditButton.addEventListener("click", openBulkEditDialog);
  dom.bulkDeleteButton.addEventListener("click", deleteSelectedActivities);
  dom.dismissBackupBanner.addEventListener("click", () => {
    appDocument.settings.backupReminderDismissed = todayInBogota();
    renderBackupReminder();
    scheduleSave();
  });

  dom.activityClient.addEventListener("change", () => {
    populateSiteSelect(dom.activityClient.value);
    dom.activityCity.value = "";
    renderResponsiblePicker();
  });
  dom.activitySite.addEventListener("change", syncActivityLocationFromSite);
  dom.responsibleSearch.addEventListener("input", scheduleResponsiblePickerRender);
  dom.activityCity.addEventListener("input", scheduleResponsiblePickerRender);
  dom.activityServiceType.addEventListener("change", updateAdministrativeFormState);
  dom.activityDate.addEventListener("change", () => {
    forcedRangeDates.clear();
    if (dom.activityEndDate.value && compareISODate(dom.activityEndDate.value, dom.activityDate.value) < 0) {
      dom.activityEndDate.value = dom.activityDate.value;
    }
    updateRangePreview();
  });
  dom.activityEndDate.addEventListener("change", () => {
    forcedRangeDates.clear();
    updateRangePreview();
  });
  dom.includeNonWorking.addEventListener("change", () => {
    forcedRangeDates.clear();
    updateRangePreview();
  });
  dom.activityForm.addEventListener("submit", handleActivitySubmit);
  dom.quickAddResponsibleButton.addEventListener("click", () => openCatalogDialog("responsible"));

  dom.catalogType.addEventListener("change", () => {
    setCatalogFieldVisibility(dom.catalogType.value);
    if (dom.catalogType.value === "site") populateCatalogClientSelect();
  });
  dom.catalogForm.addEventListener("submit", handleCatalogSubmit);
  dom.holidayForm.addEventListener("submit", handleHolidaySubmit);
  dom.bulkMoveForm.addEventListener("submit", handleBulkMoveSubmit);
  dom.bulkMoveDate.addEventListener("change", updateBulkMoveWarning);
  dom.bulkStatusForm.addEventListener("submit", handleBulkStatusSubmit);
  dom.bulkEditForm.addEventListener("submit", handleBulkEditSubmit);
  dom.bulkEditField.addEventListener("change", renderBulkEditControls);
  dom.bulkEditMode.addEventListener("change", renderBulkEditControls);
  dom.restoreForm.addEventListener("submit", handleRestoreSubmit);
  dom.mergeJsonForm.addEventListener("submit", handleMergeJsonSubmit);
  dom.programmingImportForm.addEventListener("submit", handleProgrammingImportSubmit);
  dom.importForm.addEventListener("submit", handleImportSubmit);
  dom.baseFileInput.addEventListener("change", handleBaseFile);
  dom.restoreFileInput.addEventListener("change", handleRestoreFile);
  dom.mergeJsonFileInput.addEventListener("change", handleMergeJsonFile);
  dom.programmingFileInput.addEventListener("change", handleProgrammingFile);

  for (const button of document.querySelectorAll("[data-close-dialog]")) {
    button.addEventListener("click", () => closeDialog(button.dataset.closeDialog));
  }
  for (const button of document.querySelectorAll(".action-menu .menu-action")) {
    button.addEventListener("click", () => {
      button.closest("details")?.removeAttribute("open");
      closeMobileMore();
    });
  }
  for (const menu of document.querySelectorAll(".action-menu")) {
    menu.addEventListener("toggle", () => {
      if (menu.open) closeAllActionMenus(menu);
    });
  }
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".action-menu, #mobileMoreButton, #advancedActions")) {
      closeAllActionMenus();
      closeMobileMore();
    }
  });
  for (const dialog of document.querySelectorAll("dialog")) {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) {
        const rectangle = dialog.getBoundingClientRect();
        const inside = (
          event.clientX >= rectangle.left &&
          event.clientX <= rectangle.right &&
          event.clientY >= rectangle.top &&
          event.clientY <= rectangle.bottom
        );
        if (!inside) dialog.close();
      }
    });
  }
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeAllActionMenus();
      closeMobileMore();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n" && !document.querySelector("dialog[open]")) {
      event.preventDefault();
      openActivityDialog({ date: appDocument.settings.currentDate });
    }
  });
  systemThemeQuery?.addEventListener("change", () => {
    if (themePreference() === "system") applyThemePreference();
  });
  compactLayoutQuery?.addEventListener("change", () => {
    if (!compactLayoutQuery.matches && dom.mobileMonthDialog.open) {
      closeMobileMonthPicker({ restoreFocus: false });
    }
    document.body.classList.remove("catalog-mobile-open");
    closeMobileMore();
    applyCatalogPreference();
    renderCalendar();
  });
  window.addEventListener("beforeunload", () => {
    if (saveTimer && storageAvailable) {
      clearTimeout(saveTimer);
      writeStoredDocument(clone(appDocument)).catch(() => {});
    }
    if (editLockTimer) clearInterval(editLockTimer);
    releaseEditLock().catch(() => {});
    editChannel?.close();
  });
}

async function loadInitialDocument() {
  if (CLOUD_MODE) {
    try {
      cloudPersistence = createSupabasePersistence(SUPABASE_CONFIG, {
        calendarKey: CLOUD_CALENDAR_KEY
      });
      const restored = await cloudPersistence.restoreSession();
      if (!restored) await waitForCloudAuthentication();
      const initial = createDefaultDocument();
      const current = await cloudPersistence.initialize({ initialDocument: initial });
      storageAvailable = true;
      return current?.document ? sanitizeDocument(current.document) : initial;
    } catch (error) {
      storageAvailable = false;
      setSaveIndicator("error", "Sin conexión con Supabase");
      showToast(`No se pudo abrir el cronograma cloud: ${error.message}`, {
        type: "error",
        duration: 15000
      });
      throw error;
    }
  }
  try {
    database = await openDatabase();
    const stored = await readStoredDocument("current");
    if (stored) {
      try {
        return sanitizeDocument(stored);
      } catch (currentError) {
        const recovery = await readStoredDocument("recovery");
        if (recovery) {
          const recovered = sanitizeDocument(recovery);
          await replaceCurrentDocument(recovered);
          showToast("Se recuperó la copia anterior porque el último guardado no era válido.", {
            duration: 9000
          });
          return recovered;
        }
        throw currentError;
      }
    }
    return createDefaultDocument();
  } catch (error) {
    storageAvailable = false;
    setSaveIndicator("error", "Sin guardado local");
    showToast(
      `El navegador no permitió abrir el almacenamiento local. Trabaja sólo si vas a descargar un respaldo: ${error.message}`,
      { type: "error", duration: 12000 }
    );
    return createDefaultDocument();
  }
}

async function initialize() {
  initializeStaticOptions();
  applyDesignContract();
  bindEvents();
  applyCatalogPreference();
  applyThemePreference();
  appDocument = await loadInitialDocument();
  if (CLOUD_MODE && storageAvailable) {
    const canEdit = cloudPersistence?.canEdit() ?? false;
    setEditControl(canEdit, canEdit ? "" : "Tu cuenta tiene acceso de solo lectura a este cronograma.");
  } else if (storageAvailable) {
    await initializeEditLock();
  } else {
    setEditControl(true);
  }
  try {
    parseISODate(appDocument.settings.currentDate);
  } catch {
    appDocument.settings.currentDate = todayInBogota();
  }
  renderAll();
  await renderStorageStatus();
  if (storageAvailable) setSaveIndicator("saved", CLOUD_MODE ? "Guardado en Supabase" : "Guardado");
  document.body.dataset.ready = "true";
  window.dispatchEvent(new CustomEvent("calendario-hvac-ready"));
}

initialize().catch((error) => {
  setSaveIndicator("error", "Error al iniciar");
  showToast(`La aplicación no pudo iniciar: ${error.message}`, { type: "error", duration: 15000 });
  console.error(error);
});
