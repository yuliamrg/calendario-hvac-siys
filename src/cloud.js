const SESSION_KEY_PREFIX = "siys-sync-supabase-session";
const STABLE_CALENDAR_KEY = "calendario-hvac-siys";
const BETA_CALENDAR_KEY = "calendario-hvac-siys-beta";

function compactMessage(value, fallback = "Ocurrió un error en Supabase.") {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object") {
    for (const key of ["msg", "message", "error_description", "error"]) {
      if (typeof value[key] === "string" && value[key].trim()) return value[key].trim();
    }
  }
  return fallback;
}

function normalizeConfig(config = {}) {
  return {
    enabled: config.enabled === true,
    url: String(config.url ?? "").replace(/\/+$/, ""),
    publishableKey: String(config.publishableKey ?? "")
  };
}

export function isSupabaseConfigEnabled(config) {
  const normalized = normalizeConfig(config);
  return normalized.enabled && Boolean(normalized.url && normalized.publishableKey);
}

export function shouldUseSupabaseCloud(runtimeChannel, config) {
  return ["stable", "beta"].includes(runtimeChannel) && isSupabaseConfigEnabled(config);
}

export function supabaseCalendarKeyForChannel(runtimeChannel) {
  return runtimeChannel === "beta"
    ? "calendario-hvac-siys-beta"
    : "calendario-hvac-siys";
}

