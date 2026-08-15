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
  compareActivityOrder,
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
  normalizeDisplayText,
  normalizeKey,
  normalizeFilterArray,
  normalizeText,
  parseISODate,
  parseBackup,
  runtimeChannelForLocation,
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
  shouldMigrateLocalDocument,
  shouldUseSupabaseCloud,
  SupabaseCloudConflictError,
  supabaseCalendarKeyForChannel
} from "./cloud.js";
import {
  createElement,
  displayInitialsFor,
  formatDisplayDate,
  formatMonthTitle,
  option,
  setChildren,
  timestampLabel
} from "./ui/presentation.js";
import {
  DAY_NAMES,
  MAX_VISIBLE_CARDS,
  SERVICE_CODES,
  SERVICE_SHORT_LABELS,
  STATUS_ICONS
} from "./ui/calendar-constants.js";
import { createMutationController } from "./ui/mutation-controller.js";
import { createIndexedDocumentStore } from "./persistence/indexed-document-store.js";
import { createJsonPreferences } from "./persistence/json-preferences.js";
import {
  responsibleCoverageScore
} from "./domain/responsible-ranking.js";

const RUNTIME_CHANNEL = runtimeChannelForLocation(location);
const DATABASE_NAME = RUNTIME_CHANNEL === "beta"
  ? "calendario-hvac-siys-beta"
  : "calendario-hvac-siys";
const DATABASE_VERSION = 1;
const DOCUMENT_STORE = "documents";
const STABLE_LOCAL_MIGRATION_KEY = "siys-sync-stable-local-migration:v1";
const SUPABASE_CONFIG = globalThis.__SIYS_SUPABASE_CONFIG__ ?? {
  enabled: false,
  url: "",
  publishableKey: ""
};
// Both published channels use the same Supabase project, while each channel
// keeps an independent logical calendar to prevent beta data from replacing
// the stable calendar.
const CLOUD_MODE = shouldUseSupabaseCloud(RUNTIME_CHANNEL, SUPABASE_CONFIG);
const CLOUD_CALENDAR_KEY = supabaseCalendarKeyForChannel(RUNTIME_CHANNEL);
const localDocumentStore = createIndexedDocumentStore({
  databaseName: DATABASE_NAME,
  databaseVersion: DATABASE_VERSION,
  storeName: DOCUMENT_STORE,
  browserWindow: window
});
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
let pendingSeriesRangeActivityId = null;
let pendingQuarantineActivityId = null;
let pendingQuarantineAssignId = null;
let mobileAgendaDate = null;
let mutationController = null;
let forcedRangeDates = new Set();
let seriesRangeForcedDates = new Set();
let responsibleRenderTimer = null;
let storageAvailable = true;
let hasEditControl = false;
let editLockTimer = null;
let cloudPersistence = null;
let cloudCalendarRefreshTimer = null;
let cloudCalendarRefreshInFlight = null;
let cloudCalendarSwitching = false;
let cloudAuthMode = "sign-in";
let cloudAuthWaiter = null;
let cloudMigrationNotice = "";
const tabId = crypto.randomUUID();
const EDIT_LOCK_KEY = "edit-lock";
const EDIT_LOCK_HEARTBEAT_MS = 5000;
const EDIT_LOCK_STALE_MS = 15000;
const CLOUD_CALENDAR_REFRESH_MS = 30000;
const UI_PREFERENCES_KEY = `siys-sync-ui:${RUNTIME_CHANNEL}`;
const uiPreferences = createJsonPreferences(localStorage, UI_PREFERENCES_KEY);
const systemThemeQuery = window.matchMedia?.("(prefers-color-scheme: dark)") ?? null;
const compactLayoutQuery = window.matchMedia?.("(max-width: 899px)") ?? null;
const editChannel = "BroadcastChannel" in window
  ? new BroadcastChannel(`calendario-hvac-siys-edit-lock-${RUNTIME_CHANNEL}`)
  : null;

function clone(value) {
  return structuredClone(value);
}

function applyCatalogPreference() {
  if (compactLayoutQuery?.matches) {
    const open = document.body.classList.contains("catalog-mobile-open");
    dom.toggleCatalogButton.setAttribute("aria-expanded", String(open));
    dom.toggleCatalogButton.title = open ? "Cerrar banco de tarjetas" : "Abrir banco de tarjetas";
    dom.toggleCatalogButton.querySelector(".visually-hidden").textContent = dom.toggleCatalogButton.title;
    return;
  }
  const collapsed = uiPreferences.read().catalogCollapsed === true;
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
  uiPreferences.update({ catalogCollapsed: collapsed });
  applyCatalogPreference();
}

function themePreference() {
  const value = uiPreferences.read().theme;
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
  uiPreferences.update({ theme: next });
  applyThemePreference();
  const labels = { light: "claro", dark: "oscuro", system: "del sistema" };
  showToast(`Tema ${labels[next]} aplicado.`);
}

function handleThemeSubmit(event) {
  event.preventDefault();
  const selected = dom.themeForm.querySelector('input[name="themeMode"]:checked')?.value ?? "system";
  uiPreferences.update({ theme: selected });
  uiPreferences.update({ motion: dom.motionEnabled.checked });
  applyThemePreference();
  applyMotionPreference();
  closeDialog("themeDialog");
  showToast(`Tema ${selected === "system" ? "del sistema" : selected === "dark" ? "oscuro" : "claro"} aplicado.`);
}

function motionPreference() {
  return uiPreferences.read().motion === true;
}

function applyMotionPreference() {
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
  const enabled = motionPreference() && !reduced;
  document.body.classList.toggle("motion-enhanced", enabled);
  globalThis.calendaryThreeMotion?.setEnabled(enabled);
  if (dom.motionEnabled) dom.motionEnabled.checked = motionPreference();
  if (dom.motionButton) {
    dom.motionButton.setAttribute("aria-pressed", String(motionPreference()));
    dom.motionButton.querySelector("strong").textContent = `Animaciones visuales: ${motionPreference() ? "activas" : "inactivas"}`;
  }
}

function toggleMotionPreference() {
  const next = !motionPreference();
  uiPreferences.update({ motion: next });
  applyMotionPreference();
  showToast(next ? "Animaciones visuales activadas." : "Animaciones visuales desactivadas.");
}

function normalizationCandidate(value, maxLength) {
  return typeof value === "string" && value.trim() ? normalizeDisplayText(value, maxLength) : value;
}

function updateNormalizationPreview() {
  const counts = { activities: 0, catalog: 0, meta: 0 };
  const changed = (value, maxLength) => normalizationCandidate(value, maxLength) !== value;
  if (dom.normalizeActivities.checked) {
    counts.activities = appDocument.activities.reduce((total, activity) => total + Number(
      changed(activity.city, 120) || changed(activity.observations, 5000)
    ), 0);
  }
  if (dom.normalizeMeta.checked) {
    counts.meta = [appDocument.calendarMeta.name, appDocument.calendarMeta.coordinator]
      .reduce((total, value) => total + Number(changed(value, 160)), 0);
  }
  if (dom.normalizeCatalog.checked) {
    const values = [
      ...appDocument.catalog.cities.flatMap((item) => [item.name]),
      ...appDocument.catalog.clients.flatMap((item) => [item.name]),
      ...appDocument.catalog.sites.flatMap((item) => [item.name, item.city, item.zone, item.shoppingCenter, item.address, item.entryConditions]),
      ...appDocument.catalog.responsibles.flatMap((item) => [item.name, item.company, item.baseCity, item.group, ...(item.coverage ?? [])])
    ];
    counts.catalog = values.reduce((total, value) => total + Number(changed(value, 240)), 0);
  }
  dom.normalizeTextPreview.textContent = `Vista previa: ${counts.activities} actividad(es), ${counts.catalog} campo(s) de catálogo y ${counts.meta} campo(s) de identificación cambiarían.`;
}

function openNormalizeTextDialog() {
  if (!hasEditControl) {
    showToast("Este cronograma está disponible únicamente en modo de solo lectura.", { type: "error" });
    return;
  }
  dom.normalizeActivities.checked = true;
  dom.normalizeCatalog.checked = false;
  dom.normalizeMeta.checked = false;
  showFormErrors(dom.normalizeTextErrors, []);
  updateNormalizationPreview();
  openDialog("normalizeTextDialog");
}

