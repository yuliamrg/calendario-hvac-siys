import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  createResponsibleCoverageIndex,
  responsibleCoverageScore,
  sortResponsiblesByCoverage,
} from "../packages/platform/src/domain/responsible-ranking.js";

const root = resolve(import.meta.dirname, "..");

const catalog = [
  {
    name: "Grupo Pereira",
    group: "Zona Cafetera",
    coverage: ["Pereira"],
    baseCity: "Cali",
    favorite: false,
  },
  {
    name: "Grupo Armenia",
    group: "Zona Cafetera",
    coverage: ["Armenia"],
    baseCity: "Cali",
    favorite: false,
  },
  {
    name: "Base Manizales",
    group: "Otra zona",
    coverage: [],
    baseCity: "Manizales",
    favorite: false,
  },
  {
    name: "Cobertura Pereira",
    group: "",
    coverage: ["Pereira"],
    baseCity: "Cali",
    favorite: false,
  },
  {
    name: "Nacional",
    group: "Nacional",
    coverage: [],
    baseCity: "Nacional",
    favorite: false,
  },
  {
    name: "Sin cobertura",
    group: "Otra zona",
    coverage: [],
    baseCity: "Cali",
    favorite: false,
  },
  {
    name: "A Favorito",
    group: "Otra zona",
    coverage: [],
    baseCity: "Cali",
    favorite: true,
  },
];

function namesFor(city, index = null) {
  return sortResponsiblesByCoverage(catalog, city, index).map(({ name }) => name);
}

test("el índice expone cobertura normalizada reutilizable por catálogo", () => {
  const index = createResponsibleCoverageIndex(catalog);

  assert.equal(typeof index.score, "function");
  assert.equal(index.coverageByGroup.get("zona cafetera")?.has("pereira"), true);
  assert.equal(index.coverageByGroup.get("zona cafetera")?.has("armenia"), true);
  assert.equal(index.score(catalog[1], "Pereira"), 0);
  assert.equal(responsibleCoverageScore(catalog[1], "Pereira", index), 0);
  assert.equal(responsibleCoverageScore(catalog[1], "Pereira", catalog), 0);
});

test("mantiene zona, ciudad base, cobertura individual, nacional, favoritos y nombre", () => {
  assert.deepEqual(namesFor("Pereira"), [
    "Grupo Armenia",
    "Grupo Pereira",
    "Cobertura Pereira",
    "Nacional",
    "A Favorito",
    "Base Manizales",
    "Sin cobertura",
  ]);

  assert.deepEqual(namesFor("Armenia"), [
    "Grupo Armenia",
    "Grupo Pereira",
    "Nacional",
    "A Favorito",
    "Base Manizales",
    "Cobertura Pereira",
    "Sin cobertura",
  ]);

  assert.deepEqual(namesFor("Manizales"), [
    "Base Manizales",
    "Nacional",
    "A Favorito",
    "Cobertura Pereira",
    "Grupo Armenia",
    "Grupo Pereira",
    "Sin cobertura",
  ]);

  assert.deepEqual(namesFor(""), [
    "A Favorito",
    "Base Manizales",
    "Cobertura Pereira",
    "Grupo Armenia",
    "Grupo Pereira",
    "Nacional",
    "Sin cobertura",
  ]);
});

function legacyWebOrder(city, responsibles = catalog) {
  return Array.from(responsibles)
    .sort((a, b) => {
      const score = responsibleCoverageScore(a, city, responsibles)
        - responsibleCoverageScore(b, city, responsibles);
      if (score) return score;
      if (Boolean(a.favorite) !== Boolean(b.favorite)) return a.favorite ? -1 : 1;
      return String(a.name ?? "").localeCompare(String(b.name ?? ""), "es");
    })
    .map(({ name }) => name);
}

