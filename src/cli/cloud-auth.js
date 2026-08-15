import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { CloudCliError } from "./cloud-errors.js";

const DEFAULT_TIMEOUT_MS = 15_000;
const SESSION_FILE_ENV = "CALENDARY_SESSION_FILE";

function compactMessage(value, fallback) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object") {
    for (const key of ["msg", "message", "error_description", "error"]) {
      if (typeof value[key] === "string" && value[key].trim()) return value[key].trim();
    }
  }
  return fallback;
}

function normalizeConfig(config = {}) {
  const url = String(config.url ?? "").trim().replace(/\/+$/, "");
  const publishableKey = String(config.publishableKey ?? "").trim();
  if (!url || !publishableKey) {
    throw new CloudCliError("CONFIG_INVALID", "Faltan SIYS_SUPABASE_URL o SIYS_SUPABASE_PUBLISHABLE_KEY.");
  }
  let parsed;
  try { parsed = new URL(url); }
  catch (error) {
    throw new CloudCliError("CONFIG_INVALID", "SIYS_SUPABASE_URL no es una URL válida.", { cause: error });
  }
  if (parsed.protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
    throw new CloudCliError("CONFIG_INVALID", "SIYS_SUPABASE_URL debe usar HTTPS.");
  }
  return { url, publishableKey };
}

export function supabaseConfigFromEnv(env = process.env) {
  return normalizeConfig({
    url: env.SIYS_SUPABASE_URL,
    publishableKey: env.SIYS_SUPABASE_PUBLISHABLE_KEY
  });
}

export function sessionFilePath(env = process.env) {
  if (env[SESSION_FILE_ENV]) return resolve(env[SESSION_FILE_ENV]);
  const configRoot = process.platform === "win32"
    ? (env.APPDATA || resolve(homedir(), "AppData", "Roaming"))
    : (env.XDG_CONFIG_HOME || resolve(homedir(), ".config"));
  return resolve(configRoot, "calendary", "session.json");
}

function sanitizeUser(user) {
  if (!user || typeof user !== "object") return null;
  return {
    id: typeof user.id === "string" ? user.id : null,
    email: typeof user.email === "string" ? user.email : null,
    displayName: typeof user.user_metadata?.display_name === "string"
      ? user.user_metadata.display_name
      : (typeof user.display_name === "string" ? user.display_name : null)
  };
}

