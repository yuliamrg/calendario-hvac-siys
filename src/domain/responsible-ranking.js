import { normalizeText } from "./text.js";

function groupKey(responsible) {
  return normalizeText(responsible?.group);
}

function coverageValues(responsible) {
  return (responsible?.coverage ?? [])
    .map((value) => normalizeText(value))
    .filter(Boolean);
}

export function buildGroupCoverage(responsibles = []) {
  const coverage = new Map();
  for (const responsible of responsibles) {
    const key = groupKey(responsible);
    if (!key) continue;
    const values = coverage.get(key) ?? new Set();
    for (const city of coverageValues(responsible)) values.add(city);
    coverage.set(key, values);
  }
  return coverage;
}

export function responsibleCoverageScore(responsible, city, responsibles = []) {
  const target = normalizeText(city);
  if (!target) return 9;
  const group = groupKey(responsible);
  const groupCoverage = buildGroupCoverage(responsibles).get(group);
  if (group && groupCoverage?.has(target)) return 0;
  if (normalizeText(responsible?.baseCity) === target) return 1;
  if (coverageValues(responsible).includes(target)) return 2;
  if (
    normalizeText(responsible?.baseCity) === "nacional" ||
    normalizeText(responsible?.group) === "nacional"
  ) return 3;
  return 9;
}

export function sortResponsiblesByCoverage(responsibles = [], city = "") {
  return [...responsibles].sort((left, right) => {
    const score = responsibleCoverageScore(left, city, responsibles)
      - responsibleCoverageScore(right, city, responsibles);
    if (score) return score;
    if (Boolean(left.favorite) !== Boolean(right.favorite)) return left.favorite ? -1 : 1;
    return String(left.name ?? "").localeCompare(String(right.name ?? ""), "es");
  });
}
