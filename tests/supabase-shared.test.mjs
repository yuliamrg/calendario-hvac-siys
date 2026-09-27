import test from "node:test";
import assert from "node:assert/strict";

import {
  SupabaseTransportError,
  createSupabaseTransport,
  isSupabaseConfigComplete,
  normalizeSupabaseConfig
} from "../src/supabase/transport.js";

const BASE_CONFIG = Object.freeze({
  url: "https://project.supabase.co",
  publishableKey: "sb_publishable_test"
});

function createFetchRecorder(response = new Response("{}", { status: 200 })) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return response;
  };
  return { fetchImpl, calls };
}

test("normalizeSupabaseConfig recorta espacios y elimina slashes finales", () => {
  assert.deepEqual(
    normalizeSupabaseConfig({ url: "  https://project.supabase.co/  ", publishableKey: "  sb_publishable_test  " }),
    { url: "https://project.supabase.co", publishableKey: "sb_publishable_test" }
  );
  assert.deepEqual(
    normalizeSupabaseConfig({ url: "https://project.supabase.co///" }),
    { url: "https://project.supabase.co", publishableKey: "" }
  );
  assert.equal("enabled" in normalizeSupabaseConfig({ enabled: true }), false);
});

test("isSupabaseConfigComplete exige URL y clave pública", () => {
  assert.equal(isSupabaseConfigComplete(BASE_CONFIG), true);
  assert.equal(isSupabaseConfigComplete({ url: BASE_CONFIG.url }), false);
  assert.equal(isSupabaseConfigComplete({ publishableKey: BASE_CONFIG.publishableKey }), false);
  assert.equal(isSupabaseConfigComplete({ url: "  ", publishableKey: "  " }), false);
});

test("createSupabaseTransport rechaza configuración incompleta", () => {
  assert.throws(
    () => createSupabaseTransport({ url: BASE_CONFIG.url }, { fetchImpl: () => {} }),
    (error) => error instanceof SupabaseTransportError && error.code === "invalid_config"
  );
});

test("createSupabaseTransport exige un fetchImpl inyectado sin usar globalThis.fetch", () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("globalThis.fetch no debe usarse");
  };
  try {
    assert.throws(
      () => createSupabaseTransport(BASE_CONFIG),
      (error) => error instanceof SupabaseTransportError && error.code === "fetch_unavailable"
    );
    assert.throws(
      () => createSupabaseTransport(BASE_CONFIG, { fetchImpl: null }),
      (error) => error.code === "fetch_unavailable"
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("authRequest construye la URL de auth, la apikey y el body JSON", async () => {
  const { fetchImpl, calls } = createFetchRecorder();
  const transport = createSupabaseTransport(BASE_CONFIG, { fetchImpl });

  await transport.authRequest("token?grant_type=password", {
    body: { email: "a@b.co", password: "secret" }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://project.supabase.co/auth/v1/token?grant_type=password");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.apikey, BASE_CONFIG.publishableKey);
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  assert.equal(calls[0].init.body, JSON.stringify({ email: "a@b.co", password: "secret" }));
});

test("restRequest construye la URL REST y sólo añade Authorization con token", async () => {
  const withoutToken = createFetchRecorder();
  const transportWithoutToken = createSupabaseTransport(BASE_CONFIG, { fetchImpl: withoutToken.fetchImpl });
  await transportWithoutToken.restRequest("/rest/v1/calendars?select=id");
  assert.equal(withoutToken.calls[0].url, "https://project.supabase.co/rest/v1/calendars?select=id");
  assert.equal(withoutToken.calls[0].init.method, "GET");
  assert.equal(withoutToken.calls[0].init.headers.apikey, BASE_CONFIG.publishableKey);
  assert.equal("Authorization" in withoutToken.calls[0].init.headers, false);
  assert.equal(withoutToken.calls[0].init.body, undefined);

  const withToken = createFetchRecorder();
  const transportWithToken = createSupabaseTransport(BASE_CONFIG, { fetchImpl: withToken.fetchImpl });
  await transportWithToken.restRequest("/rest/v1/calendars", { accessToken: "access-123" });
  assert.equal(withToken.calls[0].init.headers.Authorization, "Bearer access-123");
});

test("restRequest acepta rutas sin slash inicial", async () => {
  const { fetchImpl, calls } = createFetchRecorder();
  const transport = createSupabaseTransport(BASE_CONFIG, { fetchImpl });
  await transport.restRequest("rest/v1/profiles?select=id");
  assert.equal(calls[0].url, "https://project.supabase.co/rest/v1/profiles?select=id");
});

test("los headers personalizados se preservan y tienen precedencia", async () => {
  const { fetchImpl, calls } = createFetchRecorder();
  const transport = createSupabaseTransport(BASE_CONFIG, { fetchImpl });

  await transport.restRequest("/rest/v1/calendar_documents", {
    method: "POST",
    headers: { Prefer: "return=representation", apikey: "custom-key" },
    body: [{ calendar_id: "abc" }]
  });

  assert.equal(calls[0].init.headers.Prefer, "return=representation");
  assert.equal(calls[0].init.headers.apikey, "custom-key");
  assert.equal(calls[0].init.body, JSON.stringify([{ calendar_id: "abc" }]));
});

test("sólo se usa AbortController cuando timeoutMs > 0", async () => {
  const withoutTimeout = createFetchRecorder();
  const transportWithoutTimeout = createSupabaseTransport(BASE_CONFIG, { fetchImpl: withoutTimeout.fetchImpl });
  await transportWithoutTimeout.restRequest("/rest/v1/calendars");
  assert.equal("signal" in withoutTimeout.calls[0].init, false);

  const withTimeout = createFetchRecorder();
  const transportWithTimeout = createSupabaseTransport(BASE_CONFIG, { fetchImpl: withTimeout.fetchImpl, timeoutMs: 1_000 });
  await transportWithTimeout.restRequest("/rest/v1/calendars");
  assert.equal(withTimeout.calls[0].init.signal instanceof AbortSignal, true);
});

test("un fallo de red se traduce a network_error con cause", async () => {
  const failure = new TypeError("falló la red");
  const fetchImpl = async () => {
    throw failure;
  };
  const transport = createSupabaseTransport(BASE_CONFIG, { fetchImpl });

  await assert.rejects(
    transport.authRequest("token?grant_type=password", { body: {} }),
    (error) => (
      error instanceof SupabaseTransportError
      && error.code === "network_error"
      && error.cause === failure
    )
  );
});

test("un abort por timeout se traduce a timeout con cause", async () => {
  const fetchImpl = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener("abort", () => {
      const abortError = new Error("aborted");
      abortError.name = "AbortError";
      reject(abortError);
    });
  });
  const transport = createSupabaseTransport(BASE_CONFIG, { fetchImpl, timeoutMs: 10 });

  await assert.rejects(
    transport.authRequest("token?grant_type=password", { body: {} }),
    (error) => (
      error instanceof SupabaseTransportError
      && error.code === "timeout"
      && error.cause?.name === "AbortError"
    )
  );
});

test("el transporte devuelve el Response aunque el estado sea 401/403/500", async () => {
  for (const status of [401, 403, 500]) {
    const { fetchImpl } = createFetchRecorder(new Response("{}", { status }));
    const transport = createSupabaseTransport(BASE_CONFIG, { fetchImpl });
    const response = await transport.restRequest("/rest/v1/calendar_documents", { accessToken: "token" });
    assert.equal(response.status, status);
  }
});
