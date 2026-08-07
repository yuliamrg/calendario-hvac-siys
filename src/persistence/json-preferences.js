export function createJsonPreferences(storage, key) {
  function read() {
    try {
      const parsed = JSON.parse(storage.getItem(key) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function update(patch) {
    const next = { ...read(), ...patch };
    storage.setItem(key, JSON.stringify(next));
    return next;
  }

  function clear() {
    storage.removeItem(key);
  }

  return Object.freeze({ read, update, clear });
}
