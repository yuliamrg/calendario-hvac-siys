import { CloudCliError } from "./cloud-errors.js";
import { createSupabaseAuthClient, supabaseConfigFromEnv } from "./cloud-auth.js";
import { documentHash, documentRevision } from "./source-metadata.js";

export const CLOUD_CHANNEL_KEYS = Object.freeze({
  stable: "calendario-hvac-siys",
  beta: "calendario-hvac-siys-beta"
});

export function legacyIdForChannel(channel) {
  if (!Object.hasOwn(CLOUD_CHANNEL_KEYS, channel)) {
    throw new CloudCliError("CHANNEL_INVALID", "El canal cloud debe ser stable o beta.");
  }
  return CLOUD_CHANNEL_KEYS[channel];
}

export function assertCloudReadMethod(method = "GET") {
  if (String(method).toUpperCase() !== "GET") {
    throw new CloudCliError("CLOUD_WRITE_NOT_ALLOWED", "La fuente cloud de la CLI solo permite peticiones GET.");
  }
}

function compactMessage(value, fallback) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object") {
    for (const key of ["message", "msg", "hint", "details", "error"]) {
      if (typeof value[key] === "string" && value[key].trim()) return value[key].trim();
    }
  }
  return fallback;
}

function defaultFetch() {
  if (typeof globalThis.fetch !== "function") {
    throw new CloudCliError("NETWORK_UNAVAILABLE", "Node no dispone de fetch para consultar Supabase.");
  }
  return globalThis.fetch.bind(globalThis);
}

async function parseResponse(response, operation) {
  const text = await response.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); }
    catch (error) {
      throw new CloudCliError("REMOTE_INVALID", `Supabase devolvió JSON inválido durante ${operation}.`, { status: response.status, cause: error });
    }
  }
  if (!response.ok) {
    const code = response.status === 401 ? "AUTH_REQUIRED" : response.status === 403 ? "RLS_DENIED" : response.status >= 500 ? "REMOTE_UNAVAILABLE" : "REMOTE_ERROR";
    throw new CloudCliError(code, compactMessage(payload, `Supabase respondió ${response.status} durante ${operation}.`), {
      status: response.status,
      details: { operation, status: response.status }
    });
  }
  return payload;
}

function validateRows(payload, operation) {
  if (!Array.isArray(payload)) throw new CloudCliError("REMOTE_INVALID", `Supabase no devolvió una lista durante ${operation}.`);
  return payload;
}

function safeCalendarId(value) {
  const id = String(value ?? "").trim();
  if (!id || id.length > 128 || !/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new CloudCliError("INVALID_REQUEST", "--calendar-id debe ser un identificador seguro (normalmente UUID).");
  }
  return id;
}

