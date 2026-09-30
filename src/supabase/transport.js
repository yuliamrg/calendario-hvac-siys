const NETWORK_MESSAGE = "No fue posible conectar con Supabase durante";
const TIMEOUT_MESSAGE = "La conexión con Supabase agotó el tiempo durante";

export class SupabaseTransportError extends Error {
  constructor(message, { code = "", status = 0, details = null, cause = null } = {}) {
    super(message);
    this.name = "SupabaseTransportError";
    this.code = code;
    this.status = status;
    this.details = details;
    if (cause) this.cause = cause;
  }
}

export function normalizeSupabaseConfig(config = {}) {
  return {
    url: String(config.url ?? "").trim().replace(/\/+$/, ""),
    publishableKey: String(config.publishableKey ?? "").trim()
  };
}

export function isSupabaseConfigComplete(config = {}) {
  const { url, publishableKey } = normalizeSupabaseConfig(config);
  return Boolean(url && publishableKey);
}

function joinAuthUrl(baseUrl, path) {
  const suffix = String(path ?? "").replace(/^\/+/, "");
  return `${baseUrl}/auth/v1/${suffix}`;
}

function joinRestUrl(baseUrl, path) {
  const suffix = String(path ?? "").replace(/^\/+/, "");
  return suffix ? `${baseUrl}/${suffix}` : `${baseUrl}/`;
}

export function createSupabaseTransport(config, { fetchImpl, timeoutMs = 0 } = {}) {
  const normalized = normalizeSupabaseConfig(config);
  if (!isSupabaseConfigComplete(normalized)) {
    throw new SupabaseTransportError("La configuración de Supabase está incompleta.", {
      code: "invalid_config",
      details: {
        hasUrl: Boolean(normalized.url),
        hasPublishableKey: Boolean(normalized.publishableKey)
      }
    });
  }
  if (typeof fetchImpl !== "function") {
    throw new SupabaseTransportError(
      "Se requiere inyectar una función fetch para usar el transporte Supabase.",
      { code: "fetch_unavailable" }
    );
  }

  const effectiveTimeoutMs = Number(timeoutMs) > 0 ? Number(timeoutMs) : 0;

  async function performRequest({ url, method, body, headers, accessToken, operation }) {
    const requestHeaders = {
      apikey: normalized.publishableKey,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers
    };
    const init = { method, headers: requestHeaders };
    if (body !== undefined) init.body = JSON.stringify(body);

    const useTimeout = effectiveTimeoutMs > 0;
    const controller = useTimeout ? new AbortController() : null;
    const timer = useTimeout ? setTimeout(() => controller.abort(), effectiveTimeoutMs) : null;
    if (controller) init.signal = controller.signal;

    try {
      return await fetchImpl(url, init);
    } catch (error) {
      const timedOut = error?.name === "AbortError" || error?.name === "TimeoutError";
      throw new SupabaseTransportError(
        `${timedOut ? TIMEOUT_MESSAGE : NETWORK_MESSAGE} ${operation}.`,
        {
          code: timedOut ? "timeout" : "network_error",
          details: { operation },
          cause: error
        }
      );
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }

  function authRequest(path, {
    method = "POST",
    body,
    headers = {},
    accessToken,
    operation = String(path)
  } = {}) {
    return performRequest({
      url: joinAuthUrl(normalized.url, path),
      method,
      body,
      headers,
      accessToken,
      operation
    });
  }

  function restRequest(path, {
    method = "GET",
    body,
    headers = {},
    accessToken,
    operation = String(path)
  } = {}) {
    return performRequest({
      url: joinRestUrl(normalized.url, path),
      method,
      body,
      headers,
      accessToken,
      operation
    });
  }

  return Object.freeze({ authRequest, restRequest });
}
