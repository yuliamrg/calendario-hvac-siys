import { normalizeText } from "./text.js";

const COVERAGE_INDEX = Symbol("responsibleCoverageIndex");

function groupKey(responsible) {
  return normalizeText(responsible?.group);
}

function coverageValues(responsible) {
  return (responsible?.coverage ?? [])
    .map((value) => normalizeText(value))
    .filter(Boolean);
}

function buildCoverageMaps(responsibles) {
  const coverageByGroup = new Map();
  const coverageByResponsible = new Map();

  for (const responsible of responsibles) {
    const values = new Set(coverageValues(responsible));
    coverageByResponsible.set(responsible, values);

    const key = groupKey(responsible);
    if (!key) continue;

    const groupValues = coverageByGroup.get(key) ?? new Set();
    for (const city of values) groupValues.add(city);
    coverageByGroup.set(key, groupValues);
  }

  return { coverageByGroup, coverageByResponsible };
}

export function buildGroupCoverage(responsibles = []) {
  return buildCoverageMaps(Array.from(responsibles ?? [])).coverageByGroup;
}

function isCoverageIndex(value) {
  return Boolean(value?.[COVERAGE_INDEX]);
}

function scoreWithCoverageIndex(responsible, city, index) {
  const target = normalizeText(city);
  if (!target) return 9;

  const group = groupKey(responsible);
  const groupCoverage = index.coverageByGroup.get(group);
  if (group && groupCoverage?.has(target)) return 0;

  if (normalizeText(responsible?.baseCity) === target) return 1;

  const coverage = index[COVERAGE_INDEX].coverageByResponsible.get(responsible)
    ?? new Set(coverageValues(responsible));
  if (coverage.has(target)) return 2;

  if (
    normalizeText(responsible?.baseCity) === "nacional" ||
    normalizeText(responsible?.group) === "nacional"
  ) return 3;

  return 9;
}

/**
 * Creates a reusable snapshot of normalized group/city coverage for a catalog.
 * The returned `score(responsible, city)` method reuses that snapshot.
 */
export function createResponsibleCoverageIndex(responsibles = []) {
  const list = Array.from(responsibles ?? []);
  const { coverageByGroup, coverageByResponsible } = buildCoverageMaps(list);
  const index = {
    coverageByGroup,
    score(responsible, city) {
      return scoreWithCoverageIndex(responsible, city, index);
    },
  };

  Object.defineProperty(index, COVERAGE_INDEX, {
    configurable: false,
    enumerable: false,
    value: { coverageByResponsible },
    writable: false,
  });

  return Object.freeze(index);
}

export function responsibleCoverageScore(responsible, city, responsibles = []) {
  const index = isCoverageIndex(responsibles)
    ? responsibles
    : createResponsibleCoverageIndex(responsibles);
  return scoreWithCoverageIndex(responsible, city, index);
}

export function sortResponsiblesByCoverage(
  responsibles = [],
  city = "",
  coverageIndex = null,
) {
  const list = Array.from(responsibles ?? []);
  const index = isCoverageIndex(coverageIndex)
    ? coverageIndex
    : createResponsibleCoverageIndex(list);

  return list.sort((left, right) => {
    const score = scoreWithCoverageIndex(left, city, index)
      - scoreWithCoverageIndex(right, city, index);
    if (score) return score;
    if (Boolean(left.favorite) !== Boolean(right.favorite)) return left.favorite ? -1 : 1;
    return String(left.name ?? "").localeCompare(String(right.name ?? ""), "es");
  });
}
