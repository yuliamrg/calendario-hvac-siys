import {
  ACTIVITY_STATUSES,
  APP_VERSION,
  HOLIDAY_RULESET_VERSION,
  RESPONSIBLE_TYPES,
  SERVICE_TYPES,
  STATUS_SCOPES,
  activityIdsForScope,
  addDaysISO,
  applyStatus,
  buildMonthlyCsv,
  colombianHolidays,
  compareISODate,
  createActivitiesFromRange,
  createDefaultDocument,
  dayOfWeek,
  generateSeriesDates,
  holidayMapForRange,
  holidayMapForYears,
  importDiff,
  isNonWorkingDate,
  makeId,
  monthGridDates,
  moveActivities,
  normalizeKey,
  normalizeText,
  parseISODate,
  safeText,
  sanitizeDocument,
  todayInBogota,
  toISODate,
  validateActivity,
  validateHolidayOverride
} from "./core.js";
import {
  applyParsedImport,
  buildImportPreview,
  parseBaseWorkbook
} from "./importer.js";

const DATABASE_NAME = "calendario-hvac-siys";
const DATABASE_VERSION = 1;
const DOCUMENT_STORE = "documents";
const MAX_VISIBLE_CARDS = 3;
const DAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const SERVICE_SHORT = {
  preventive: "Preventivo",
  corrective: "Correctivo",
  emergency: "Emergencia",
  administrative: "Administrativo"
};
const STATUS_ICONS = {
  scheduled: "○",
  confirmed: "●",
  in_progress: "▶",
  completed: "✓",
  not_executed: "!",
  cancelled: "×"
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
let dragContext = null;
let undoSnapshot = null;
let forcedRangeDates = new Set();
let storageAvailable = true;

function clone(value) {
  return structuredClone(value);
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
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(DOCUMENT_STORE, "readonly");
    const request = transaction.objectStore(DOCUMENT_STORE).get(key);
    request.onsuccess = () => resolve(request.result?.document ?? null);
    request.onerror = () => reject(request.error);
  });
}

function writeStoredDocument(documentSnapshot) {
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

function scheduleSave({ immediate = false } = {}) {
  if (!storageAvailable) return Promise.resolve();
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
          setSaveIndicator("saved", "Guardado");
          const waiters = saveWaiters;
          saveWaiters = [];
          waiters.forEach((waiter) => waiter());
        })
        .catch((error) => {
          storageAvailable = false;
          setSaveIndicator("error", "Sin guardado local");
          showToast(`No se pudo guardar en el navegador: ${error.message}`, { type: "error", duration: 9000 });
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
  const before = clone(appDocument);
  try {
    callback();
    appDocument.appVersion = APP_VERSION;
    appDocument.schemaVersion = 1;
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
  dom.detailDrawer.inert = true;
  activeDrawer = null;
  drawerReturnFocus = null;
  if (focusTarget && document.activeElement !== focusTarget) {
    window.requestAnimationFrame(() => focusTarget.focus({ preventScroll: true }));
  }
}

function openDrawer() {
  const wasOpen = dom.detailDrawer.classList.contains("open");
  if (!wasOpen) drawerReturnFocus = focusReferenceFor(document.activeElement);
  dom.detailDrawer.inert = false;
  dom.detailDrawer.classList.add("open");
  dom.detailDrawer.setAttribute("aria-hidden", "false");
  if (!wasOpen) {
    window.requestAnimationFrame(() => dom.closeDrawerButton.focus());
  }
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
    activity.observations,
    ...responsibles
  ].filter(Boolean).join(" "));
}