function handleNormalizeTextSubmit(event) {
  event.preventDefault();
  if (!dom.normalizeActivities.checked && !dom.normalizeCatalog.checked && !dom.normalizeMeta.checked) {
    showFormErrors(dom.normalizeTextErrors, ["Selecciona al menos un grupo de textos."]);
    return;
  }
  try {
    const outcome = mutateWithContract("document.normalize-text", {
      includeActivities: dom.normalizeActivities.checked,
      includeCatalog: dom.normalizeCatalog.checked,
      includeMeta: dom.normalizeMeta.checked
    }, "Textos visibles normalizados");
    closeDialog("normalizeTextDialog");
    showToast(`${outcome.result.counts.fields} campo(s) normalizado(s).`);
  } catch (error) {
    showFormErrors(dom.normalizeTextErrors, [error.message]);
  }
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

function stableLocalMigrationCompleted() {
  if (RUNTIME_CHANNEL !== "stable") return true;
  try {
    return localStorage.getItem(STABLE_LOCAL_MIGRATION_KEY) === "done";
  } catch {
    return false;
  }
}

function markStableLocalMigrationCompleted() {
  if (RUNTIME_CHANNEL !== "stable") return;
  try {
    localStorage.setItem(STABLE_LOCAL_MIGRATION_KEY, "done");
  } catch {
    // A future load can safely repeat the read-only preflight if storage is unavailable.
  }
}

async function readLegacyStableDocument() {
  if (RUNTIME_CHANNEL !== "stable" || stableLocalMigrationCompleted()) return null;
  let legacyDatabase = null;
  try {
    legacyDatabase = await localDocumentStore.open();
    const stored = await localDocumentStore.readDocument(legacyDatabase, "current");
    return stored ? sanitizeDocument(stored) : null;
  } catch {
    return null;
  } finally {
    legacyDatabase?.close();
  }
}

function readStoredDocument(key) {
  if (CLOUD_MODE) {
    if (key !== "current") return Promise.resolve(null);
    return cloudPersistence.read().then((record) => record?.document ?? null);
  }
  return localDocumentStore.readDocument(database, key);
}

function readStoredRecord(key) {
  if (CLOUD_MODE) return Promise.resolve(null);
  return localDocumentStore.readRecord(database, key);
}

function claimEditLock({ force = false } = {}) {
  return localDocumentStore.claimLock(database, {
    key: EDIT_LOCK_KEY,
    ownerId: tabId,
    staleAfterMs: EDIT_LOCK_STALE_MS,
    force
  });
}

async function releaseEditLock() {
  if (!database || !hasEditControl) return;
  await localDocumentStore.releaseLock(database, {
    key: EDIT_LOCK_KEY,
    ownerId: tabId
  });
}

function renderAccessMode() {
  document.body.classList.toggle("read-only", !hasEditControl);
  dom.accessBanner.hidden = hasEditControl || (!storageAvailable && !CLOUD_MODE);
  dom.takeControlButton.hidden = CLOUD_MODE || hasEditControl || !storageAvailable;
  const guardedIds = [
    "newActivityButton", "importBaseButton", "newCatalogButton", "holidayButton",
    "bulkMoveButton", "bulkStatusButton", "bulkEditButton", "bulkDeleteButton",
    "calendarSettingsButton", "importProgrammingButton", "resetDataButton", "restoreButton", "mergeJsonButton",
    "newQuarantineButton"
  ];
  for (const id of guardedIds) {
    if (dom[id]) dom[id].disabled = !hasEditControl;
  }
}

function cloudCalendarLabel(calendar) {
  const name = safeText(calendar.name || "Cronograma HVAC", 160);
  const coordinator = safeText(calendar.coordinator || "", 160);
  const userId = cloudPersistence?.getUser()?.id;
  const isOwner = calendar.created_by === userId;
  const owner = isOwner
    ? "Mi cronograma"
    : calendar.ownerName
      ? `Solo lectura · ${safeText(calendar.ownerName, 160)}`
      : "Solo lectura";
  return [name, coordinator, owner].filter(Boolean).join(" · ");
}

function renderCloudCalendarSwitcher() {
  if (!dom.cloudCalendarSwitcher || !dom.cloudCalendarSelect) return;
  if (!CLOUD_MODE || !cloudPersistence) {
    dom.cloudCalendarSwitcher.hidden = true;
    return;
  }
  const calendars = cloudPersistence.getCalendars();
  const current = cloudPersistence.getCalendar();
  setChildren(
    dom.cloudCalendarSelect,
    ...calendars.map((calendar) => option(calendar.id, cloudCalendarLabel(calendar)))
  );
  dom.cloudCalendarSelect.value = current?.id ?? "";
  dom.cloudCalendarSelect.disabled = calendars.length < 2 || cloudCalendarSwitching;
  if (dom.refreshCloudCalendarsButton) {
    dom.refreshCloudCalendarsButton.disabled = Boolean(cloudCalendarRefreshInFlight) || cloudCalendarSwitching;
    dom.refreshCloudCalendarsButton.setAttribute("aria-busy", String(Boolean(cloudCalendarRefreshInFlight)));
    dom.refreshCloudCalendarsButton.textContent = cloudCalendarRefreshInFlight ? "…" : "↻";
  }
  dom.cloudCalendarSwitcher.hidden = false;
}

async function refreshCloudCalendars({ notify = false } = {}) {
  if (!CLOUD_MODE || !cloudPersistence || cloudCalendarSwitching) return cloudPersistence?.getCalendars() ?? [];
  if (cloudCalendarRefreshInFlight) return cloudCalendarRefreshInFlight;
  cloudCalendarRefreshInFlight = (async () => {
    try {
      const calendars = await cloudPersistence.loadCalendars();
      renderCloudCalendarSwitcher();
      if (notify) showToast(`${calendars.length} cronogramas disponibles en este canal.`);
      return calendars;
    } catch (error) {
      if (notify) {
        showToast(`No se pudo actualizar la lista de cronogramas: ${error.message}`, {
          type: "error",
          duration: 9000
        });
      }
      return cloudPersistence.getCalendars();
    } finally {
      cloudCalendarRefreshInFlight = null;
      renderCloudCalendarSwitcher();
    }
  })();
  renderCloudCalendarSwitcher();
  return cloudCalendarRefreshInFlight;
}

function startCloudCalendarRefresh() {
  if (!CLOUD_MODE || !cloudPersistence) return;
  if (cloudCalendarRefreshTimer) clearInterval(cloudCalendarRefreshTimer);
  cloudCalendarRefreshTimer = window.setInterval(() => {
    if (!document.hidden && !cloudCalendarSwitching) refreshCloudCalendars().catch(() => {});
  }, CLOUD_CALENDAR_REFRESH_MS);
}

async function handleCloudCalendarChange(event) {
  if (!cloudPersistence || !event.target.value) return;
  const previousCalendarId = cloudPersistence.getCalendar()?.id ?? "";
  const previousDocument = clone(appDocument);
  const nextCalendarId = event.target.value;
  if (!nextCalendarId || nextCalendarId === previousCalendarId) return;
  cloudCalendarSwitching = true;
  renderCloudCalendarSwitcher();
  event.target.disabled = true;
  try {
    await flushSave();
    await cloudPersistence.selectCalendar(nextCalendarId);
    const current = await cloudPersistence.read();
    appDocument = current?.document ? sanitizeDocument(current.document) : createDefaultDocument();
    selectedActivityIds.clear();
    mutationController.clearUndo();
    activeDrawer = null;
    closeDrawer();
    storageAvailable = true;
    const canEdit = cloudPersistence.canEdit();
    setEditControl(
      canEdit,
      canEdit
        ? ""
        : `Este cronograma pertenece a ${cloudPersistence.getCalendar()?.ownerName || "otro usuario"} y está disponible en solo lectura.`
    );
    renderAll();
    await renderStorageStatus();
    setSaveIndicator("saved", "Guardado en Supabase");
    showToast(canEdit ? "Se abrió tu cronograma." : "Se abrió el cronograma en modo de solo lectura.");
  } catch (error) {
    if (previousCalendarId && cloudPersistence.getCalendar()?.id !== previousCalendarId) {
      try {
        await cloudPersistence.selectCalendar(previousCalendarId);
        await cloudPersistence.read();
      } catch {
        // Keep the original application document and report the switch error.
      }
    }
    appDocument = previousDocument;
    event.target.value = previousCalendarId;
    showToast(`No se pudo abrir el cronograma: ${error.message}`, { type: "error", duration: 9000 });
  } finally {
    cloudCalendarSwitching = false;
    renderCloudCalendarSwitcher();
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
  return localDocumentStore.writeWithRecovery(database, documentSnapshot);
}

function replaceCurrentDocument(documentSnapshot) {
  if (CLOUD_MODE) return cloudPersistence.write(documentSnapshot);
  return localDocumentStore.replaceCurrent(database, documentSnapshot);
}

function clearStoredDocuments() {
  if (CLOUD_MODE) return Promise.resolve();
  if (!database) return Promise.resolve();
  return localDocumentStore.clearDocuments(database);
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
  return mutationController.mutate(action, detail, callback, { undo, toast });
}

function mutateWithContract(operation, payload, detail, { undo = true, toast = detail } = {}) {
  return mutationController.mutateWithContract(operation, payload, detail, { undo, toast });
}

function undoLastMutation() {
  mutationController.undo();
}

function showToast(message, { type = "normal", undo = false, duration = 5000 } = {}) {
  const toast = createElement("div", `toast ${type === "error" ? "error" : ""}`.trim());
  const copy = createElement("span", "", safeText(message, 500));
  toast.append(copy);
  if (undo && mutationController?.hasUndo()) {
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

mutationController = createMutationController({
  getDocument: () => appDocument,
  setDocument: (documentSnapshot) => { appDocument = documentSnapshot; },
  canEdit: () => hasEditControl,
  cloneDocument: clone,
  executeOperation: executeCalendarOperation,
  appendAudit,
  appVersion: APP_VERSION,
  schemaVersion: SCHEMA_VERSION,
  holidayRuleSetVersion: HOLIDAY_RULESET_VERSION,
  render: renderAll,
  scheduleSave,
  notify: showToast,
  afterUndo: () => {
    selectedActivityIds.clear();
    activeDrawer = null;
    closeDrawer();
  }
});

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

function activityObservationsTooltip(activity) {
  const observations = safeText(activity.observations, 500);
  return observations ? `Observaciones: ${observations}` : "Sin observaciones registradas";
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
  const dateFrom = appDocument.settings.filters.dateFrom;
  const dateTo = appDocument.settings.filters.dateTo;
  if (dateFrom || dateTo) {
    count += 1;
    const chip = createElement("button", "filter-chip", `Fecha: ${dateFrom || "…"} → ${dateTo || "…"} ×`);
    chip.type = "button";
    chip.addEventListener("click", () => {
      appDocument.settings.filters.dateFrom = null;
      appDocument.settings.filters.dateTo = null;
      renderAll();
      scheduleSave();
    });
    chips.append(chip);
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
  dom.filterDateFrom.value = appDocument.settings.filters.dateFrom ?? "";
  dom.filterDateTo.value = appDocument.settings.filters.dateTo ?? "";
  dom.filterDateError.hidden = true;
  dom.filterDateError.textContent = "";
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
    planningBuckets: [],
    dateFrom: null,
    dateTo: null
  };
  if (close) closeDialog("filterDialog");
  renderAll();
  scheduleSave();
}

function handleFilterSubmit(event) {
  event.preventDefault();
  const dateFrom = dom.filterDateFrom.value || null;
  const dateTo = dom.filterDateTo.value || null;
  try {
    if (dateFrom) parseISODate(dateFrom);
    if (dateTo) parseISODate(dateTo);
    if (dateFrom && dateTo && compareISODate(dateTo, dateFrom) < 0) {
      throw new TypeError("La fecha final no puede ser anterior a la inicial.");
    }
  } catch (error) {
    dom.filterDateError.textContent = error.message;
    dom.filterDateError.hidden = false;
    return;
  }
  for (const definition of filterDefinitions()) {
    appDocument.settings.filters[definition.key] = [
      ...dom.filterGrid.querySelectorAll(`input[name="filter-${definition.key}"]:checked`)
    ].map((input) => input.value);
  }
  appDocument.settings.filters.dateFrom = dateFrom;
  appDocument.settings.filters.dateTo = dateTo;
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
    const role = cloudPersistence?.canEdit() ? " · edición propia" : " · solo lectura";
    dom.storageStatusTitle.textContent = "Datos guardados en Supabase";
    dom.storageStatusText.textContent = user?.email
      ? `Base compartida · ${user.email}${role}`
      : `Base compartida · sesión autenticada${role}`;
    dom.requestPersistenceButton.hidden = true;
    dom.cloudSignOutButton.hidden = false;
    renderCloudCalendarSwitcher();
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
  if (!["beta", "stable", "local"].includes(RUNTIME_CHANNEL)) return;
  // Local keeps its own runtime and IndexedDB, but intentionally inherits the
  // approved beta visual contract until a local-only visual contract exists.
  document.documentElement.dataset.channel = RUNTIME_CHANNEL === "local" ? "beta" : RUNTIME_CHANNEL;
  document.documentElement.dataset.runtimeChannel = RUNTIME_CHANNEL;
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
  renderCloudCalendarSwitcher();
  if (activeDrawer?.type === "activity") renderActivityDrawer(activeDrawer.id);
  if (activeDrawer?.type === "day") renderDayDrawer(activeDrawer.date);
}

function updateCatalogPanelState() {
  for (const [tabName, tabElement] of [
    ["sites", dom.sitesTab],
    ["responsibles", dom.responsiblesTab],
    ["quarantine", dom.quarantineTab]
  ]) {
    const selected = catalogTab === tabName;
    tabElement.classList.toggle("active", selected);
    tabElement.setAttribute("aria-selected", String(selected));
  }
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
}

function renderQuarantineCatalog(query) {
  const fragment = document.createDocumentFragment();
  const maps = lookupMaps();
  const items = appDocument.activities
    .filter((activity) => isQuarantineActivity(activity))
    .filter((activity) => matchesActivityFilters(activity, maps))
    .filter((activity) => !query || activitySearchText(activity, maps).includes(query))
    .sort((left, right) => (
      (left.updatedAt ?? "").localeCompare(right.updatedAt ?? "") || left.id.localeCompare(right.id)
    ));
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
}

function appendSiteCatalog(fragment, query) {
  const activeClients = appDocument.catalog.clients
    .filter((client) => client.active !== false)
    .sort((left, right) => left.name.localeCompare(right.name, "es"));
  for (const client of activeClients) {
    const clientSites = appDocument.catalog.sites
      .filter((site) => site.clientId === client.id && site.active !== false)
      .filter((site) => !query || normalizeText(client.name + " " + site.name + " " + site.city).includes(query))
      .sort((left, right) => left.name.localeCompare(right.name, "es"));
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
    editClient.title = "Editar " + client.name;
    editClient.setAttribute("aria-label", "Editar cliente " + client.name);
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
      edit.title = "Editar " + site.name;
      edit.setAttribute("aria-label", "Editar sede " + site.name);
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
}

function appendResponsibleCatalog(fragment, query) {
  const responsibles = appDocument.catalog.responsibles
    .filter((item) => item.active !== false)
    .filter((item) => !query || normalizeText(
      item.name + " " + item.company + " " + item.baseCity + " " + item.group
    ).includes(query))
    .sort((left, right) => {
      if (Boolean(left.favorite) !== Boolean(right.favorite)) return left.favorite ? -1 : 1;
      if (left.responsibleType !== right.responsibleType) {
        return left.responsibleType === "payroll" ? -1 : 1;
      }
      return left.name.localeCompare(right.name, "es");
    });
  for (const responsible of responsibles) {
    const row = createElement("div", "responsible-row");
    const contractorClass = responsible.responsibleType === "contractor" ? "contractor" : "";
    row.append(createElement("span", ("responsible-type-dot " + contractorClass).trim()));
    const main = createElement("span", "catalog-main");
    main.append(createElement("strong", "", (responsible.favorite ? "★ " : "") + responsible.name));
    main.append(createElement("small", "", [
      RESPONSIBLE_TYPES[responsible.responsibleType] ?? responsible.responsibleType,
      responsible.baseCity
    ].filter(Boolean).join(" · ")));
    row.append(main);
    const edit = createElement("button", "mini-edit", "✎");
    edit.type = "button";
    edit.title = "Editar " + responsible.name;
    edit.setAttribute("aria-label", "Editar responsable " + responsible.name);
    edit.addEventListener("click", () => openCatalogDialog("responsible", responsible.id));
    row.append(edit);
    fragment.append(row);
  }
}

function renderCatalog() {
  updateCatalogPanelState();
  const query = normalizeText(dom.catalogSearch.value);
  if (catalogTab === "quarantine") {
    renderQuarantineCatalog(query);
    return;
  }

  dom.emptyImportButton.hidden = false;
  dom.emptyCatalog.querySelector("strong").textContent = "Aún no hay catálogo";
  dom.emptyCatalog.querySelector("p").textContent = "Importa la Base Operativa o crea tus primeros registros manualmente.";
  const fragment = document.createDocumentFragment();
  if (catalogTab === "sites") appendSiteCatalog(fragment, query);
  else appendResponsibleCatalog(fragment, query);

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

function appendActivityCardSelection(card, activity, quarantine) {
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
}

function bindActivityCardInteractions(card, activity) {
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
  card.addEventListener("dragover", (event) => handleActivityCardDragOver(event, activity));
  card.addEventListener("dragleave", (event) => handleActivityCardDragLeave(event, activity));
  card.addEventListener("drop", (event) => handleActivityCardDrop(event, activity));
  card.addEventListener("dragend", () => {
    dragContext = null;
    document.querySelectorAll(".day-cell.drag-over").forEach((cell) => cell.classList.remove("drag-over"));
    clearReorderMarkers();
    clearPlanningBucketDropState();
  });
}

function buildActivityCard(activity, maps, { quarantine = false } = {}) {
  const client = maps.clients.get(activity.clientId);
  const site = maps.sites.get(activity.siteId);
  const serviceLabel = SERVICE_TYPES[activity.serviceType] ?? "Tipo de servicio";
  const serviceCode = SERVICE_CODES[activity.serviceType] ?? "SV";
  const title = activity.serviceType === "administrative" && !client
    ? "Administrativo"
    : client?.name ?? serviceLabel ?? "Cliente sin catálogo";
  const observationSummary = safeText(activity.observations, 240);
  const card = createElement("article", `activity-card ${responsibleVisualClass(activity, maps)} ${activity.status.replaceAll("_", "-")}${quarantine ? " quarantine-card" : ""}`);
  card.draggable = hasEditControl;
  card.dataset.activityId = activity.id;
  card.dataset.serviceCode = serviceCode;
  card.title = activityObservationsTooltip(activity);
  card.setAttribute(
    "aria-label",
    `${title}${site?.name ? `, ${site.name}` : ""}, tipo de servicio: ${serviceLabel}, estado: ${ACTIVITY_STATUSES[activity.status]}${observationSummary ? `, observaciones: ${observationSummary}` : ""}`
  );
  if (selectedActivityIds.has(activity.id)) card.classList.add("selected");

  appendActivityCardSelection(card, activity, quarantine);

  const copyBlock = createElement("span", "activity-copy");
  const assigned = activity.responsibleIds
    .map((id) => maps.responsibles.get(id))
    .filter(Boolean)
    .map((item) => item.initials || displayInitialsFor(item.name))
    .join(" · ");
  copyBlock.append(createElement("strong", "", title));
  const metadata = [
    site?.name || activity.city,
    assigned || "Sin responsable",
    quarantine ? PLANNING_BUCKETS.quarantine : ""
  ].filter(Boolean).join(" · ");
  const small = createElement("small");
  const serviceCodeElement = createElement("span", "service-code", serviceCode);
  serviceCodeElement.title = activityObservationsTooltip(activity);
  serviceCodeElement.setAttribute("aria-hidden", "true");
  small.append(serviceCodeElement);
  if (metadata) small.append(document.createTextNode(` · ${metadata}`));
  copyBlock.append(small);
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

  bindActivityCardInteractions(card, activity);
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

function buildDayOverflowButton(date, items, maps) {
  const additional = items.slice(MAX_VISIBLE_CARDS);
  const previewItems = additional.slice(0, 4);
  const countLabel = additional.length === 1
    ? "1 actividad adicional"
    : `${additional.length} actividades adicionales`;
  const visibleCountLabel = additional.length === 1
    ? "1 por ver"
    : `${additional.length} por ver`;
  const button = createElement("button", "day-overflow");
  button.type = "button";
  button.dataset.additionalCount = String(additional.length);
  button.title = `Ver las ${items.length} actividades del ${formatDisplayDate(date)}`;
  button.setAttribute(
    "aria-label",
    `Abrir agenda completa del ${formatDisplayDate(date)}. ${items.length} actividades en total; ${countLabel}.`
  );
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-controls", "detailDrawer");

  const stack = createElement("span", "day-overflow-stack");
  stack.setAttribute("aria-hidden", "true");
  for (const [index, activity] of previewItems.entries()) {
    const client = maps.clients.get(activity.clientId);
    const serviceCode = SERVICE_CODES[activity.serviceType] ?? "SV";
    const serviceLabel = SERVICE_TYPES[activity.serviceType] ?? "Actividad";
    const title = activity.serviceType === "administrative" && !client
      ? "Administrativo"
      : client?.name ?? serviceLabel;
    const preview = createElement(
      "span",
      `day-overflow-card ${responsibleVisualClass(activity, maps)} ${activity.status.replaceAll("_", "-")}`
    );
    preview.style.setProperty("--stack-index", String(index));
    preview.title = `${title} · ${serviceLabel} · ${ACTIVITY_STATUSES[activity.status]}`;
    preview.append(
      createElement("span", "day-overflow-service", `${serviceCode} ${STATUS_ICONS[activity.status] ?? "•"}`),
      createElement("span", "day-overflow-title", title)
    );
    stack.append(preview);
  }

  const copy = createElement("span", "day-overflow-copy");
  copy.append(
    createElement("strong", "", visibleCountLabel),
    createElement("small", "", "Abrir día")
  );
  button.append(stack, copy, createElement("span", "day-overflow-arrow", "↗"));
  button.addEventListener("click", () => renderDayDrawer(date));
  return button;
}

function buildDayNumberButton(date, preferredFocusDate, gridDates) {
  const number = createElement("button", "day-number", String(Number(date.slice(8, 10))));
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
  return number;
}

function bindDayCardReorder(cardContainer, date, activitiesByDate) {
  const canReorderPayload = (payload) => {
    const itemsForDate = activitiesByDate.get(date) ?? [];
    const anchor = payload?.type === "activity"
      ? appDocument.activities.find((activity) => activity.id === payload.anchorId)
      : null;
    if (!anchor || hasActiveActivityFilters() || isQuarantineActivity(anchor) || anchor.date !== date) {
      return false;
    }
    return !payload.activityIds.some(
      (id) => id !== anchor.id && !itemsForDate.some((activity) => activity.id === id)
    );
  };
  cardContainer.addEventListener("dragover", (event) => {
    if (!canReorderPayload(dragContext)) return;
    event.preventDefault();
    event.stopPropagation();
    clearReorderMarkers();
    const bounds = event.currentTarget.getBoundingClientRect();
    const position = event.clientY <= bounds.top + bounds.height / 2 ? "first" : "last";
    event.currentTarget.classList.add(position === "first" ? "reorder-first" : "reorder-last");
    event.currentTarget.dataset.reorderPosition = position;
    event.dataTransfer.dropEffect = "move";
  });
  cardContainer.addEventListener("drop", (event) => {
    const payload = dragContext;
    if (!canReorderPayload(payload)) return;
    event.preventDefault();
    event.stopPropagation();
    const position = event.currentTarget.dataset.reorderPosition || "last";
    dragContext = null;
    applyActivityReorder(payload, null, position);
  });
}

function bindCalendarCellInteractions(cell, date, holidays) {
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
}

function buildCalendarDayCell({
  date,
  month,
  today,
  agendaDate,
  preferredFocusDate,
  holidays,
  activitiesByDate,
  maps,
  gridDates
}) {
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
  header.append(buildDayNumberButton(date, preferredFocusDate, gridDates));
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
  if (items.length > MAX_VISIBLE_CARDS) cell.classList.add("has-overflow");
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
    cardContainer.append(buildDayOverflowButton(date, items, maps));
  }
  cell.append(cardContainer);
  bindDayCardReorder(cardContainer, date, activitiesByDate);
  bindCalendarCellInteractions(cell, date, holidays);
  return cell;
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
  for (const items of activitiesByDate.values()) items.sort(compareActivityOrder);

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
    fragment.append(buildCalendarDayCell({
      date,
      month,
      today,
      agendaDate,
      preferredFocusDate,
      holidays,
      activitiesByDate,
      maps,
      gridDates
    }));
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
    dom.dropExtendRangeButton.hidden = payload.activityIds.length !== 1;
    openDialog("dropActionDialog");
  }
}

function hasActiveActivityFilters() {
  const filters = appDocument.settings.filters ?? {};
  return Boolean(filters.query?.trim()) || [
    "cities", "clients", "sites", "responsibles", "serviceTypes", "statuses", "planningBuckets"
  ].some((key) => Array.isArray(filters[key]) && filters[key].length) || Boolean(filters.dateFrom || filters.dateTo);
}

function calendarActivitiesForDate(date, maps = lookupMaps()) {
  return appDocument.activities
    .filter((activity) => !isQuarantineActivity(activity) && activity.date === date)
    .sort(compareActivityOrder);
}

function clearReorderMarkers() {
  document.querySelectorAll(".reorder-before, .reorder-after, .reorder-first, .reorder-last").forEach((element) => {
    element.classList.remove("reorder-before", "reorder-after", "reorder-first", "reorder-last");
    delete element.dataset.reorderPosition;
  });
}

function sameDayReorderPayload(payload, targetActivity) {
  if (!payload || payload.type !== "activity" || !payload.activityIds?.length || hasActiveActivityFilters()) return false;
  if (payload.activityIds.includes(targetActivity.id)) return false;
  const selected = payload.activityIds
    .map((id) => appDocument.activities.find((activity) => activity.id === id))
    .filter(Boolean);
  return selected.length === payload.activityIds.length && selected.every((activity) => (
    !isQuarantineActivity(activity) && activity.date && activity.date === targetActivity.date
  ));
}

function reorderPositionFromPointer(event, target) {
  const rectangle = target.getBoundingClientRect();
  return event.clientY <= rectangle.top + rectangle.height / 2 ? "before" : "after";
}

function handleActivityCardDragOver(event, targetActivity) {
  if (!sameDayReorderPayload(dragContext, targetActivity)) return;
  event.preventDefault();
  event.stopPropagation();
  const position = reorderPositionFromPointer(event, event.currentTarget);
  clearReorderMarkers();
  event.currentTarget.classList.add(position === "before" ? "reorder-before" : "reorder-after");
  event.currentTarget.dataset.reorderPosition = position;
  event.dataTransfer.dropEffect = "move";
}

function handleActivityCardDragLeave(event) {
  if (event.currentTarget.contains(event.relatedTarget)) return;
  event.currentTarget.classList.remove("reorder-before", "reorder-after");
  delete event.currentTarget.dataset.reorderPosition;
}

function applyActivityReorder(payload, targetId, position) {
  if (!payload?.activityIds?.length) return;
  const target = targetId ? appDocument.activities.find((activity) => activity.id === targetId) : null;
  const anchor = appDocument.activities.find((activity) => activity.id === payload.anchorId);
  const targetDate = target?.date ?? anchor?.date;
  if (!targetDate) return;
  try {
    const outcome = mutateWithContract("activity.reorder", {
      activityIds: payload.activityIds,
      targetId,
      targetDate,
      position
    }, `${payload.activityIds.length} tarjeta${payload.activityIds.length === 1 ? "" : "s"} reordenada${payload.activityIds.length === 1 ? "" : "s"}`);
    if (outcome.changed) clearActivitySelection();
  } catch (error) {
    showToast(error.message, { type: "error" });
  } finally {
    clearReorderMarkers();
  }
}

function handleActivityCardDrop(event, targetActivity) {
  if (!sameDayReorderPayload(dragContext, targetActivity)) return;
  event.preventDefault();
  event.stopPropagation();
  const payload = dragContext;
  const position = event.currentTarget.dataset.reorderPosition || reorderPositionFromPointer(event, event.currentTarget);
  dragContext = null;
  applyActivityReorder(payload, targetActivity.id, position);
}

function applyPendingDrop(action) {
  if (!pendingDrop) return;
  const payload = pendingDrop;
  pendingDrop = null;
  closeDialog("dropActionDialog");
  try {
    if (action === "extend-range") {
      if (payload.activityIds.length !== 1) throw new TypeError("Sólo se puede ampliar una tarjeta a la vez.");
      const source = appDocument.activities.find((item) => item.id === payload.activityIds[0]);
      const fromDate = source && compareISODate(source.date, payload.date) <= 0 ? source.date : payload.date;
      const toDate = source && compareISODate(source.date, payload.date) >= 0 ? source.date : payload.date;
      openSeriesRangeDialog(payload.activityIds[0], {
        fromDate,
        toDate
      });
      return;
    }
    if (action === "move") {
      const label = payload.activityIds.length > 1
        ? `${payload.activityIds.length} tarjetas movidas`
        : "Actividad movida";
      const outcome = mutateWithContract("activity.move", {
        activityIds: payload.activityIds,
        targetDate: payload.date,
        anchorId: payload.anchorId,
        mode: "preserve",
        allowNonWorking: true
      }, label);
      if (outcome.changed) clearActivitySelection();
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
      if (outcome.changed) clearActivitySelection();
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

function openSeriesRangeDialog(activityId, { fromDate = null, toDate = null } = {}) {
  const activity = appDocument.activities.find((item) => item.id === activityId);
  if (!activity || !hasEditControl || isQuarantineActivity(activity)) return;
  pendingSeriesRangeActivityId = activityId;
  seriesRangeForcedDates = new Set();
  const start = fromDate && toDate && compareISODate(fromDate, toDate) <= 0
    ? fromDate
    : fromDate && compareISODate(fromDate, activity.date) < 0
      ? fromDate
      : activity.date;
  const end = toDate && compareISODate(toDate, start) >= 0
    ? toDate
    : addDaysISO(activity.date, 7);
  dom.seriesRangeFrom.value = start;
  dom.seriesRangeTo.value = end;
  dom.seriesRangeIncludeNonWorking.checked = false;
  dom.seriesRangeSummary.textContent = `Actividad del ${formatDisplayDate(activity.date)}. Las fechas existentes de esta misma actividad se conservarán sin duplicarse.`;
  showFormErrors(dom.seriesRangeErrors, []);
  updateSeriesRangePreview();
  openDialog("seriesRangeDialog");
}

function updateSeriesRangePreview() {
  const activity = appDocument.activities.find((item) => item.id === pendingSeriesRangeActivityId);
  const fromDate = dom.seriesRangeFrom.value;
  const toDate = dom.seriesRangeTo.value;
  if (!activity || !fromDate || !toDate || compareISODate(toDate, fromDate) < 0) {
    dom.seriesRangePreview.hidden = true;
    dom.seriesRangePreview.replaceChildren();
    return;
  }
  const holidays = holidayMapForRange(fromDate, toDate, appDocument.holidayOverrides);
  const generated = generateSeriesDates(fromDate, toDate, holidays, {
    includeAllNonWorking: dom.seriesRangeIncludeNonWorking.checked,
    forceIncludeDates: [...seriesRangeForcedDates]
  });
  const existing = new Set(
    appDocument.activities
      .filter((item) => item.seriesId && item.seriesId === activity.seriesId)
      .map((item) => item.date)
  );
  if (!activity.seriesId) existing.add(activity.date);
  const wrapper = createElement("div");
  const newDates = generated.included.filter((date) => !existing.has(date));
  wrapper.append(createElement("strong", "", `${newDates.length} tarjeta${newDates.length === 1 ? "" : "s"} nueva${newDates.length === 1 ? "" : "s"} se crearán.`));
  if (generated.included.length && newDates.length < generated.included.length) {
    wrapper.append(createElement("p", "", `${generated.included.length - newDates.length} fecha${generated.included.length - newDates.length === 1 ? "" : "s"} ya pertenece${generated.included.length - newDates.length === 1 ? "" : "n"} a esta actividad.`));
  }
  for (const item of generated.omitted) {
    const label = createElement("label", "check-row");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = seriesRangeForcedDates.has(item.date);
    checkbox.dataset.forceDate = item.date;
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) seriesRangeForcedDates.add(item.date);
      else seriesRangeForcedDates.delete(item.date);
      updateSeriesRangePreview();
    });
    label.append(checkbox, createElement("span", "", `${formatDisplayDate(item.date, { weekday: "long" })}: ${item.reason}. Incluir sólo esta fecha`));
    wrapper.append(label);
  }
  dom.seriesRangePreview.replaceChildren(wrapper);
  dom.seriesRangePreview.hidden = false;
}

function applySeriesRangeAction(mode) {
  const activityId = pendingSeriesRangeActivityId;
  const fromDate = dom.seriesRangeFrom.value;
  const toDate = dom.seriesRangeTo.value;
  if (!activityId || !fromDate || !toDate) return;
  try {
    const outcome = mutateWithContract("activity.extend-range", {
      activityId,
      fromDate,
      toDate,
      mode,
      includeNonWorking: dom.seriesRangeIncludeNonWorking.checked,
      forceIncludeDates: [...seriesRangeForcedDates]
    }, mode === "extend" ? "Actividad ampliada al rango" : "Actividad duplicada al rango");
    if (outcome.warnings?.length) {
      showToast(`${outcome.warnings.length} fecha(s) se omitieron o requieren revisión.`, { duration: 7000 });
    }
    closeDialog("seriesRangeDialog");
    pendingSeriesRangeActivityId = null;
    seriesRangeForcedDates = new Set();
    clearActivitySelection();
    if (outcome.result.activityIds?.[0]) renderActivityDrawer(outcome.result.activityIds[0]);
  } catch (error) {
    showFormErrors(dom.seriesRangeErrors, [error.message]);
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

function appendActivityDrawerActions(body, activity, activityId) {
  const actions = createElement("div", "detail-actions");
  const edit = createElement("button", "button small", "Editar tarjeta");
  edit.type = "button";
  edit.disabled = !hasEditControl;
  edit.addEventListener("click", () => openActivityDialog({ activityId }));
  const quarantineActivity = isQuarantineActivity(activity);
  const organizeLabel = quarantineActivity ? "Asignar fecha" : "Mover · Duplicar · Ampliar";
  const organize = createElement("button", "button small", organizeLabel);
  organize.type = "button";
  organize.disabled = !hasEditControl;
  organize.addEventListener("click", () => quarantineActivity
    ? openQuarantineAssignDialog(activityId)
    : openActivityDateActionDialog(activityId));
  if (!quarantineActivity && ["scheduled", "confirmed"].includes(activity.status)) {
    const quarantine = createElement("button", "button small", "Enviar a Pendiente");
    quarantine.type = "button";
    quarantine.disabled = !hasEditControl;
    quarantine.addEventListener("click", () => openQuarantineDialog(activityId));
    actions.append(quarantine);
  }
  const remove = createElement("button", "button small ghost", "Eliminar");
  remove.type = "button";
  remove.disabled = !hasEditControl;
  remove.addEventListener("click", () => deleteActivity(activityId));
  actions.append(edit, organize, remove);
  body.append(actions);

  if (!quarantineActivity && activity.date && hasEditControl) {
    const order = calendarActivitiesForDate(activity.date);
    const index = order.findIndex((item) => item.id === activity.id);
    const orderActions = createElement("div", "detail-actions reorder-actions");
    const controls = [
      ["first", "Primera", index <= 0],
      ["previous", "Anterior", index <= 0],
      ["next", "Siguiente", index < 0 || index >= order.length - 1],
      ["last", "Última", index < 0 || index >= order.length - 1]
    ];
    for (const [direction, label, disabled] of controls) {
      const button = createElement("button", "button small ghost", label);
      button.type = "button";
      button.disabled = disabled;
      button.addEventListener("click", () => moveActivityWithinDay(activity.id, direction));
      orderActions.append(button);
    }
    body.append(detailItem("Orden en el día", orderActions, { wide: true }));
  }
}

function appendActivityStatusEditor(body, activity, activityId) {
  const statusEditor = createElement("div", "detail-item detail-item-wide");
  if (isQuarantineActivity(activity)) {
    statusEditor.append(createElement("span", "", "Estado operativo"));
    statusEditor.append(createElement("p", "", "Pendiente · actividad por programar. Asigna una fecha para devolverla al calendario."));
    body.append(statusEditor);
    return;
  }

  statusEditor.append(createElement("span", "", "Actualizar estado"));
  const statusSelect = document.createElement("select");
  statusSelect.id = "drawerStatusSelect";
  statusSelect.setAttribute("aria-label", "Nuevo estado de la actividad");
  statusSelect.disabled = !hasEditControl;
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
    input.disabled = !hasEditControl;
    labelElement.append(input, createElement("span", "", label));
    scopeRow.append(labelElement);
  }
  const apply = createElement("button", "button primary small", "Aplicar estado");
  apply.type = "button";
  apply.disabled = !hasEditControl;
  apply.addEventListener("click", () => {
    const scope = scopeRow.querySelector("input:checked")?.value ?? "single";
    updateActivityStatus(activityId, statusSelect.value, scope);
  });
  statusEditor.append(statusSelect, scopeRow, apply);
  body.append(statusEditor);
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
  badgeRow.append(createElement("span", "service-badge", SERVICE_SHORT_LABELS[activity.serviceType] ?? activity.serviceType));
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

  appendActivityDrawerActions(body, activity, activityId);
  appendActivityStatusEditor(body, activity, activityId);

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
  const allItems = calendarActivitiesForDate(date, maps);
  const items = allItems.filter((activity) => matchesActivityFilters(activity, maps));
  const body = createElement("div", "detail-grid day-detail-grid");
  const reorderEnabled = hasEditControl && !hasActiveActivityFilters() && items.length > 1;
  if (!items.length) {
    body.append(createElement(
      "p",
      "",
      allItems.length ? "No hay actividades visibles con los filtros activos." : "No hay actividades programadas."
    ));
  }
  if (items.length > 1 && hasEditControl) {
    body.append(createElement(
      "p",
      "field-note day-reorder-hint",
      reorderEnabled
        ? "Arrastra una tarjeta sobre otra para cambiar el orden; suelta antes o después."
        : "Quita los filtros activos para reordenar todas las tarjetas del día."
    ));
  }
  for (const activity of items) {
    const card = buildActivityCard(activity, maps);
    card.draggable = reorderEnabled;
    body.append(card);
  }
  const add = createElement("button", "button primary", "Nueva actividad en esta fecha");
  add.type = "button";
  add.disabled = !hasEditControl;
  add.addEventListener("click", () => openActivityDialog({ date }));
  body.append(add);
  dom.drawerBody.replaceChildren(body);
  openDrawer();
}

function moveActivityWithinDay(activityId, direction) {
  const activity = appDocument.activities.find((item) => item.id === activityId);
  if (!activity?.date || isQuarantineActivity(activity)) return;
  const items = calendarActivitiesForDate(activity.date);
  const index = items.findIndex((item) => item.id === activityId);
  if (index < 0) return;
  if (["first", "previous"].includes(direction) && index === 0) return;
  if (["last", "next"].includes(direction) && index === items.length - 1) return;
  const payload = { type: "activity", activityIds: [activityId], anchorId: activityId };
  if (direction === "first" || direction === "last") {
    applyActivityReorder(payload, null, direction);
    return;
  }
  const target = direction === "previous" ? items[index - 1] : items[index + 1];
  applyActivityReorder(payload, target.id, direction === "previous" ? "before" : "after");
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
  if (!hasEditControl) {
    showToast("Este cronograma está disponible únicamente en modo de solo lectura.", { type: "error" });
    return;
  }
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
    ...clients.map((item) => option(item.id, item.name))
  );
  dom.activityClient.value = clientId || "";
  setChildren(
    dom.clientSuggestions,
    ...clients.map((item) => option(item.name, item.name))
  );
  dom.activityClientText.value = clients.find((item) => item.id === clientId)?.name ?? "";
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
  setChildren(
    dom.responsibleSuggestions,
    ...appDocument.catalog.responsibles
      .filter((item) => item.active !== false)
      .sort((a, b) => a.name.localeCompare(b.name, "es"))
      .map((item) => option(item.name, item.name))
  );
  const selectedNames = responsibleIds
    .map((id) => appDocument.catalog.responsibles.find((item) => item.id === id)?.name)
    .filter(Boolean);
  dom.activityResponsibleText.value = selectedNames.join(", ");
  renderResponsiblePicker(responsibleIds);
}

function populateSiteSelect(clientId, selectedSiteId = "") {
  const sites = appDocument.catalog.sites
    .filter((site) => (!clientId || site.clientId === clientId))
    .filter((site) => site.active !== false || site.id === selectedSiteId)
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
  setChildren(
    dom.activitySite,
    ...sites.map((site) => option(site.id, `${site.name}${site.city ? ` · ${site.city}` : ""}`))
  );
  dom.activitySite.value = sites.some((site) => site.id === selectedSiteId) ? selectedSiteId : "";
  setChildren(
    dom.siteSuggestions,
    ...sites.map((site) => option(site.name, `${site.name}${site.city ? ` · ${site.city}` : ""}`))
  );
  dom.activitySiteText.value = sites.find((site) => site.id === selectedSiteId)?.name ?? "";
}

function responsibleScore(responsible, city) {
  return responsibleCoverageScore(responsible, city, appDocument.catalog.responsibles);
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
    dom.activityClientText.value = appDocument.catalog.clients.find((item) => item.id === site.clientId)?.name ?? dom.activityClientText.value;
    dom.activitySiteText.value = site.name;
    dom.activityCity.value = site.city || dom.activityCity.value;
  }
  renderResponsiblePicker();
}

function resolveActivityClientText() {
  const value = safeText(dom.activityClientText.value, 160);
  const client = appDocument.catalog.clients.find((item) => normalizeText(item.name) === normalizeText(value));
  dom.activityClient.value = client?.id ?? "";
  populateSiteSelect(client?.id ?? "", "");
  renderResponsiblePicker();
}

function resolveActivitySiteText() {
  const value = safeText(dom.activitySiteText.value, 160);
  const clientId = dom.activityClient.value || null;
  const site = appDocument.catalog.sites.find((item) => (
    normalizeText(item.name) === normalizeText(value) && (!clientId || item.clientId === clientId)
  ));
  dom.activitySite.value = site?.id ?? "";
  if (site?.city) dom.activityCity.value = site.city;
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
  if (!hasEditControl) {
    showToast("Este cronograma está disponible únicamente en modo de solo lectura.", { type: "error" });
    return;
  }
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
  dom.activityClientText.value = appDocument.catalog.clients.find((item) => item.id === resolvedClient)?.name ?? "";
  dom.activitySiteText.value = appDocument.catalog.sites.find((item) => item.id === resolvedSite)?.name ?? "";
  dom.activityResponsibleType.value = "contractor";
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
  const typedResponsibleNames = [...new Set(safeText(dom.activityResponsibleText.value, 1000)
    .split(/[;,\n]/)
    .map((item) => safeText(item, 240))
    .filter(Boolean))];
  const knownResponsibleNames = new Map(appDocument.catalog.responsibles.map((item) => [normalizeText(item.name), item.id]));
  for (const name of typedResponsibleNames) {
    const id = knownResponsibleNames.get(normalizeText(name));
    if (id && !responsibleIds.includes(id)) responsibleIds.push(id);
  }
  const clientName = safeText(dom.activityClientText.value, 160) || null;
  const siteName = safeText(dom.activitySiteText.value, 160) || null;
  const client = appDocument.catalog.clients.find((item) => normalizeText(item.name) === normalizeText(clientName));
  const site = appDocument.catalog.sites.find((item) => (
    normalizeText(item.name) === normalizeText(siteName) && (!client?.id || item.clientId === client.id)
  ));
  return {
    date: dom.activityDialog.dataset.planningBucket === "quarantine" ? null : dom.activityDate.value,
    endDate: dom.activityDialog.dataset.planningBucket === "quarantine"
      ? null
      : dom.activityEndDate.value || dom.activityDate.value,
    planningBucket: dom.activityDialog.dataset.planningBucket || "calendar",
    includeNonWorking: dom.includeNonWorking.checked,
    forceIncludeDates: [...forcedRangeDates],
    clientId: client?.id ?? dom.activityClient.value ?? null,
    siteId: site?.id ?? dom.activitySite.value ?? null,
    clientName,
    siteName,
    responsibleNames: typedResponsibleNames,
    newResponsibleType: dom.activityResponsibleType.value,
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
    clientId: input.clientId || (input.clientName ? "typed-client" : null),
    siteId: input.siteId || (input.siteName ? "typed-site" : null),
    responsibleIds: input.responsibleIds.length || input.responsibleNames?.length ? ["typed-responsible"] : []
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
  if (!hasEditControl) {
    showFormErrors(dom.resetDataErrors, ["Este cronograma está disponible únicamente en modo de solo lectura."]);
    return;
  }
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
    mutationController.clearUndo();
    selectedActivityIds.clear();
    activeDrawer = null;
    if (dom.resetPreferences.checked) {
      uiPreferences.clear();
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

async function exportQuarantineImage() {
  const darkExport = document.documentElement.dataset.theme === "dark";
  const palette = darkExport
    ? { page: "#101713", header: "#315f35", headerText: "#f4faf5", text: "#edf4ee", secondary: "#c1ccc3", row: "#202b23", grid: "#465247" }
    : { page: "#f5f7f3", header: "#4f7d32", headerText: "#ffffff", text: "#1e2a21", secondary: "#566057", row: "#ffffff", grid: "#cfd8cf" };
  const maps = lookupMaps();
  const pending = appDocument.activities
    .filter((activity) => isQuarantineActivity(activity) && matchesActivityFilters(activity, maps))
    .sort((a, b) => (a.updatedAt ?? "").localeCompare(b.updatedAt ?? "") || a.id.localeCompare(b.id));
  const logicalWidth = 1320;
  const headerHeight = 176;
  const rowHeight = 88;
  const legendHeight = 72;
  const logicalHeight = headerHeight + Math.max(1, pending.length) * rowHeight + legendHeight;
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = logicalWidth * scale;
  canvas.height = logicalHeight * scale;
  const context = canvas.getContext("2d");
  context.scale(scale, scale);
  context.fillStyle = palette.page;
  context.fillRect(0, 0, logicalWidth, logicalHeight);
  context.fillStyle = palette.header;
  context.fillRect(0, 0, logicalWidth, headerHeight);
  canvasText(context, "Pendientes de programación", 32, 48, 850, { font: "30px Arial", color: palette.headerText, bold: true });
  canvasText(context, appDocument.calendarMeta.coordinator || "Sin coordinador registrado", 32, 82, 850, { font: "18px Arial", color: palette.headerText });
  canvasText(context, `${pending.length} tarjeta${pending.length === 1 ? "" : "s"}`, 1050, 52, 230, { font: "24px Arial", color: palette.headerText, bold: true });
  canvasText(context, `Generado ${timestampLabel(new Date().toISOString())}`, 32, 132, 1220, { font: "15px Arial", color: palette.headerText });
  if (!pending.length) {
    canvasText(context, "No hay pendientes visibles con los filtros actuales.", 36, headerHeight + 48, logicalWidth - 72, { font: "20px Arial", color: palette.text });
  }
  pending.forEach((activity, index) => {
    const y = headerHeight + index * rowHeight;
    const client = maps.clients.get(activity.clientId);
    const site = maps.sites.get(activity.siteId);
    const assigned = activity.responsibleIds
      .map((id) => maps.responsibles.get(id))
      .filter(Boolean)
      .map((item) => item.initials || displayInitialsFor(item.name))
      .join(" · ");
    const serviceCode = SERVICE_CODES[activity.serviceType] ?? "SV";
    context.fillStyle = palette.row;
    context.fillRect(0, y, logicalWidth, rowHeight);
    context.strokeStyle = palette.grid;
    context.strokeRect(0, y, logicalWidth, rowHeight);
    context.fillStyle = darkExport ? "#f0a16d" : "#b85f2d";
    context.fillRect(0, y, 8, rowHeight);
    canvasText(context, `${serviceCode} · ${client?.name || SERVICE_TYPES[activity.serviceType] || "Actividad"}`, 28, y + 25, 760, { font: "17px Arial", color: palette.text, bold: true });
    canvasText(context, [site?.name || activity.city || "Sin sede", assigned || "Sin responsable"].filter(Boolean).join(" · "), 28, y + 48, 760, { font: "14px Arial", color: palette.secondary });
    canvasText(context, `${STATUS_ICONS[activity.status] ?? "•"} ${ACTIVITY_STATUSES[activity.status]}${activity.observations ? ` · ${activity.observations}` : ""}`, 28, y + 70, logicalWidth - 56, { font: "12px Arial", color: palette.secondary });
  });
  const legendY = headerHeight + Math.max(1, pending.length) * rowHeight;
  context.fillStyle = darkExport ? "#1b281e" : "#e8eee5";
  context.fillRect(0, legendY, logicalWidth, legendHeight);
  canvasText(context, "Convención: las tarjetas están sin fecha; el CSV conserva el detalle estructurado para edición o revisión.", 28, legendY + 29, logicalWidth - 56, { font: "14px Arial", color: palette.text });
  canvasText(context, "Servicios: MP · MC · EM · DG · GA · AD   |   Estados: ○ Programada · ● Confirmada · ✓ Terminada · × Cancelada", 28, legendY + 54, logicalWidth - 56, { font: "13px Arial", color: palette.secondary });
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error("El navegador no generó la imagen.")), "image/png")
  );
  const identity = normalizeKey(appDocument.calendarMeta.name) || "cronograma";
  downloadBlob(blob, "image/png", `pendientes_${identity}.png`);
  appendAudit("quarantine_png_exported", `${pending.length} pendiente(s) exportado(s)`);
  scheduleSave();
  showToast("Imagen de pendientes descargada.");
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
    return Math.max(160, 68 + maxCards * 66);
  });
  const logicalWidth = 1680;
  const headerHeight = 180;
  const weekdayHeight = 48;
  const legendHeight = 132;
  const logicalHeight = headerHeight + weekdayHeight + weekHeights.reduce((sum, value) => sum + value, 0) + legendHeight;
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
        const assigned = activity.responsibleIds
          .map((id) => maps.responsibles.get(id))
          .filter(Boolean)
          .map((item) => item.initials || displayInitialsFor(item.name))
          .join(" · ");
        const serviceCode = SERVICE_CODES[activity.serviceType] ?? "SV";
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
        context.fillRect(x + 8, cardY, columnWidth - 16, 56);
        context.fillStyle = colors[1];
        context.fillRect(x + 8, cardY, 5, 56);
        canvasText(context, `${serviceCode} · ${client?.name || SERVICE_TYPES[activity.serviceType]}`, x + 20, cardY + 17, columnWidth - 36, { font: "13px Arial", color: palette.text, bold: true });
        canvasText(context, [site?.name || activity.city || "Sin sede", assigned || "Sin responsable"].filter(Boolean).join(" · "), x + 20, cardY + 35, columnWidth - 36, { font: "11px Arial", color: palette.secondary });
        canvasText(context, `${STATUS_ICONS[activity.status] ?? "•"} ${ACTIVITY_STATUSES[activity.status]}`, x + 20, cardY + 51, columnWidth - 36, { font: "10px Arial", color: palette.secondary });
        context.globalAlpha = 1;
        cardY += 66;
      }
    }
    y += height;
  }
  context.fillStyle = darkExport ? "#1b281e" : "#e8eee5";
  context.fillRect(0, y, logicalWidth, legendHeight);
  context.strokeStyle = palette.grid;
  context.strokeRect(0, y, logicalWidth, legendHeight);
  canvasText(context, "Convenciones", 24, y + 28, 220, { font: "18px Arial", color: palette.text, bold: true });
  canvasText(context, "Servicios: MP Preventivo · MC Correctivo · EM Emergencia · DG Diagnóstico · GA Garantía · AD Administrativo", 24, y + 55, logicalWidth - 48, { font: "13px Arial", color: palette.text });
  canvasText(context, "Estados: ○ Programada · ● Confirmada · ▶ En ejecución · ✓ Terminada · ! No ejecutada · × Cancelada", 24, y + 80, logicalWidth - 48, { font: "13px Arial", color: palette.text });
  canvasText(context, "Tarjetas: color/etiqueta identifica nómina, contratista, mixto o sin responsable · fondo cálido: domingo/festivo · ↪: reprogramada", 24, y + 105, logicalWidth - 48, { font: "13px Arial", color: palette.text });
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