function sanitizeSession(payload) {
  const candidate = payload?.session ?? payload;
  if (!candidate || typeof candidate !== "object" || typeof candidate.access_token !== "string" || !candidate.access_token) {
    throw new CloudCliError("AUTH_INVALID", "Supabase no devolvió una sesión válida.");
  }
  const expiresIn = Number(candidate.expires_in) || 3600;
  return {
    access_token: candidate.access_token,
    refresh_token: typeof candidate.refresh_token === "string" ? candidate.refresh_token : "",
    token_type: typeof candidate.token_type === "string" ? candidate.token_type : "bearer",
    expires_in: expiresIn,
    expires_at: Number(candidate.expires_at) || Math.floor(Date.now() / 1000) + expiresIn,
    user: sanitizeUser(candidate.user ?? payload?.user)
  };
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

function defaultFetch() {
  if (typeof globalThis.fetch !== "function") {
    throw new CloudCliError("NETWORK_UNAVAILABLE", "Node no dispone de fetch para consultar Supabase.");
  }
  return globalThis.fetch.bind(globalThis);
}

async function atomicWriteJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await chmod(temporary, 0o600).catch(() => {});
    await rename(temporary, path);
    await chmod(path, 0o600).catch(() => {});
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

export function createFileSessionStore(path = sessionFilePath()) {
  return Object.freeze({
    async read() {
      try {
        const raw = await readFile(path, "utf8");
        return JSON.parse(raw);
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw new CloudCliError("AUTH_STATE_INVALID", "No se pudo leer la sesión local de Calendary.", { cause: error });
      }
    },
    async write(value) {
      try { await atomicWriteJson(path, value); }
      catch (error) { throw new CloudCliError("AUTH_STATE_WRITE_FAILED", "No se pudo guardar la sesión local de Calendary.", { cause: error }); }
    },
    async remove() {
      await rm(path, { force: true }).catch((error) => {
        throw new CloudCliError("AUTH_STATE_REMOVE_FAILED", "No se pudo eliminar la sesión local de Calendary.", { cause: error });
      });
    },
    path
  });
}

export function createSupabaseAuthClient(config, {
  fetchImpl = defaultFetch(),
  sessionStore = createFileSessionStore(),
  now = () => Date.now(),
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  const normalized = normalizeConfig(config);
  let session = null;

  async function authRequest(path, { method = "GET", body, accessToken } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response;
      try {
        response = await fetchImpl(`${normalized.url}/auth/v1/${path}`, {
          method,
          headers: {
            apikey: normalized.publishableKey,
            "Content-Type": "application/json",
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal
        });
      } catch (error) {
        const code = error?.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR";
        throw new CloudCliError(code, `No fue posible conectar con Supabase durante ${path}.`, { cause: error });
      }
      return await parseResponse(response, path);
    } finally {
      clearTimeout(timer);
    }
  }

  async function persist(next) {
    session = next;
    if (next) await sessionStore.write(next);
    else await sessionStore.remove();
    return session;
  }

  async function readStored() {
    if (session) return session;
    const stored = await sessionStore.read();
    if (!stored) return null;
    try {
      session = sanitizeSession(stored);
      return session;
    } catch (error) {
      await sessionStore.remove().catch(() => {});
      throw error;
    }
  }

  async function refreshSession() {
    const current = await readStored();
    if (!current?.refresh_token) {
      await persist(null);
      throw new CloudCliError("AUTH_REQUIRED", "No existe una sesión renovable de Supabase.");
    }
    const payload = await authRequest("token?grant_type=refresh_token", {
      method: "POST",
      body: { refresh_token: current.refresh_token }
    });
    return persist(sanitizeSession(payload));
  }

  async function restoreSession() {
    const current = await readStored();
    if (!current) return null;
    if (Number(current.expires_at) * 1000 <= now() + 60_000) return refreshSession();
    return current;
  }

  async function signIn(email, password) {
    if (!String(email ?? "").trim() || !String(password ?? "")) {
      throw new CloudCliError("INVALID_REQUEST", "Email y contraseña son obligatorios; la contraseña no se recibe por argv.");
    }
    const payload = await authRequest("token?grant_type=password", {
      method: "POST",
      body: { email: String(email).trim(), password: String(password) }
    });
    return persist(sanitizeSession(payload));
  }

  async function whoami() {
    let current = await restoreSession();
    if (!current?.access_token) throw new CloudCliError("AUTH_REQUIRED", "Ejecuta calendary cloud login antes de consultar Supabase.");
    try {
      const payload = await authRequest("user", { method: "GET", accessToken: current.access_token });
      const user = sanitizeUser(payload);
      if (!user?.id) throw new CloudCliError("AUTH_INVALID", "Supabase no devolvió una identidad de usuario válida.");
      current = await persist({ ...current, user });
      return user;
    } catch (error) {
      if (error.code !== "AUTH_REQUIRED" || !current.refresh_token) throw error;
      current = await refreshSession();
      const payload = await authRequest("user", { method: "GET", accessToken: current.access_token });
      const user = sanitizeUser(payload);
      if (!user?.id) throw new CloudCliError("AUTH_INVALID", "Supabase no devolvió una identidad de usuario válida.");
      await persist({ ...current, user });
      return user;
    }
  }

  async function logout() {
    const current = await readStored();
    let remoteError = null;
    if (current?.access_token) {
      try { await authRequest("logout", { method: "POST", accessToken: current.access_token }); }
      catch (error) { remoteError = error; }
    }
    await persist(null);
    if (remoteError) throw remoteError;
    return { loggedOut: true };
  }

  async function accessToken() {
    const current = await restoreSession();
    if (!current?.access_token) throw new CloudCliError("AUTH_REQUIRED", "Ejecuta calendary cloud login antes de consultar Supabase.");
    return current.access_token;
  }

  return Object.freeze({
    signIn,
    whoami,
    logout,
    restoreSession,
    refreshSession,
    accessToken,
    sessionPath: sessionStore.path ?? null,
    sessionMetadata: async () => {
      const current = await readStored();
      return current ? { user: current.user, expiresAt: new Date(Number(current.expires_at) * 1000).toISOString() } : null;
    }
  });
}

export { normalizeConfig as normalizeSupabaseConfig, sanitizeUser };