function activityMatchesFilters(activity, maps) {
  const filters = appDocument.settings.filters;
  if (filters.status !== "all" && activity.status !== filters.status) return false;
  if (filters.serviceType !== "all" && activity.serviceType !== filters.serviceType) return false;
  if (filters.responsible !== "all" && !activity.responsibleIds.includes(filters.responsible)) return false;
  const query = normalizeText(filters.query);
  return !query || activitySearchText(activity, maps).includes(query);
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
  const currentStatus = appDocument.settings.filters.status;
  const currentService = appDocument.settings.filters.serviceType;
  const currentResponsible = appDocument.settings.filters.responsible;
  setChildren(
    dom.statusFilter,
    option("all", "Todos los estados"),
    ...Object.entries(ACTIVITY_STATUSES).map(([value, label]) => option(value, label))
  );
  setChildren(
    dom.serviceFilter,
    option("all", "Todos los servicios"),
    ...Object.entries(SERVICE_TYPES).map(([value, label]) => option(value, label))
  );
  setChildren(
    dom.responsibleFilter,
    option("all", "Todos los responsables"),
    ...appDocument.catalog.responsibles
      .filter((item) => item.active !== false)
      .sort((a, b) => a.name.localeCompare(b.name, "es"))
      .map((item) => option(item.id, item.name))
  );
  dom.statusFilter.value = Object.hasOwn(ACTIVITY_STATUSES, currentStatus) ? currentStatus : "all";
  dom.serviceFilter.value = Object.hasOwn(SERVICE_TYPES, currentService) ? currentService : "all";
  dom.responsibleFilter.value = appDocument.catalog.responsibles.some((item) => item.id === currentResponsible)
    ? currentResponsible
    : "all";
  dom.globalSearch.value = appDocument.settings.filters.query ?? "";
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

function renderSelectionBar() {
  const count = selectedActivityIds.size;
  dom.selectionBar.hidden = count === 0;
  dom.selectionCount.textContent = String(count);
}

function renderAll() {
  renderFilters();
  renderCatalog();
  renderCalendar();
  renderSelectionBar();
  renderBackupReminder();
  if (activeDrawer?.type === "activity") renderActivityDrawer(activeDrawer.id);
  if (activeDrawer?.type === "day") renderDayDrawer(activeDrawer.date);
}

function renderCatalog() {
  dom.sitesTab.classList.toggle("active", catalogTab === "sites");
  dom.responsiblesTab.classList.toggle("active", catalogTab === "responsibles");
  dom.sitesTab.setAttribute("aria-selected", String(catalogTab === "sites"));
  dom.responsiblesTab.setAttribute("aria-selected", String(catalogTab === "responsibles"));
  dom.dragHint.textContent = catalogTab === "sites"
    ? "Arrastra un cliente o una sede hasta un día."
    : "Los colores distinguen nómina y contratistas.";

  const query = normalizeText(dom.catalogSearch.value);
  const fragment = document.createDocumentFragment();

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
      clientRow.draggable = true;
      clientRow.dataset.dragType = "client";
      clientRow.dataset.clientId = client.id;
      clientRow.title = "Arrastrar cliente al calendario";
      clientRow.append(createElement("span", "drag-grip", "⋮⋮"));
      clientRow.append(createElement("span", "", client.name));
      const editClient = createElement("button", "mini-edit", "✎");
      editClient.type = "button";
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
        row.draggable = true;
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

function buildActivityCard(activity, maps) {
  const card = createElement("article", `activity-card ${responsibleVisualClass(activity, maps)} ${activity.status.replaceAll("_", "-")}`);
  card.draggable = true;
  card.dataset.activityId = activity.id;
  card.setAttribute("aria-label", `${maps.clients.get(activity.clientId)?.name ?? "Actividad"} ${maps.sites.get(activity.siteId)?.name ?? ""}, ${ACTIVITY_STATUSES[activity.status]}`);
  if (selectedActivityIds.has(activity.id)) card.classList.add("selected");

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "activity-select";
  checkbox.checked = selectedActivityIds.has(activity.id);
  checkbox.title = "Seleccionar tarjeta";
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
    : client?.name ?? "Cliente sin catálogo";
  const assigned = activity.responsibleIds
    .map((id) => maps.responsibles.get(id))
    .filter(Boolean)
    .map((item) => item.initials || displayInitialsFor(item.name))
    .join(" · ");
  copyBlock.append(createElement("strong", "", title));
  copyBlock.append(createElement("small", "", [
    site?.name || activity.city,
    assigned || "Sin responsable"
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
  if (activity.status !== "completed" && activity.status !== "cancelled") {
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
  });
  return card;
}

function renderCalendar() {
  const { year, month } = currentMonthParts();
  dom.monthTitle.textContent = formatMonthTitle(year, month);
  const gridDates = monthGridDates(year, month);
  const years = [...new Set(gridDates.map((date) => Number(date.slice(0, 4))))];
  const holidays = holidayMapForYears(years, appDocument.holidayOverrides);
  const maps = lookupMaps();
  const activitiesByDate = new Map();
  for (const activity of appDocument.activities) {
    if (!activityMatchesFilters(activity, maps)) continue;
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

    const header = createElement("div", "day-header");
    const number = createElement("button", "day-number", String(day));
    number.type = "button";
    number.title = `Crear actividad el ${formatDisplayDate(date)}`;
    number.setAttribute("aria-label", `Crear actividad el ${formatDisplayDate(date)}`);
    number.tabIndex = date === preferredFocusDate ? 0 : -1;
    number.addEventListener("focus", () => {
      calendarFocusDate = date;
    });
    number.addEventListener("click", () => openActivityDialog({ date }));
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
    fragment.append(cell);
  }
  dom.calendarGrid.replaceChildren(fragment);
}

function handleCalendarDrop(event, date, holidayMap) {
  event.preventDefault();
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
    const label = payload.activityIds.length > 1
      ? `${payload.activityIds.length} tarjetas movidas`
      : "Actividad reprogramada";
    try {
      mutate("activities_moved", label, () => {
        moveActivities(appDocument, payload.activityIds, date, {
          anchorId: payload.anchorId,
          mode: "preserve"
        });
      });
      if (isNonWorkingDate(date, holidayMap)) {
        showToast("La fecha de destino es domingo o festivo. La programación se conservó por decisión manual.", {
          duration: 7500
        });
      }
    } catch (error) {
      showToast(error.message, { type: "error" });
    }
  }
}

function toggleActivitySelection(activityId, force) {
  const shouldSelect = force ?? !selectedActivityIds.has(activityId);
  if (shouldSelect) selectedActivityIds.add(activityId);
  else selectedActivityIds.delete(activityId);
  renderCalendar();
  renderSelectionBar();
}

function markActivityCompleted(activityId) {
  try {
    mutate("status_changed", "Actividad marcada como terminada", () => {
      applyStatus(appDocument, activityId, "completed", "single");
    });
  } catch (error) {
    showToast(error.message, { type: "error" });
  }
}

function detailItem(label, content) {
  const wrapper = createElement("div", "detail-item");
  wrapper.append(createElement("span", "", label));
  if (content instanceof Node) wrapper.append(content);
  else wrapper.append(createElement("p", "", content || "—"));
  return wrapper;
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

  const body = createElement("div", "detail-grid");
  const badgeRow = createElement("div", "responsible-chips");
  badgeRow.append(createElement("span", `status-badge ${activity.status}`, `${STATUS_ICONS[activity.status]} ${ACTIVITY_STATUSES[activity.status]}`));
  badgeRow.append(createElement("span", "service-badge", SERVICE_SHORT[activity.serviceType] ?? activity.serviceType));
  if (activity.history?.some((item) => item.action === "rescheduled")) {
    badgeRow.append(createElement("span", "chip", "↪ Reprogramada"));
  }
  body.append(badgeRow);
  body.append(detailItem("Fecha", formatDisplayDate(activity.date, { weekday: "long" })));
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
  body.append(detailItem("Observaciones", activity.observations));

  if (site?.entryConditions || site?.requiresApp != null || site?.address) {
    const operational = createElement("div");
    const lines = [
      site.address ? `Dirección: ${site.address}` : "",
      site.entryConditions ? `Ingreso: ${site.entryConditions}` : "",
      site.requiresApp === true ? "Requiere App SI&S" : site.requiresApp === false ? "No requiere App SI&S" : "Requisito de App sin confirmar"
    ].filter(Boolean);
    for (const line of lines) operational.append(createElement("p", "", line));
    body.append(detailItem("Datos operativos de sede", operational));
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
    body.append(detailItem("Referencia de equipos", `${hint}. Es una pista; no asigna personal automáticamente.`));
  }

  const actions = createElement("div", "detail-actions");
  const edit = createElement("button", "button small", "Editar tarjeta");
  edit.type = "button";
  edit.addEventListener("click", () => openActivityDialog({ activityId }));
  const duplicate = createElement("button", "button small", "Duplicar");
  duplicate.type = "button";
  duplicate.addEventListener("click", () => openActivityDialog({ duplicateId: activityId, date: activity.date }));
  const remove = createElement("button", "button small ghost", "Eliminar");
  remove.type = "button";
  remove.addEventListener("click", () => deleteActivity(activityId));
  actions.append(edit, duplicate, remove);
  body.append(actions);

  const statusEditor = createElement("div", "detail-item");
  statusEditor.append(createElement("span", "", "Actualizar estado"));
  const statusSelect = document.createElement("select");
  statusSelect.id = "drawerStatusSelect";
  statusSelect.setAttribute("aria-label", "Nuevo estado de la actividad");
  for (const [value, label] of Object.entries(ACTIVITY_STATUSES)) statusSelect.append(option(value, label));
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

  if (activity.seriesId) {
    const seriesItems = appDocument.activities
      .filter((item) => item.seriesId === activity.seriesId)
      .sort((a, b) => compareISODate(a.date, b.date));
    body.append(detailItem(
      "Actividad multidía",
      `${seriesItems.length} tarjetas independientes · ${formatDisplayDate(seriesItems[0].date)} a ${formatDisplayDate(seriesItems.at(-1).date)}`
    ));
  }

  if (activity.history?.length) {
    const list = createElement("ol", "history-list");
    for (const item of [...activity.history].reverse().slice(0, 20)) {
      list.append(createElement("li", "", `${timestampLabel(item.at)} · ${item.detail}`));
    }
    body.append(detailItem("Historial", list));
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
    .filter((activity) => activity.date === date)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const body = createElement("div", "detail-grid");
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
    mutate("status_changed", `Estado actualizado en ${count} tarjeta${count === 1 ? "" : "s"}`, () => {
      applyStatus(appDocument, activityId, status, scope);
    });
  } catch (error) {
    showToast(error.message, { type: "error" });
  }
}

function deleteActivity(activityId) {
  const activity = appDocument.activities.find((item) => item.id === activityId);
  if (!activity) return;
  if (!window.confirm("¿Eliminar esta tarjeta? Las demás fechas de la actividad multidía no se modificarán.")) return;
  mutate("activity_deleted", "Tarjeta eliminada", () => {
    appDocument.activities = appDocument.activities.filter((item) => item.id !== activityId);
    selectedActivityIds.delete(activityId);
  });
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
  const active = appDocument.catalog.responsibles
    .filter((item) => item.active !== false || checked.has(item.id))
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
    if (!items.length) group.append(createElement("p", "field-note", "Sin registros activos."));
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
  dom.responsiblePicker.replaceChildren(fragment);
}

function syncActivityLocationFromSite() {
  const site = appDocument.catalog.sites.find((item) => item.id === dom.activitySite.value);
  if (site) {
    dom.activityClient.value = site.clientId || dom.activityClient.value;
    dom.activityCity.value = site.city || dom.activityCity.value;
  }
  renderResponsiblePicker();
}

function setActivityFormMode(mode) {
  const editing = mode === "edit";
  dom.activityDialog.dataset.mode = mode;
  dom.activityDialogTitle.textContent = editing ? "Editar tarjeta" : "Nueva actividad";
  dom.activityDialogEyebrow.textContent = editing ? "Edición individual" : "Programación";
  dom.endDateLabel.hidden = editing;
  dom.includeNonWorkingLabel.hidden = editing;
  dom.rangePreview.hidden = editing;
  dom.saveActivityButton.textContent = editing ? "Guardar cambios" : "Guardar actividad";
}

function openActivityDialog({ date = todayInBogota(), clientId = "", siteId = "", activityId = "", duplicateId = "" } = {}) {
  dom.activityForm.reset();
  showFormErrors(dom.activityFormErrors, []);
  forcedRangeDates = new Set();
  const source = activityId
    ? appDocument.activities.find((item) => item.id === activityId)
    : duplicateId
      ? appDocument.activities.find((item) => item.id === duplicateId)
      : null;
  const mode = activityId ? "edit" : "create";
  setActivityFormMode(mode);
  dom.activityId.value = activityId;
  dom.activityDate.value = source?.date ?? date;
  dom.activityEndDate.value = "";
  dom.includeNonWorking.checked = false;
  dom.activityServiceType.value = source?.serviceType ?? "preventive";
  dom.activityStatus.value = source?.status ?? "scheduled";
  dom.activityCity.value = source?.city ?? "";
  dom.activityObservations.value = source?.observations ?? "";
  const resolvedClient = source?.clientId ?? clientId;
  const resolvedSite = source?.siteId ?? siteId;
  populateActivitySelects({
    clientId: resolvedClient,
    siteId: resolvedSite,
    responsibleIds: source?.responsibleIds ?? []
  });
  if (!source && resolvedSite) syncActivityLocationFromSite();
  updateAdministrativeFormState();
  updateRangePreview();
  openDialog("activityDialog");
}

function updateAdministrativeFormState() {
  const administrative = dom.activityServiceType.value === "administrative";
  dom.administrativeNote.hidden = !administrative;
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
    date: dom.activityDate.value,
    endDate: dom.activityEndDate.value || dom.activityDate.value,
    includeNonWorking: dom.includeNonWorking.checked,
    forceIncludeDates: [...forcedRangeDates],
    clientId: dom.activityClient.value || null,
    siteId: dom.activitySite.value || null,
    city: safeText(dom.activityCity.value, 120) || null,
    responsibleIds,
    serviceType: dom.activityServiceType.value,
    status: dom.activityStatus.value,
    observations: safeText(dom.activityObservations.value, 5000)
  };
}

function validateActivityInput(input) {
  const candidate = {
    ...input,
    date: input.date,
    responsibleIds: input.responsibleIds
  };
  const errors = validateActivity(candidate);
  if (input.endDate && input.date && compareISODate(input.endDate, input.date) < 0) {
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
      mutate("activity_edited", "Tarjeta actualizada", () => {
        const previousDate = existing.date;
        const previousStatus = existing.status;
        Object.assign(existing, {
          date: input.date,
          clientId: input.clientId,
          siteId: input.siteId,
          city: input.city,
          responsibleIds: input.responsibleIds,
          serviceType: input.serviceType,
          status: input.status,
          observations: input.observations,
          updatedAt: new Date().toISOString(),
          completedAt: input.status === "completed" ? (existing.completedAt || new Date().toISOString()) : null
        });
        existing.history ??= [];
        if (previousDate !== existing.date) {
          existing.history.push({
            at: existing.updatedAt,
            action: "rescheduled",
            detail: `${previousDate} → ${existing.date}`,
            mode: "single"
          });
        }
        if (previousStatus !== existing.status) {
          existing.history.push({
            at: existing.updatedAt,
            action: "status_changed",
            detail: `${ACTIVITY_STATUSES[previousStatus]} → ${ACTIVITY_STATUSES[existing.status]}`,
            scope: "single"
          });
        }
      });
      closeDialog("activityDialog");
      renderActivityDrawer(activityId);
    } catch (error) {
      showFormErrors(dom.activityFormErrors, [error.message]);
    }
    return;
  }

  try {
    const holidays = holidayMapForRange(input.date, input.endDate, appDocument.holidayOverrides);
    const result = createActivitiesFromRange(input, holidays);
    if (!result.activities.length) {
      showFormErrors(dom.activityFormErrors, ["El rango no contiene fechas programables. Incluye manualmente una fecha no laborable o cambia el rango."]);
      return;
    }
    mutate(
      "activity_created",
      `${result.activities.length} tarjeta${result.activities.length === 1 ? "" : "s"} creada${result.activities.length === 1 ? "" : "s"}`,
      () => {
        appDocument.activities.push(...result.activities);
        if (result.series) appDocument.series.push(result.series);
      }
    );
    closeDialog("activityDialog");
    renderActivityDrawer(result.activities[0].id);
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

  const id = itemId || makeId(type === "client" ? "cliente" : type === "site" ? "sede" : "responsable");
  const base = {
    id,
    sourceKey: itemId ? undefined : `manual:${id}`,
    active: dom.catalogActive.checked,
    source: itemId ? undefined : "manual"
  };
  let collection;
  let next;
  if (type === "client") {
    collection = appDocument.catalog.clients;
    next = { ...base, name: safeText(dom.catalogClientName.value, 160) };
  } else if (type === "site") {
    collection = appDocument.catalog.sites;
    next = {
      ...base,
      clientId: dom.catalogSiteClient.value,
      name: safeText(dom.catalogSiteName.value, 160),
      city: safeText(dom.catalogSiteCity.value, 120) || null,
      zone: safeText(dom.catalogSiteZone.value, 120) || null,
      shoppingCenter: safeText(dom.catalogSiteCenter.value, 160) || null,
      address: safeText(dom.catalogSiteAddress.value, 240) || null,
      entryConditions: safeText(dom.catalogSiteEntry.value, 1000) || null,
      requiresApp: dom.catalogSiteApp.checked
    };
  } else {
    collection = appDocument.catalog.responsibles;
    next = {
      ...base,
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
      favorite: dom.catalogResponsibleFavorite.checked
    };
  }

  mutate("catalog_saved", itemId ? "Registro del catálogo actualizado" : "Registro agregado al catálogo", () => {
    const existing = collection.find((item) => item.id === itemId);
    if (existing) {
      const sourceKey = existing.sourceKey;
      const source = existing.source;
      Object.assign(existing, next, { sourceKey, source });
    } else {
      collection.push(next);
    }
  });
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
      mutate("holiday_override_deleted", "Excepción eliminada", () => {
        appDocument.holidayOverrides = appDocument.holidayOverrides.filter((item) => item.id !== override.id);
      });
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
    id: makeId("festivo"),
    date: dom.overrideDate.value,
    type: dom.overrideType.value,
    name: safeText(dom.overrideName.value, 120),
    reason: safeText(dom.overrideReason.value, 500),
    active: true,
    createdAt: new Date().toISOString()
  };
  const errors = validateHolidayOverride(override);
  if (appDocument.holidayOverrides.some((item) => item.active !== false && item.date === override.date)) {
    errors.push("Ya existe una excepción activa para esta fecha.");
  }
  if (errors.length) {
    showFormErrors(dom.holidayFormErrors, errors);
    return;
  }
  mutate("holiday_override_added", "Excepción de calendario agregada", () => {
    appDocument.holidayOverrides.push(override);
  });
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
    mutate("activities_moved", `${activities.length} tarjetas movidas`, () => {
      moveActivities(appDocument, activities.map((item) => item.id), dom.bulkMoveDate.value, {
        anchorId: activities[0].id,
        mode
      });
      selectedActivityIds.clear();
    });
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
    ...Object.entries(ACTIVITY_STATUSES).map(([value, label]) => option(value, label))
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
  mutate("bulk_status_changed", `Estado actualizado en ${activities.length} tarjetas`, () => {
    const now = new Date().toISOString();
    for (const activity of activities) {
      const previous = activity.status;
      activity.status = status;
      activity.updatedAt = now;
      activity.completedAt = status === "completed" ? (activity.completedAt || now) : null;
      activity.history ??= [];
      activity.history.push({
        at: now,
        action: "status_changed",
        detail: `${ACTIVITY_STATUSES[previous]} → ${ACTIVITY_STATUSES[status]}`,
        scope: "selection"
      });
    }
    selectedActivityIds.clear();
  });
  closeDialog("bulkStatusDialog");
}

async function createBackup() {
  appDocument.settings.lastBackupAt = new Date().toISOString();
  appendAudit("backup_created", "Respaldo JSON descargado");
  renderBackupReminder();
  await scheduleSave({ immediate: true });
  const date = todayInBogota();
  downloadBlob(
    JSON.stringify(appDocument, null, 2),
    "application/json;charset=utf-8",
    `calendario-hvac-siys-respaldo-${date}.json`
  );
  showToast("Respaldo JSON descargado.");
}

function exportCurrentMonthCsv() {
  const { year, month } = currentMonthParts();
  const csv = buildMonthlyCsv(appDocument, year, month);
  const fileMonth = `${year}-${String(month).padStart(2, "0")}`;
  downloadBlob(csv, "text/csv;charset=utf-8", `programacion-hvac-${fileMonth}.csv`);
  appendAudit("csv_exported", `Mes exportado: ${fileMonth}`);
  scheduleSave();
  showToast(`CSV de ${formatMonthTitle(year, month)} descargado.`);
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
    const restored = sanitizeDocument(raw);
    pendingRestore = restored;
    const summary = createElement("div", "detail-grid");
    summary.append(detailItem("Archivo", file.name));
    summary.append(detailItem("Actividades", String(restored.activities.length)));
    summary.append(detailItem("Clientes y sedes", `${restored.catalog.clients.length} clientes · ${restored.catalog.sites.length} sedes`));
    summary.append(detailItem("Responsables", String(restored.catalog.responsibles.length)));
    dom.restoreSummary.replaceChildren(summary);
    openDialog("restoreDialog");
  } catch (error) {
    showToast(`No se pudo leer el respaldo: ${error.message}`, { type: "error", duration: 8000 });
  }
}