function downloadBaseTemplate() {
  const workbook = XLSX.utils.book_new();
  const sheets = {
    dm_ciudad: [["id", "Zona", "Ciudad"]],
    dm_clientes: [["id", "Nombre"]],
    dm_sede: [["id", "Cliente", "Zona", "Ciudad", "Centro comercial", "Nombre", "Dirección", "Ingresos", "Requiere App"]],
    dm_directorio_siys: [["Nombre", "Empresa", "Tipo", "Ciudad base", "Grupo", "Cobertura", "Alturas", "Cursos"]],
    dm_equipo_cronograma: [[
      "_id", "subsidiary._id", "subsidiary.name", "responsable ejecucion", "Frecuencia",
      "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
    ]]
  };
  const instructions = [
    ["Plantilla de Base Operativa HVAC SI&S"],
    ["Diligencia las hojas con datos operativos; no agregues cédulas, teléfonos, correos ni fotografías."],
    ["Las hojas obligatorias son dm_ciudad, dm_clientes, dm_sede y dm_directorio_siys."],
    ["dm_equipo_cronograma es opcional y contiene sólo pistas agregadas de equipos y frecuencias."],
    ["Conserva los nombres exactos de las hojas y de las columnas; no cambies los encabezados."],
    ["Usa identificadores estables y evita duplicar el mismo id o la misma combinación de identidad."],
    ["dm_sede.Cliente debe coincidir exactamente con dm_clientes.Nombre; Ciudad debe coincidir con dm_ciudad.Ciudad."],
    ["dm_sede requiere id, Cliente, Zona, Ciudad, Centro comercial y Nombre. Dirección e Ingresos son opcionales."],
    ["Requiere App acepta: Necesita App, No necesita App o vacío si está pendiente de confirmar."],
    ["dm_directorio_siys requiere Nombre, Empresa, Tipo, Ciudad base y Grupo. Tipo sólo puede ser Nómina o Contratista."],
    ["Cobertura es opcional: escribe ciudades separadas por coma; se usa para ordenar responsables por zona del grupo."],
    ["Alturas y Cursos son opcionales; registra únicamente requisitos operativos, sin documentos personales."],
    ["La aplicación muestra una vista previa y no elimina registros ausentes de una actualización."],
    ["Esta plantilla está vacía: no reemplaza una copia vigente de la Base Operativa ni contiene datos actuales."]
  ];
  for (const [name, rows] of Object.entries(sheets)) {
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet["!cols"] = rows[0].map((header) => ({ wch: Math.max(14, Math.min(32, String(header).length + 4)) }));
    XLSX.utils.book_append_sheet(workbook, sheet, name);
  }
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(instructions), "Instrucciones");
  const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  downloadBlob(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "plantilla_base_operativa_HVAC_SIYS.xlsx");
  showToast("Plantilla de Base Operativa descargada.");
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

