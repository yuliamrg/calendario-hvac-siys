import { SupabaseTransportError, createSupabaseTransport } from "@siys-sync/platform/supabase/transport.js";
import { CloudCliError } from "./cloud-errors.js";
import { createSupabaseAuthClient, supabaseConfigFromEnv } from "./cloud-auth.js";

const DEFAULT_OPERATION = "consulta cloud";

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

function mapTransportError(error, operation) {
  if (!(error instanceof SupabaseTransportError)) return error;
  const cause = error.cause ?? error;
  if (error.code === "network_error" || error.code === "timeout") {
    const code = error.code === "timeout" ? "TIMEOUT" : "NETWORK_ERROR";
    return new CloudCliError(code, `No fue posible conectar con Supabase durante ${operation}.`, { cause });
  }
  if (error.code === "invalid_config") {
    return new CloudCliError("CONFIG_INVALID", error.message, { cause });
  }
  if (error.code === "fetch_unavailable") {
    return new CloudCliError("NETWORK_UNAVAILABLE", error.message, { cause });
  }
  return error;
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
    const code = response.status === 401
      ? "AUTH_REQUIRED"
      : response.status === 403
        ? "RLS_DENIED"
        : response.status >= 500
          ? "REMOTE_UNAVAILABLE"
          : "REMOTE_ERROR";
    throw new CloudCliError(code, compactMessage(payload, `Supabase respondió ${response.status} durante ${operation}.`), {
      status: response.status,
      details: { operation, status: response.status }
    });
  }
  return payload;
}

export function createSupabaseRestClient(config, {
  auth,
  fetchImpl = defaultFetch(),
  timeoutMs = 15_000
} = {}) {
  const normalized = config ?? supabaseConfigFromEnv();
  const authClient = auth ?? createSupabaseAuthClient(normalized, { fetchImpl, timeoutMs });
  let transport;
  try {
    transport = createSupabaseTransport(normalized, { fetchImpl, timeoutMs });
  } catch (error) {
    throw mapTransportError(error, "configuración");
  }

  async function request(path, {
    method = "GET",
    body,
    headers = {},
    operation = DEFAULT_OPERATION,
    retry = true
  } = {}) {
    const verb = String(method ?? "GET").toUpperCase();
    const token = await authClient.accessToken();
    let response;
    try {
      response = await transport.restRequest(path, {
        method: verb,
        body,
        accessToken: token,
        operation,
        headers
      });
    } catch (error) {
      throw mapTransportError(error, operation);
    }
    if (response.status === 401 && retry) {
      await authClient.refreshSession();
      return request(path, { method: verb, body, headers, operation, retry: false });
    }
    return await parseResponse(response, operation);
  }

  return Object.freeze({ request });
}