export function createSupabaseReadClient(config, {
  auth,
  fetchImpl = defaultFetch(),
  timeoutMs = 15_000
} = {}) {
  const normalized = config ?? supabaseConfigFromEnv();
  const authClient = auth ?? createSupabaseAuthClient(normalized, { fetchImpl, timeoutMs });

  async function get(path, { operation = "consulta cloud", retry = true } = {}) {
    assertCloudReadMethod("GET");
    const token = await authClient.accessToken();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      try {
        response = await fetchImpl(`${normalized.url}${path}`, {
          method: "GET",
          headers: {
            apikey: normalized.publishableKey,
            Authorization: `Bearer ${token}`,
            Accept: "application/json"
          },
          signal: controller.signal
        });
      } catch (error) {
        const code = error?.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR";
        throw new CloudCliError(code, `No fue posible conectar con Supabase durante ${operation}.`, { cause: error });
      }
      if (response.status === 401 && retry) {
        await authClient.refreshSession();
        return get(path, { operation, retry: false });
      }
      return await parseResponse(response, operation);
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze({ get });
}

export class CloudCalendarSource {
  constructor(config = null, {
    auth,
    client,
    fetchImpl = defaultFetch(),
    now = () => new Date().toISOString(),
    timeoutMs = 15_000
  } = {}) {
    const normalized = config ?? supabaseConfigFromEnv();
    this.auth = auth ?? createSupabaseAuthClient(normalized, { fetchImpl, timeoutMs });
    this.client = client ?? createSupabaseReadClient(normalized, { auth: this.auth, fetchImpl, timeoutMs });
    this.now = now;
  }

  async listCalendars({ channel, mine = false } = {}) {
    const legacyId = legacyIdForChannel(channel);
    const path = `/rest/v1/calendars?legacy_id=eq.${encodeURIComponent(legacyId)}&select=id,legacy_id,name,coordinator,created_by,created_at,updated_at&order=created_at.asc`;
    const rows = validateRows(await this.client.get(path, { operation: "listar calendarios" }), "listar calendarios");
    if (rows.some((row) => row.legacy_id !== legacyId)) {
      throw new CloudCliError("CHANNEL_MISMATCH", "Supabase devolvió un calendario de otro canal.");
    }
    const ownerIds = [...new Set(rows.map((row) => row.created_by).filter(Boolean))];
    let ownerNames = new Map();
    let ownerLabelsUnavailable = false;
    if (ownerIds.length) {
      const ids = ownerIds.map((id) => encodeURIComponent(id)).join(",");
      try {
        const profiles = validateRows(await this.client.get(`/rest/v1/profiles?id=in.(${ids})&select=id,display_name`, { operation: "listar propietarios" }), "listar propietarios");
        ownerNames = new Map(profiles.map((profile) => [profile.id, String(profile.display_name ?? "").trim()]));
      } catch (error) {
        if (["AUTH_REQUIRED", "RLS_DENIED", "REMOTE_UNAVAILABLE", "NETWORK_ERROR", "TIMEOUT"].includes(error.code)) ownerLabelsUnavailable = true;
        else throw error;
      }
    }
    const calendars = rows.map((row) => ({
      calendarId: row.id,
      legacyId: row.legacy_id,
      name: row.name,
      coordinator: row.coordinator ?? "",
      createdBy: row.created_by,
      ownerName: ownerNames.get(row.created_by) ?? "",
      createdAt: row.created_at ?? null,
      updatedAt: row.updated_at ?? null,
      channel
    }));
    if (mine) {
      const user = await this.auth.whoami();
      return calendars.filter((calendar) => calendar.createdBy === user.id);
    }
    if (ownerLabelsUnavailable) return calendars.map((calendar) => ({ ...calendar, ownerName: calendar.ownerName || null }));
    return calendars;
  }

  async resolveCalendar({ channel, calendarId, mine = false } = {}) {
    const calendars = await this.listCalendars({ channel });
    const user = mine ? await this.auth.whoami() : null;
    if (calendarId !== undefined && calendarId !== null) {
      const selectedId = safeCalendarId(calendarId);
      const selected = calendars.find((calendar) => calendar.calendarId === selectedId);
      if (!selected) throw new CloudCliError("CALENDAR_NOT_FOUND", "El calendar-id no existe en el canal solicitado.");
      if (user && selected.createdBy !== user.id) throw new CloudCliError("CALENDAR_NOT_FOUND", "El calendar-id no pertenece al usuario autenticado.");
      return selected;
    }
    const candidates = user ? calendars.filter((calendar) => calendar.createdBy === user.id) : calendars;
    if (candidates.length === 0) throw new CloudCliError("CALENDAR_NOT_FOUND", "No hay un calendario accesible en el canal solicitado.");
    if (candidates.length > 1) throw new CloudCliError("CALENDAR_AMBIGUOUS", "Hay varios calendarios candidatos; especifica --calendar-id o --mine.");
    return candidates[0];
  }

  async load({ channel, calendarId, mine = false } = {}) {
    const selected = await this.resolveCalendar({ channel, calendarId, mine });
    const path = `/rest/v1/calendar_documents?calendar_id=eq.${encodeURIComponent(selected.calendarId)}&select=document,revision,schema_version,updated_at,updated_by&limit=1`;
    const rows = validateRows(await this.client.get(path, { operation: "leer documento cloud" }), "leer documento cloud");
    if (!rows.length) throw new CloudCliError("CALENDAR_DOCUMENT_NOT_FOUND", "El calendario no tiene un documento actual disponible.");
    if (rows.length > 1) throw new CloudCliError("REMOTE_INVALID", "Supabase devolvió más de un documento para un calendario único.");
    const record = rows[0];
    if (!record.document || typeof record.document !== "object" || Array.isArray(record.document)) {
      throw new CloudCliError("REMOTE_INVALID", "El documento cloud no tiene un objeto JSON válido.");
    }
    const cloudRevision = record.revision === undefined || record.revision === null || record.revision === ""
      ? null
      : (Number.isInteger(Number(record.revision)) ? Number(record.revision) : null);
    const revision = documentRevision(record.document);
    const warnings = cloudRevision !== null && revision !== null && cloudRevision !== revision
      ? ["REVISION_MISMATCH"]
      : [];
    return {
      document: record.document,
      source: {
        kind: "cloud",
        channel,
        calendarId: selected.calendarId,
        legacyId: selected.legacyId,
        calendarName: selected.name,
        createdBy: selected.createdBy,
        ownerName: selected.ownerName ?? null,
        cloudRevision,
        documentRevision: revision,
        documentUpdatedAt: record.updated_at ?? null,
        observedAt: this.now(),
        documentHash: documentHash(record.document),
        warnings
      },
      calendar: selected
    };
  }
}
