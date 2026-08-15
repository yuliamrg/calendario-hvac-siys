import test from "node:test";
import assert from "node:assert/strict";

import * as core from "../src/core.js";
import {
  addDaysISO,
  compareISODate,
  isISODateString,
  monthGridDates,
  parseISODate,
  todayInBogota
} from "../src/domain/dates.js";
import { normalizeDisplayText, normalizeKey, normalizeText, safeText } from "../src/domain/text.js";
import { responsibleCoverageScore, sortResponsiblesByCoverage } from "../src/domain/responsible-ranking.js";
import {
  colombianHolidays,
  generateSeriesDates,
  holidayMapForRange
} from "../src/domain/holidays.js";
import {
  displayInitialsFor,
  formatDisplayDate,
  formatMonthTitle,
  timestampLabel
} from "../src/ui/presentation.js";
import {
  decodeAddress,
  decodeRange,
  encodeColumn,
  findHeader,
  worksheetRows
} from "../src/import/xlsx-table.js";

test("la fachada del núcleo conserva las utilidades de dominio extraídas", () => {
  assert.equal(core.parseISODate, parseISODate);
  assert.equal(core.addDaysISO, addDaysISO);
  assert.equal(core.compareISODate, compareISODate);
  assert.equal(core.monthGridDates, monthGridDates);
  assert.equal(core.todayInBogota, todayInBogota);
  assert.equal(core.normalizeKey, normalizeKey);
  assert.equal(core.normalizeText, normalizeText);
  assert.equal(core.safeText, safeText);
  assert.equal(core.normalizeDisplayText, normalizeDisplayText);
  assert.equal(core.colombianHolidays, colombianHolidays);
  assert.equal(core.generateSeriesDates, generateSeriesDates);
  assert.equal(core.holidayMapForRange, holidayMapForRange);
});

test("la normalización visible usa mayúscula inicial por línea", () => {
  assert.equal(normalizeDisplayText("  VISITA TECNICA\nRUTA PEREIRA  "), "Visita tecnica\nRuta pereira");
});

test("la cobertura del grupo prioriza responsables de la zona atendida", () => {
  const responsibles = [
    { name: "Ana", group: "SIYS Pereira", baseCity: "Pereira", coverage: ["Armenia", "Pereira", "Manizales"] },
    { name: "Carlos", group: "SIYS Pereira", baseCity: "Pereira", coverage: [] },
    { name: "Laura", group: "Otra zona", baseCity: "Bogotá", coverage: [] }
  ];
  assert.equal(responsibleCoverageScore(responsibles[1], "Armenia", responsibles), 0);
  assert.deepEqual(sortResponsiblesByCoverage(responsibles, "Armenia").slice(0, 2).map((item) => item.name), ["Ana", "Carlos"]);
});

test("las utilidades de fecha validan y calculan sin depender del documento", () => {
  assert.equal(isISODateString("2026-08-06"), true);
  assert.equal(isISODateString("06/08/2026"), false);
  assert.equal(addDaysISO("2026-08-06", 1), "2026-08-07");
  assert.equal(monthGridDates(2026, 8).length, 42);
  assert.throws(() => parseISODate("2026-02-30"), /Fecha inexistente/);
});

test("la presentación concentra formatos visibles y sus fallbacks", () => {
  assert.match(formatDisplayDate("2026-08-06"), /6/);
  assert.match(formatMonthTitle(2026, 8), /2026/);
  assert.equal(displayInitialsFor("  Jhon Jairo Bermudez "), "JJ");
  assert.equal(timestampLabel("valor heredado"), "valor heredado");
});

test("la lectura tabular de Excel queda aislada de las reglas de importación", () => {
  assert.equal(encodeColumn(26), "AA");
  assert.deepEqual(decodeAddress("$C$12"), { row: 11, column: 2 });
  assert.deepEqual(decodeRange("A1:B2"), {
    start: { row: 0, column: 0 },
    end: { row: 1, column: 1 }
  });
  assert.equal(findHeader(["Código sede", "Nombre"], ["codigo_sede", "Código sede"]), 0);
  assert.deepEqual(worksheetRows({
    "!ref": "A1:B2",
    A1: { v: "Encabezado" },
    B2: { v: 42 }
  }), [["Encabezado", null], [null, 42]]);
});
