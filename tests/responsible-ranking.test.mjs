import assert from "node:assert/strict";
import test from "node:test";

import {
  createResponsibleCoverageIndex,
  responsibleCoverageScore,
  sortResponsiblesByCoverage,
} from "../src/domain/responsible-ranking.js";

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
