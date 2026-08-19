import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  buildExportActivityRow,
  layoutExportActivityRow,
  wrapExportText
} from "../src/ui/export-layout.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fakeMeasureContext() {
  return {
    font: "initial",
    measureText(value) {
      return { width: [...String(value)].length };
    }
  };
}

test("la fila exportable conserva estado, icono y nombres completos", () => {
  const row = buildExportActivityRow(
    {
      serviceType: "preventive",
      status: "in_progress",
      responsibleIds: ["r1", "r2"],
      observations: "Cambio de filtro"
    },
    {
      client: { name: "Cliente Uno" },
      site: { name: "Sede Centro" },
      responsibles: new Map([
        ["r1", { id: "r1", name: "Ana Técnica", initials: "AT", responsibleType: "payroll" }],
        ["r2", { id: "r2", name: "Carlos Contratista", initials: "CC", responsibleType: "contractor" }]
      ])
    }
  );

  assert.equal(row.title, "MP · Cliente Uno");
  assert.equal(row.location, "Sede Centro");
  assert.deepEqual(row.responsibleNames, ["Ana Técnica", "Carlos Contratista"]);
  assert.equal(row.responsible, "Técnicos: Ana Técnica · Carlos Contratista");
  assert.equal(row.responsibleVariant, "mixed");
  assert.equal(row.statusPresentation.icon, "▶");
  assert.equal(row.statusPresentation.label, "En ejecución");
  assert.equal(row.status, "▶ En ejecución · Cambio de filtro");
  assert.equal(Object.isFrozen(row), true);
});

test("el ajuste de texto separa palabras largas sin truncar", () => {
  const context = fakeMeasureContext();
  assert.deepEqual(wrapExportText(context, "uno dos tres", 7), ["uno dos", "tres"]);

  const lines = wrapExportText(context, "ClienteSuperlargo 2026", 8);
  assert.deepEqual(lines, ["ClienteS", "uperlarg", "o 2026"]);
  assert.ok(lines.every((line) => line.length <= 8));
  assert.deepEqual(wrapExportText(context, "", 8), []);
  assert.throws(() => wrapExportText(context, "texto", 0), RangeError);
});

test("el layout usa el contexto falso, mide las cuatro líneas y restaura la fuente", () => {
  const row = buildExportActivityRow(
    {
      serviceType: "corrective",
      status: "not_executed",
      responsibleIds: [],
      observations: "Observación suficientemente larga para forzar varias líneas"
    },
    { clientName: "Cliente con un nombre largo", city: "Pereira" }
  );
  const context = fakeMeasureContext();
  const layout = layoutExportActivityRow(row, context, { maxWidth: 18, minHeight: 0 });

  assert.deepEqual(Object.keys(layout.lines), ["title", "location", "responsible", "status"]);
  assert.ok(Object.values(layout.lines).every((lines) => lines.length > 0));
  assert.ok(Object.values(layout.lines).flat().every((line) => line.length <= 18));
  assert.ok(layout.height > 0);
  assert.equal(context.font, "initial");
  assert.equal(Object.isFrozen(layout.lines), true);
});

test("el módulo es puro y no depende del navegador", () => {
  const source = readFileSync(resolve(root, "src", "ui", "export-layout.js"), "utf8");
  assert.doesNotMatch(source, /\b(?:document|window|navigator)\b/);
});