function countingCatalog(size) {
  let groupReads = 0;
  let coverageReads = 0;
  const responsibles = [];
  for (let index = 0; index < size; index += 1) {
    const name = `Responsable ${String(index).padStart(4, "0")}`;
    const group = index % 3 === 0 ? "Zona Cafetera" : `Zona ${index % 5}`;
    const baseCity = `Ciudad ${index % 7}`;
    const coverage = index % 4 === 0 ? ["Pereira"] : [`Ciudad ${index % 11}`];
    const favorite = index % 10 === 0;
    responsibles.push({
      get name() { return name; },
      get group() { groupReads += 1; return group; },
      get baseCity() { return baseCity; },
      get coverage() { coverageReads += 1; return coverage; },
      get favorite() { return favorite; },
      get responsibleType() { return index % 2 ? "payroll" : "contractor"; },
    });
  }
  return {
    responsibles,
    reset() { groupReads = 0; coverageReads = 0; },
    reads() { return groupReads + coverageReads; },
  };
}

test("el orden con índice reutilizable coincide con el camino anterior en cada ciudad", () => {
  for (const city of ["Pereira", "Armenia", "Manizales", "Bogotá", "Nacional", ""]) {
    const index = createResponsibleCoverageIndex(catalog);
    assert.deepEqual(namesFor(city, index), legacyWebOrder(city), `difiere para la ciudad ${city || "(vacía)"}`);
  }
});

test("la integración Web reutiliza un índice por orden en vez de reconstruirlo por comparador", () => {
  const { responsibles, reset, reads } = countingCatalog(300);
  const city = "Pereira";

  reset();
  const legacy = legacyWebOrder(city, responsibles);
  const legacyReads = reads();

  reset();
  const index = createResponsibleCoverageIndex(responsibles);
  const optimized = sortResponsiblesByCoverage(responsibles, city, index).map(({ name }) => name);
  const optimizedReads = reads();

  assert.deepEqual(optimized, legacy);
  assert.ok(legacyReads > 0 && optimizedReads > 0);
  assert.ok(
    optimizedReads * 20 < legacyReads,
    `el índice reutilizable debe leer cobertura mucho menos (${optimizedReads} vs ${legacyReads})`,
  );
});

test("la Web construye un único índice reutilizable y no vuelve a responsibleCoverageScore por comparador", async () => {
  const app = await readFile(resolve(root, "apps", "web", "src", "app.js"), "utf8");
  assert.match(app, /createResponsibleCoverageIndex\(appDocument\.catalog\.responsibles\)/);
  assert.match(app, /sortResponsiblesByCoverage\(/);
  assert.doesNotMatch(app, /responsibleCoverageScore/);
  assert.equal((app.match(/createResponsibleCoverageIndex\(/g) ?? []).length, 1);
});

test("sortResponsiblesByCoverage acepta el mismo índice en varias ordenaciones", () => {
  const index = createResponsibleCoverageIndex(catalog);
  const coverageByGroup = index.coverageByGroup;

  assert.equal(namesFor("Pereira", index)[0], "Grupo Armenia");
  assert.equal(namesFor("Armenia", index)[0], "Grupo Armenia");
  assert.strictEqual(index.coverageByGroup, coverageByGroup);
  assert.equal(index.score(catalog[2], "Manizales"), 1);
  assert.equal(index.score(catalog[3], "Pereira"), 2);
  assert.equal(index.score(catalog[4], "Manizales"), 3);
  assert.equal(index.score(catalog[5], "Manizales"), 9);

  const sourceCatalog = catalog.map((responsible) => ({
    ...responsible,
    coverage: [...(responsible.coverage ?? [])],
  }));
  const sourceIndex = createResponsibleCoverageIndex(sourceCatalog);
  sourceCatalog[0].coverage = ["Cali"];

  assert.equal(
    sortResponsiblesByCoverage(sourceCatalog, "Pereira", sourceIndex)[0].name,
    "Grupo Armenia",
  );
  assert.equal(sortResponsiblesByCoverage(sourceCatalog, "Pereira")[0].name, "Cobertura Pereira");
});