function bindCloudEvents() {
  dom.cloudAuthForm?.addEventListener("submit", handleCloudAuthSubmit);
  dom.cloudCalendarSelect?.addEventListener("change", (event) => {
    handleCloudCalendarChange(event).catch((error) => showToast(error.message, { type: "error" }));
  });
  dom.refreshCloudCalendarsButton?.addEventListener("click", () => {
    refreshCloudCalendars({ notify: true }).catch((error) => showToast(error.message, { type: "error" }));
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshCloudCalendars().catch(() => {});
  });
  window.addEventListener("focus", () => refreshCloudCalendars().catch(() => {}));
  dom.cloudAuthModeButton?.addEventListener("click", () => {
    setCloudAuthMode(cloudAuthMode === "sign-up" ? "sign-in" : "sign-up");
    showFormErrors(dom.cloudAuthErrors, []);
  });
  dom.cloudSignOutButton?.addEventListener("click", () => {
    handleCloudSignOut().catch((error) => showToast(`No se pudo cerrar sesión: ${error.message}`, { type: "error" }));
  });
}

function bindPrimaryActionEvents() {
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
  dom.exportQuarantineImageButton.addEventListener("click", () => {
    exportQuarantineImage().catch((error) => showToast(error.message, { type: "error" }));
  });
  dom.exportImageButton.addEventListener("click", () => {
    exportCurrentMonthImage().catch((error) => showToast(error.message, { type: "error" }));
  });
  dom.baseTemplateButton.addEventListener("click", downloadBaseTemplate);
  dom.programmingTemplateButton.addEventListener("click", downloadProgrammingTemplate);
  dom.normalizeTextButton.addEventListener("click", openNormalizeTextDialog);
  dom.importProgrammingButton.addEventListener("click", () => dom.programmingFileInput.click());
  dom.holidayButton.addEventListener("click", () => {
    renderHolidayDialog();
    openDialog("holidayDialog");
  });
  dom.helpButton.addEventListener("click", () => openDialog("helpDialog"));
  dom.calendarSettingsButton.addEventListener("click", openCalendarSettingsDialog);
  dom.themeButton.addEventListener("click", cycleThemePreference);
  dom.motionButton.addEventListener("click", toggleMotionPreference);
  dom.themeForm.addEventListener("submit", handleThemeSubmit);
  dom.normalizeTextForm.addEventListener("submit", handleNormalizeTextSubmit);
  for (const input of [dom.normalizeActivities, dom.normalizeCatalog, dom.normalizeMeta]) {
    input.addEventListener("change", updateNormalizationPreview);
  }
  dom.resetDataButton.addEventListener("click", openResetDataDialog);
  dom.resetDataForm.addEventListener("submit", handleResetDataSubmit);
  dom.dropMoveButton.addEventListener("click", () => applyPendingDrop("move"));
  dom.dropDuplicateButton.addEventListener("click", () => applyPendingDrop("duplicate"));
  dom.dropExtendButton.addEventListener("click", () => applyPendingDrop("extend"));
  dom.dropExtendRangeButton.addEventListener("click", () => applyPendingDrop("extend-range"));
  dom.activityDateActionForm.addEventListener("submit", (event) => event.preventDefault());
  dom.activityDateActionDate.addEventListener("change", updateActivityDateActionWarning);
  dom.touchMoveButton.addEventListener("click", () => applyTouchDateAction("move"));
  dom.touchDuplicateButton.addEventListener("click", () => applyTouchDateAction("duplicate"));
  dom.touchExtendButton.addEventListener("click", () => applyTouchDateAction("extend"));
  dom.touchExtendRangeButton.addEventListener("click", () => applyTouchDateAction("extend-range"));
  dom.seriesRangeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    applySeriesRangeAction("extend");
  });
  dom.seriesRangeDuplicateButton.addEventListener("click", () => applySeriesRangeAction("duplicate"));
  dom.seriesRangeFrom.addEventListener("change", () => {
    seriesRangeForcedDates.clear();
    updateSeriesRangePreview();
  });
  dom.seriesRangeTo.addEventListener("change", () => {
    seriesRangeForcedDates.clear();
    updateSeriesRangePreview();
  });
  dom.seriesRangeIncludeNonWorking.addEventListener("change", () => {
    seriesRangeForcedDates.clear();
    updateSeriesRangePreview();
  });
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
}

