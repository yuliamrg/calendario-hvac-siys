const nativeFetch = globalThis.fetch?.bind(globalThis);

if (nativeFetch) {
  globalThis.fetch = async (input, init = {}) => {
    const inputUrl = typeof input === "string" || input instanceof URL
      ? String(input)
      : input?.url;
    const target = new URL(inputUrl);
    const hostname = target.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const isLoopback = ["localhost", "127.0.0.1", "::1"].includes(hostname)
      || hostname.endsWith(".localhost");
    if (!isLoopback) {
      throw new Error("La guarda de pruebas bloqueó una solicitud HTTP externa.");
    }
    return nativeFetch(input, init);
  };
}
