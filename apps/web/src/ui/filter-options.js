import { normalizeText } from "@siys-sync/platform/domain/text.js";

export function filterOptionMatches(label, query) {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return true;
  return normalizeText(label).includes(normalizedQuery);
}

export function filterOptionsBySearch(options, query) {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return [...options];
  return options.filter((option) => filterOptionMatches(option.label, normalizedQuery));
}
