export function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function normalizeKey(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function safeText(value, maxLength = 5000) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, maxLength);
}

export function normalizeDisplayText(value, maxLength = 5000) {
  const source = safeText(value, maxLength);
  if (!source) return "";
  return source
    .split(/(\r?\n)/)
    .map((part) => {
      if (/^\r?\n$/.test(part)) return part;
      const lower = part.toLocaleLowerCase("es-CO");
      const firstLetter = lower.search(/[a-záéíóúüñ]/i);
      if (firstLetter < 0) return lower;
      return `${lower.slice(0, firstLetter)}${lower[firstLetter].toLocaleUpperCase("es-CO")}${lower.slice(firstLetter + 1)}`;
    })
    .join("");
}
