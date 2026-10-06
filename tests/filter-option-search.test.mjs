import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  filterOptionMatches,
  filterOptionsBySearch
} from "../apps/web/src/ui/filter-options.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appSource = readFileSync(resolve(root, "apps", "web", "src", "app.js"), "utf8");
const styles = readFileSync(resolve(root, "apps", "web", "src", "styles.css"), "utf8");

const OPTIONS = [
  { value: "a", label: "Carlos Pérez" },
  { value: "b", label: "María Gómez" },
  { value: "c", label: "Juan Carlos Restrepo" },
  { value: "d", label: "Andrés Ñáñez" }
];

const searchHandlerSource = () => {
  const match = appSource.match(
    /searchInput\.addEventListener\("input"[\s\S]*?emptyNote\.hidden = visibleValues\.size !== 0;/
  );
  assert.ok(match, "debe existir el manejador de búsqueda local de opciones");
  return match[0];
};

test("la búsqueda de opciones ignora mayúsculas, acentos y espacios sobrantes", () => {
  assert.equal(filterOptionMatches("Carlos Pérez", "PEREZ"), true);
  assert.equal(filterOptionMatches("María Gómez", "maria"), true);
  assert.equal(filterOptionMatches("Andrés Ñáñez", "nanez"), true);
  assert.equal(filterOptionMatches("Carlos Pérez", "   "), true);
  assert.equal(filterOptionMatches("Carlos Pérez", "juan"), false);
});

test("la búsqueda filtra sólo las opciones que coinciden sin mirar el contador", () => {
  assert.deepEqual(filterOptionsBySearch(OPTIONS, "").map((option) => option.value), ["a", "b", "c", "d"]);
  assert.deepEqual(filterOptionsBySearch(OPTIONS, "carlos").map((option) => option.value), ["a", "c"]);
  assert.deepEqual(filterOptionsBySearch(OPTIONS, "gomez").map((option) => option.value), ["b"]);
  assert.deepEqual(filterOptionsBySearch(OPTIONS, "sin coincidencia").map((option) => option.value), []);
  assert.deepEqual(
    filterOptionsBySearch(OPTIONS, "12").map((option) => option.value),
    [],
    "el conteo mostrado no participa del matching"
  );
});

test("el diálogo incorpora buscadores propios sólo en Cliente, Sede y Responsable", () => {
  assert.ok(
    appSource.includes("searchInput.id = `filterSearch-${definition.key}`"),
    "debe existir un buscador por categoría con id derivado de la clave"
  );
  for (const label of ["Buscar cliente", "Buscar sede", "Buscar responsable"]) {
    assert.ok(appSource.includes(`searchLabel: "${label}"`), `debe existir el buscador de ${label}`);
  }
  assert.match(appSource, /searchInput\.placeholder = definition\.searchPlaceholder/);
  assert.match(appSource, /searchInput\.setAttribute\("aria-label", definition\.searchLabel\)/);
  assert.doesNotMatch(appSource, /searchLabel: "Buscar (ciudad|servicio|estado)/i);
});

test("escribir en el buscador oculta filas sin desmarcar selecciones ni tocar filtros reales", () => {
  assert.match(searchHandlerSource(), /row\.hidden = !visibleValues\.has\(value\)/);
  assert.doesNotMatch(searchHandlerSource(), /\.checked\s*=/);
  assert.ok(
    appSource.includes('dom.filterGrid.querySelectorAll(`input[name="filter-${definition.key}"]:checked`)'),
    "el envío debe recolectar las casillas marcadas, incluidas las ocultas por búsqueda"
  );
});

test("las búsquedas del diálogo son temporales y ajenas a la búsqueda global", () => {
  assert.match(appSource, /function openFilterDialog\(\) \{\s*renderFilterDialog\(\);/);
  assert.doesNotMatch(searchHandlerSource(), /settings\.filters|dom\.globalSearch|updateFilter\(/);
  assert.match(
    appSource,
    /dom\.globalSearch\.addEventListener\("input", \(\) => updateFilter\("query", dom\.globalSearch\.value\)\)/
  );
  assert.match(appSource, /dom\.globalSearch\.value = appDocument\.settings\.filters\.query \?\? ""/);
});

test("el diálogo indica 'Sin coincidencias' cuando la búsqueda no deja opciones", () => {
  assert.ok(appSource.includes('"Sin coincidencias"'));
  assert.match(appSource, /emptyNote\.hidden = visibleValues\.size !== 0/);
  assert.match(styles, /\.filter-empty-note\s*\{/);
});

test("el buscador de opciones usa los tokens del tema y no desborda en móvil", () => {
  assert.match(styles, /\.filter-option-search\s*\{[\s\S]*?width:\s*100%;/);
  assert.match(styles, /\.filter-option-search\s*\{[\s\S]*?color:\s*var\(--ink\);/);
  assert.match(styles, /\.filter-option-search\s*\{[\s\S]*?background:\s*var\(--surface\);/);
});