export class SupabaseCloudError extends Error {
  constructor(message, { status = 0, code = "", details = null } = {}) {
    super(message);
    this.name = "SupabaseCloudError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class SupabaseCloudConflictError extends SupabaseCloudError {
  constructor(message = "El cronograma cambió en otro dispositivo.") {
    super(message, { status: 409, code: "cloud_conflict" });
    this.name = "SupabaseCloudConflictError";
  }
}

export class SupabaseCloudAuthRequiredError extends SupabaseCloudError {
  constructor(message = "Se necesita una sesión de Supabase.") {
    super(message, { status: 401, code: "auth_required" });
    this.name = "SupabaseCloudAuthRequiredError";
  }
}

function sessionFromAuthPayload(payload) {
  const candidate = payload?.session ?? payload;
  if (!candidate?.access_token) return null;
  const expiresIn = Number(candidate.expires_in) || 3600;
  return {
    access_token: candidate.access_token,
    refresh_token: candidate.refresh_token ?? "",
    token_type: candidate.token_type ?? "bearer",
    expires_in: expiresIn,
    expires_at: Number(candidate.expires_at) || Math.floor(Date.now() / 1000) + expiresIn,
    user: candidate.user ?? payload?.user ?? null
  };
}

function responsePayload(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function createSupabasePersistence(config, {
  calendarKey = "calendario-hvac-siys",
  fetchImpl = globalThis.fetch?.bind(globalThis),
  storage = globalThis.localStorage
} = {}) {
  const normalized = normalizeConfig(config);
  if (!isSupabaseConfigEnabled(normalized)) {
    throw new SupabaseCloudError("La configuración de Supabase está incompleta.", {
      code: "invalid_config"
    });
  }
  if (typeof fetchImpl !== "function") {
    throw new SupabaseCloudError("Este navegador no permite conexiones a Supabase.", {
      code: "fetch_unavailable"
    });
  }

  const sessionKey = SESSION_KEY_PREFIX;
  const legacySessionKeys = [
    `${SESSION_KEY_PREFIX}:${calendarKey}`,
    `${SESSION_KEY_PREFIX}:${STABLE_CALENDAR_KEY}`,
    `${SESSION_KEY_PREFIX}:${BETA_CALENDAR_KEY}`
  ].filter((key, index, keys) => keys.indexOf(key) === index);
  let session = null;
  let user = null;
  let calendar = null;
  let calendarRole = null;
  let remoteRevision = null;

  function readSession() {
    try {
      for (const key of [sessionKey, ...legacySessionKeys]) {
        const parsed = JSON.parse(storage?.getItem(key) ?? "null");
        if (parsed && typeof parsed === "object") return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  function persistSession(nextSession) {
    session = nextSession;
    user = nextSession?.user ?? null;
    try {
      if (nextSession) storage?.setItem(sessionKey, JSON.stringify(nextSession));
      else storage?.removeItem(sessionKey);
    } catch {
      // The access token still works for this page even if storage is unavailable.
    }
    return session;
  }

  async function parseResponse(response) {
    const text = await response.text();
    const payload = responsePayload(text);
    if (response.ok) return payload;
    throw new SupabaseCloudError(compactMessage(payload, `Supabase respondió ${response.status}.`), {
      status: response.status,
      code: payload?.code ?? payload?.error_code ?? "",
      details: payload
    });
  }

  async function authRequest(path, { method = "POST", body, headers = {} } = {}) {
    let response;
    try {
      response = await fetchImpl(`${normalized.url}/auth/v1/${path}`, {
        method,
        headers: {
          apikey: normalized.publishableKey,
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          ...headers
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch (error) {
      throw new SupabaseCloudError(`No fue posible conectar con Supabase: ${error.message}`, {
        code: "network_error",
        details: error
      });
    }
    return parseResponse(response);
  }

  async function refreshSession() {
    const current = session ?? readSession();
    if (!current?.refresh_token) {
      persistSession(null);
      return null;
    }
    try {
      const payload = await authRequest("token?grant_type=refresh_token", {
        body: { refresh_token: current.refresh_token }
      });
      const nextSession = sessionFromAuthPayload(payload);
      if (!nextSession) throw new SupabaseCloudAuthRequiredError("Supabase no devolvió una sesión válida.");
      return persistSession(nextSession);
    } catch {
      persistSession(null);
      return null;
    }
  }

  async function restoreSession() {
    const stored = session ?? readSession();
    if (!stored?.access_token) {
      persistSession(null);
      return null;
    }
    const expiresAt = Number(stored.expires_at) || 0;
    if (expiresAt * 1000 <= Date.now() + 60_000) return refreshSession();
    session = stored;
    user = stored.user ?? null;
    return session;
  }

  async function restRequest(path, {
    method = "GET",
    body,
    headers = {},
    retry = true
  } = {}) {
    if (!session?.access_token) throw new SupabaseCloudAuthRequiredError();
    let response;
    try {
      response = await fetchImpl(`${normalized.url}${path}`, {
        method,
        headers: {
          apikey: normalized.publishableKey,
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
          ...headers
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch (error) {
      throw new SupabaseCloudError(`No fue posible conectar con Supabase: ${error.message}`, {
        code: "network_error",
        details: error
      });
    }
    if (response.status === 401 && retry && session.refresh_token) {
      const refreshed = await refreshSession();
      if (refreshed) return restRequest(path, { method, body, headers, retry: false });
    }
    return parseResponse(response);
  }

  async function loadUser() {
    if (!session?.access_token) throw new SupabaseCloudAuthRequiredError();
    try {
      const payload = await authRequest("user", { method: "GET" });
      return payload;
    } catch (error) {
      if (error.status !== 401 || !session.refresh_token) throw error;
      const refreshed = await refreshSession();
      if (!refreshed) throw new SupabaseCloudAuthRequiredError();
      return loadUser();
    }
  }

  async function signIn(email, password) {
    const payload = await authRequest("token?grant_type=password", {
      body: { email: email.trim(), password }
    });
    const nextSession = sessionFromAuthPayload(payload);
    if (!nextSession) throw new SupabaseCloudAuthRequiredError("No se recibió una sesión de Supabase.");
    persistSession(nextSession);
    return nextSession;
  }

  async function signUp(email, password, displayName = "") {
    const payload = await authRequest("signup", {
      body: {
        email: email.trim(),
        password,
        data: displayName.trim() ? { display_name: displayName.trim() } : undefined
      }
    });
    const nextSession = sessionFromAuthPayload(payload);
    if (nextSession) persistSession(nextSession);
    return { session: nextSession, requiresConfirmation: !nextSession };
  }

  async function signOut() {
    if (session?.access_token) {
      try {
        await authRequest("logout", { method: "POST" });
      } catch {
        // Removing the local session is still the correct fallback.
      }
    }
    calendar = null;
    remoteRevision = null;
    persistSession(null);
    try {
      legacySessionKeys.forEach((key) => storage?.removeItem(key));
    } catch {
      // The shared session has already been removed when storage is unavailable.
    }
  }

  async function listCalendar() {
    const query = `/rest/v1/calendars?legacy_id=eq.${encodeURIComponent(calendarKey)}&select=id,name,coordinator,created_by,updated_at&limit=1`;
    return await restRequest(query);
  }

  async function ensureCalendar({ name, coordinator }) {
    let rows = await listCalendar();
    if (!rows.length) {
      // The server derives created_by from auth.uid(). This avoids trusting a
      // client-supplied UUID and makes the first calendar creation compatible
      // with the calendars INSERT RLS policy.
      const created = await restRequest("/rest/v1/rpc/create_calendar_for_current_user", {
        method: "POST",
        body: {
          requested_legacy_id: calendarKey,
          requested_name: String(name || "Cronograma HVAC").trim() || "Cronograma HVAC",
          requested_coordinator: String(coordinator || "").trim()
        }
      });
      rows = Array.isArray(created) ? created : created ? [created] : [];
    }
    if (!rows.length) {
      throw new SupabaseCloudError(
        "La cuenta autenticada no tiene acceso a este cronograma. Usa la misma cuenta que lo creó o agrega una membresía desde Supabase.",
        { code: "calendar_not_accessible" }
      );
    }
    calendar = rows[0];
    const memberQuery = `/rest/v1/calendar_members?calendar_id=eq.${encodeURIComponent(calendar.id)}&user_id=eq.${encodeURIComponent(user.id)}&select=role&limit=1`;
    const memberships = await restRequest(memberQuery);
    calendarRole = memberships[0]?.role ?? null;
    if (!calendarRole) {
      throw new SupabaseCloudError("La cuenta autenticada no tiene una membresía válida en este cronograma.", {
        code: "membership_missing"
      });
    }
    return calendar;
  }

  async function read() {
    if (!calendar) throw new SupabaseCloudError("El cronograma cloud aún no está inicializado.");
    const query = `/rest/v1/calendar_documents?calendar_id=eq.${encodeURIComponent(calendar.id)}&select=document,revision,schema_version,updated_at,updated_by&limit=1`;
    const rows = await restRequest(query);
    const record = rows[0] ?? null;
    remoteRevision = record ? Number(record.revision) || 0 : null;
    return record
      ? { document: record.document, revision: remoteRevision, updatedAt: record.updated_at ?? null }
      : null;
  }

  async function write(documentSnapshot) {
    if (!calendar) throw new SupabaseCloudError("El cronograma cloud aún no está inicializado.");
    const nextRevision = remoteRevision === null ? 0 : remoteRevision + 1;
    const payload = {
      document: documentSnapshot,
      revision: nextRevision,
      schema_version: Number(documentSnapshot?.schemaVersion) || 4
    };
    let rows;
    if (remoteRevision === null) {
      rows = await restRequest("/rest/v1/calendar_documents?select=document,revision,updated_at,updated_by", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: [{ calendar_id: calendar.id, ...payload }]
      });
    } else {
      const query = `/rest/v1/calendar_documents?calendar_id=eq.${encodeURIComponent(calendar.id)}&revision=eq.${encodeURIComponent(String(remoteRevision))}&select=document,revision,updated_at,updated_by`;
      rows = await restRequest(query, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: payload
      });
      if (!rows.length) throw new SupabaseCloudConflictError();
    }
    const record = rows[0];
    remoteRevision = Number(record?.revision ?? nextRevision);
    await restRequest(`/rest/v1/calendars?id=eq.${encodeURIComponent(calendar.id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: {
        name: String(documentSnapshot?.calendarMeta?.name || calendar.name).trim() || calendar.name,
        coordinator: String(documentSnapshot?.calendarMeta?.coordinator || "").trim()
      }
    });
    return { revision: remoteRevision, updatedAt: record?.updated_at ?? null };
  }

  async function initialize({ initialDocument }) {
    if (!session) throw new SupabaseCloudAuthRequiredError();
    if (!user?.id) {
      user = session.user ?? await loadUser();
      session.user = user;
      persistSession(session);
    }
    await ensureCalendar({
      name: initialDocument?.calendarMeta?.name,
      coordinator: initialDocument?.calendarMeta?.coordinator
    });
    const current = await read();
    if (current) return current;
    await write(initialDocument);
    return { document: initialDocument, revision: remoteRevision };
  }

  return Object.freeze({
    calendarKey,
    restoreSession,
    signIn,
    signUp,
    signOut,
    initialize,
    read,
    write,
    getSession: () => session,
    getUser: () => user,
    getCalendar: () => calendar,
    getRole: () => calendarRole,
    canEdit: () => calendarRole === "owner" || calendarRole === "editor"
  });
}