function handleRestoreSubmit(event) {
  event.preventDefault();
  if (!pendingRestore) return;
  const before = clone(appDocument);
  appDocument = pendingRestore;
  pendingRestore = null;
  appendAudit("backup_restored", "Respaldo JSON restaurado");
  undoSnapshot = { document: before, label: "restauración del respaldo" };
  selectedActivityIds.clear();
  closeDrawer();
  renderAll();
  scheduleSave({ immediate: true });
  closeDialog("restoreDialog");
  showToast("Respaldo restaurado correctamente.", { undo: true });
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
    setSaveIndicator(storageAvailable ? "saved" : "error", storageAvailable ? "Guardado" : "Sin guardado local");
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
    ...Object.entries(ACTIVITY_STATUSES).map(([value, label]) => option(value, label))
  );
  dom.versionLabel.textContent = `Versión ${APP_VERSION} · festivos ${HOLIDAY_RULESET_VERSION}`;
}

function bindEvents() {
  dom.newActivityButton.addEventListener("click", () => openActivityDialog({
    date: appDocument.settings.currentDate || todayInBogota()
  }));
  dom.importBaseButton.addEventListener("click", () => dom.baseFileInput.click());
  dom.emptyImportButton.addEventListener("click", () => dom.baseFileInput.click());
  dom.backupButton.addEventListener("click", createBackup);
  dom.backupBannerButton.addEventListener("click", createBackup);
  dom.restoreButton.addEventListener("click", () => dom.restoreFileInput.click());
  dom.exportCsvButton.addEventListener("click", exportCurrentMonthCsv);
  dom.holidayButton.addEventListener("click", () => {
    renderHolidayDialog();
    openDialog("holidayDialog");
  });
  dom.helpButton.addEventListener("click", () => openDialog("helpDialog"));
  dom.previousMonthButton.addEventListener("click", () => changeVisibleMonth(-1));
  dom.nextMonthButton.addEventListener("click", () => changeVisibleMonth(1));
  dom.todayButton.addEventListener("click", () => {
    appDocument.settings.currentDate = todayInBogota();
    renderCalendar();
    scheduleSave();
  });
  dom.globalSearch.addEventListener("input", () => updateFilter("query", dom.globalSearch.value));
  dom.statusFilter.addEventListener("change", () => updateFilter("status", dom.statusFilter.value));
  dom.serviceFilter.addEventListener("change", () => updateFilter("serviceType", dom.serviceFilter.value));
  dom.responsibleFilter.addEventListener("change", () => updateFilter("responsible", dom.responsibleFilter.value));
  dom.catalogSearch.addEventListener("input", renderCatalog);
  dom.sitesTab.addEventListener("click", () => {
    catalogTab = "sites";
    renderCatalog();
  });
  dom.responsiblesTab.addEventListener("click", () => {
    catalogTab = "responsibles";
    renderCatalog();
  });
  dom.newCatalogButton.addEventListener("click", () => openCatalogDialog(catalogTab === "responsibles" ? "responsible" : "client"));
  dom.closeDrawerButton.addEventListener("click", closeDrawer);
  dom.clearSelectionButton.addEventListener("click", () => {
    selectedActivityIds.clear();
    renderCalendar();
    renderSelectionBar();
  });
  dom.bulkMoveButton.addEventListener("click", openBulkMoveDialog);
  dom.bulkStatusButton.addEventListener("click", openBulkStatusDialog);
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
  dom.activityCity.addEventListener("input", () => renderResponsiblePicker());
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
  dom.restoreForm.addEventListener("submit", handleRestoreSubmit);
  dom.importForm.addEventListener("submit", handleImportSubmit);
  dom.baseFileInput.addEventListener("change", handleBaseFile);
  dom.restoreFileInput.addEventListener("change", handleRestoreFile);

  for (const button of document.querySelectorAll("[data-close-dialog]")) {
    button.addEventListener("click", () => closeDialog(button.dataset.closeDialog));
  }
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
    if (event.key === "Escape" && dom.detailDrawer.classList.contains("open")) closeDrawer();
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n" && !document.querySelector("dialog[open]")) {
      event.preventDefault();
      openActivityDialog({ date: appDocument.settings.currentDate });
    }
  });
  window.addEventListener("beforeunload", () => {
    if (saveTimer && storageAvailable) {
      clearTimeout(saveTimer);
      writeStoredDocument(clone(appDocument)).catch(() => {});
    }
  });
}

async function loadInitialDocument() {
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
  bindEvents();
  appDocument = await loadInitialDocument();
  try {
    parseISODate(appDocument.settings.currentDate);
  } catch {
    appDocument.settings.currentDate = todayInBogota();
  }
  renderAll();
  if (storageAvailable) setSaveIndicator("saved", "Guardado");
  document.body.dataset.ready = "true";
  window.dispatchEvent(new CustomEvent("calendario-hvac-ready"));
}

initialize().catch((error) => {
  setSaveIndicator("error", "Error al iniciar");
  showToast(`La aplicación no pudo iniciar: ${error.message}`, { type: "error", duration: 15000 });
  console.error(error);
});