function bindCalendarAndCatalogEvents() {
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
}

function bindActivityFormEvents() {
  dom.activityClient.addEventListener("change", () => {
    populateSiteSelect(dom.activityClient.value);
    dom.activityClientText.value = appDocument.catalog.clients.find((item) => item.id === dom.activityClient.value)?.name ?? "";
    dom.activityCity.value = "";
    renderResponsiblePicker();
  });
  dom.activitySite.addEventListener("change", syncActivityLocationFromSite);
  dom.activityClientText.addEventListener("input", resolveActivityClientText);
  dom.activityClientText.addEventListener("change", resolveActivityClientText);
  dom.activitySiteText.addEventListener("input", resolveActivitySiteText);
  dom.activitySiteText.addEventListener("change", resolveActivitySiteText);
  dom.responsibleSearch.addEventListener("input", scheduleResponsiblePickerRender);
  dom.activityResponsibleText.addEventListener("input", scheduleResponsiblePickerRender);
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
}

function bindDataManagementEvents() {
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
}

function bindGlobalInteractionEvents() {
  for (const button of document.querySelectorAll("[data-close-dialog]")) {
    button.addEventListener("click", () => closeDialog(button.dataset.closeDialog));
  }
  for (const button of document.querySelectorAll(".action-menu .menu-action")) {
    button.addEventListener("click", () => {
      if (button.id === "themeButton") return;
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
  window.matchMedia?.("(prefers-reduced-motion: reduce)")?.addEventListener("change", applyMotionPreference);
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
    if (cloudCalendarRefreshTimer) clearInterval(cloudCalendarRefreshTimer);
    releaseEditLock().catch(() => {});
    editChannel?.close();
  });
}

function bindEvents() {
  bindCloudEvents();
  bindPrimaryActionEvents();
  bindCalendarAndCatalogEvents();
  bindActivityFormEvents();
  bindDataManagementEvents();
  bindGlobalInteractionEvents();
}

async function loadInitialDocument() {
  if (CLOUD_MODE) {
    try {
      cloudPersistence = createSupabasePersistence(SUPABASE_CONFIG, {
        calendarKey: CLOUD_CALENDAR_KEY
      });
      const restored = await cloudPersistence.restoreSession();
      if (!restored) await waitForCloudAuthentication();
      const legacyLocalDocument = await readLegacyStableDocument();
      const initial = legacyLocalDocument
        ? { ...legacyLocalDocument, appVersion: APP_VERSION }
        : createDefaultDocument();
      const current = await cloudPersistence.initialize({ initialDocument: initial });
      let document = current?.document ? sanitizeDocument(current.document) : initial;
      const shouldMigrate = legacyLocalDocument && !current?.initializedFromInitial &&
        shouldMigrateLocalDocument(legacyLocalDocument, document);
      if (shouldMigrate) {
        const migratedDocument = { ...legacyLocalDocument, appVersion: APP_VERSION };
        await cloudPersistence.write(migratedDocument);
        document = sanitizeDocument(migratedDocument);
        cloudMigrationNotice = "Se trasladaron los datos locales de la stable anterior a Supabase. La copia local se conservó.";
      } else if (legacyLocalDocument && current?.initializedFromInitial) {
        document = sanitizeDocument(initial);
        cloudMigrationNotice = "Se trasladaron los datos locales de la stable anterior a Supabase. La copia local se conservó.";
      } else if (legacyLocalDocument) {
        cloudMigrationNotice = "Se conservó el cronograma cloud existente; no se sobrescribieron los datos locales de la stable anterior.";
      }
      markStableLocalMigrationCompleted();
      storageAvailable = true;
      return document;
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
    database = await localDocumentStore.open();
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
  applyMotionPreference();
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
  startCloudCalendarRefresh();
  if (storageAvailable) setSaveIndicator("saved", CLOUD_MODE ? "Guardado en Supabase" : "Guardado");
  if (cloudMigrationNotice) {
    showToast(cloudMigrationNotice, { duration: 10000 });
    cloudMigrationNotice = "";
  }
  document.body.dataset.ready = "true";
  window.dispatchEvent(new CustomEvent("calendario-hvac-ready"));
}

initialize().catch((error) => {
  setSaveIndicator("error", "Error al iniciar");
  showToast(`La aplicación no pudo iniciar: ${error.message}`, { type: "error", duration: 15000 });
  console.error(error);
});
