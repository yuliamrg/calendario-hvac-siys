import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("el README enlaza documentación existente", () => {
  const readme = readFileSync(resolve(root, "README.md"), "utf8");
  const links = [...readme.matchAll(/\]\(([^)]+\.md)\)/g)].map((match) => match[1]);
  assert.ok(links.length >= 3);
  for (const link of links) {
    assert.equal(existsSync(resolve(root, link)), true, `No existe ${link}`);
  }
});

test("el manual documenta persistencia, filtros, plantilla y restauración", () => {
  const manual = readFileSync(resolve(root, "docs", "MANUAL_DE_USO.md"), "utf8");
  for (const required of [
    "IndexedDB",
    "GitHub Pages",
    "Tomar control",
    "FechaInicio",
    "IncluirNoLaborables",
    "duplicados",
    "PNG",
    "respaldo",
    "SIYS Sync",
    "Ampliar",
    "REINICIAR",
    "Añadir desde JSON",
    "beta",
    "Tema",
    "Oscuro",
    "Sistema",
    "impresión"
  ]) {
    assert.match(manual, new RegExp(required, "i"));
  }
});

test("la guía de Base Operativa enumera hojas y exclusiones de privacidad", () => {
  const guide = readFileSync(resolve(root, "docs", "BASE_OPERATIVA.md"), "utf8");
  for (const sheet of [
    "dm_ciudad",
    "dm_clientes",
    "dm_sede",
    "dm_directorio_siys",
    "dm_equipo_cronograma"
  ]) {
    assert.match(guide, new RegExp(sheet));
  }
  for (const excluded of ["cédulas", "teléfonos", "correos", "fotografías"]) {
    assert.match(guide, new RegExp(excluded, "i"));
  }
});
