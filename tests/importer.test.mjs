import test from "node:test";
import assert from "node:assert/strict";

import { createDefaultDocument } from "../src/core.js";
import {
  applyProgrammingImport,
  applyParsedImport,
  buildImportPreview,
  parseBaseWorkbook,
  parseProgrammingWorkbook
} from "../src/importer.js";

function encodeColumn(index) {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function makeSheet(rows) {
  const width = Math.max(...rows.map((row) => row.length));
  const sheet = {
    "!ref": `A1:${encodeColumn(width - 1)}${rows.length}`
  };
  rows.forEach((row, rowIndex) => {
    row.forEach((value, columnIndex) => {
      if (value === undefined || value === null) return;
      sheet[`${encodeColumn(columnIndex)}${rowIndex + 1}`] =
        value && typeof value === "object" && Object.hasOwn(value, "v")
          ? value
          : { v: value };
    });
  });
  return sheet;
}

function syntheticWorkbook() {
  const sheets = {
    dm_ciudad: makeSheet([
      ["id", "Zona", "Ciudad"],
      [1, "Centro", "Cota"],
      [2, "Antioquía", "Medellin"],
      [3, "Eje cafetero", "Armenia"]
    ]),
    dm_clientes: makeSheet([
      ["id", "Nombre"],
      [1, "Coopidrogas "],
      [2, "Homecenter"]
    ]),
    dm_sede: makeSheet([
      [
        "id",
        "Cliente",
        "Zona",
        "Ciudad",
        "Centro comercial",
        "Nombre",
        "observaciones",
        "Contactos",
        "direccion",
        "ingresos",
        null
      ],
      [
        1,
        "Coopidrogas ",
        { v: "Centro", f: "=XLOOKUP(...)" },
        "Cota",
        "No aplica",
        { v: "Coopidrogas  Cota", f: "=CONCATENATE(...)" },
        null,
        { v: 0, f: "=COUNTIF(...)" },
        "Autopista Medellín km 1",
        "Solicitar ingreso",
        "necesita app"
      ],
      [
        2,
        "Homecenter",
        "No aplica",
        "No aplica",
        "No aplica",
        "Homecenter general",
        null,
        0,
        null,
        null,
        null
      ],
      [
        3,
        "Homecenter",
        "Eje cafetero",
        "Armenia",
        "No aplica",
        "Homecenter Armenia",
        null,
        1,
        null,
        "no aplica",
        "no necesita app"
      ]
    ]),
    dm_directorio_siys: makeSheet([
      [
        "cedula_nit",
        "nombre",
        "empresa",
        "cargo",
        "tipo",
        "ciudad base",
        "alturas",
        "grupo",
        "Correo",
        "contacto",
        "cursos",
        "observaciones"
      ],
      [
        "111111111",
        "Ana   Nómina",
        "SIYS",
        "Técnica",
        "nomina",
        "Armenia",
        "si",
        "siys pereira",
        "ana@example.invalid",
        "3000000000",
        "coordinador de alturas",
        null
      ],
      [
        "900000000",
        "Carlos Contratista",
        "Proveedor Uno",
        "Técnico",
        "contratista",
        "Medellín",
        null,
        "siys medellín",
        "carlos@example.invalid",
        "3111111111",
        null,
        "nota privada que tampoco se importa"
      ],
      [null, null, null, null, "contratista", "barranquilla", null, "siys barranquilla"]
    ]),
    dm_equipo_cronograma: makeSheet([
      [
        "_id",
        "subsidiary._id",
        "subsidiary.name",
        "responsable ejecucion",
        "Frecuencia",
        "Enero",
        "Febrero",
        "created_by",
        "photos"
      ],
      [
        "eq-1",
        "site-home-armenia",
        "Homecenter Armenia",
        "siys pereira",
        "Trimestral",
        "X",
        null,
        "internal-user-id",
        "secret-photo-path"
      ],
      [
        "eq-2",
        "site-bello",
        "Sede Bello",
        null,
        null,
        null,
        "X",
        "another-user-id",
        "another-secret-photo"
      ]
    ])
  };
  return { SheetNames: Object.keys(sheets), Sheets: sheets };
}

test("parseBaseWorkbook aplica lista blanca, normaliza y conserva desconocidos como null", () => {
  const parsed = parseBaseWorkbook(syntheticWorkbook(), {
    fileName: "Base_operativa_HVAC_SIYS.xlsx",
    fileSize: 157264,
    lastModified: "2026-07-28T19:33:26.000Z",
    sha256: "A".repeat(64),
    path: "C:\\ruta\\que-no-debe-guardarse\\base.xlsx",
    ownerEmail: "sensible@example.invalid"
  });

  assert.deepEqual(
    parsed.catalog.clients.map((item) => item.name),
    ["Coopidrogas", "Homecenter"]
  );
  assert.equal(parsed.catalog.sites[0].name, "Coopidrogas Cota");
  assert.equal(parsed.catalog.sites[0].requiresApp, true);
  assert.equal(parsed.catalog.sites[1].requiresApp, null);
  assert.equal(parsed.catalog.sites[1].active, false);
  assert.equal(parsed.catalog.sites[2].requiresApp, false);
  assert.equal(parsed.catalog.sites[0].clientSourceKey, parsed.catalog.clients[0].sourceKey);

  assert.equal(parsed.catalog.responsibles.length, 2);
  assert.equal(parsed.catalog.responsibles[0].responsibleType, "payroll");
  assert.equal(parsed.catalog.responsibles[0].name, "Ana Nómina");
  assert.equal(parsed.catalog.responsibles[1].responsibleType, "contractor");
  assert.equal(parsed.catalog.responsibles[0].initials, "AN");

  assert.equal(parsed.equipmentHints.length, 2);
  assert.equal(parsed.equipmentHints[0].match, "exact");
  assert.equal(parsed.equipmentHints[0].equipmentCount, 1);
  assert.deepEqual(parsed.equipmentHints[0].responsibleGroups, ["siys pereira"]);
  assert.equal(parsed.equipmentHints[1].match, "unmatched");
  assert.equal(parsed.catalog.sites[2].coverageHints.length, 1);
  assert.equal(parsed.catalog.sites[2].coverageHints[0].equipmentCount, 1);
  assert.equal(Object.hasOwn(parsed.catalog.sites[2], "responsibleIds"), false);

  assert.ok(parsed.warnings.some((item) => item.code === "dm_sede_app_header_blank"));
  assert.ok(parsed.warnings.some((item) => item.code === "barranquilla_group_without_person"));
  assert.ok(parsed.warnings.some((item) => item.code === "equipment_site_unmatched"));

  assert.equal(parsed.fileMetadata.fileName, "Base_operativa_HVAC_SIYS.xlsx");
  assert.equal(parsed.fileMetadata.sha256, "A".repeat(64));
  assert.equal(Object.hasOwn(parsed.fileMetadata, "path"), false);
  assert.equal(Object.hasOwn(parsed.fileMetadata, "ownerEmail"), false);

  const serialized = JSON.stringify(parsed);
  for (const forbidden of [
    "111111111",
    "900000000",
    "ana@example.invalid",
    "carlos@example.invalid",
    "3000000000",
    "3111111111",
    "nota privada que tampoco se importa",
    "internal-user-id",
    "secret-photo-path",
    "another-secret-photo",
    "ruta\\\\que-no-debe-guardarse",
    "sensible@example.invalid",
    "cedula_nit",
    "\"Correo\"",
    "\"contacto\""
  ]) {
    assert.equal(serialized.includes(forbidden), false, `No debe persistir ${forbidden}`);
  }
});

test("buildImportPreview clasifica cambios y faltantes sin confundir overrides", () => {
  const parsed = parseBaseWorkbook(syntheticWorkbook());
  const document = createDefaultDocument("2026-07-30");
  const incomingHomecenter = parsed.catalog.clients.find((item) => item.name === "Homecenter");
  document.catalog.clients.push(
    {
      ...incomingHomecenter,
      id: "cliente_local_homecenter",
      name: "Homecenter anterior",
      active: false,
      aliases: ["HC"],
      color: "#123456"
    },
    {
      id: "cliente_faltante",
      sourceKey: "base-operativa:dm_clientes:999",
      name: "Cliente ausente en fuente",
      active: true,
      source: "base-operativa"
    }
  );
  document.catalog.clients.push({
    id: "cliente_manual",
    name: "Cliente manual",
    active: true,
    source: "manual"
  });

  const preview = buildImportPreview(document, parsed);
  assert.deepEqual(preview.catalogs.clients, {
    new: 1,
    updated: 1,
    unchanged: 0,
    missing: 1
  });
  assert.equal(preview.diffs.clients.updated[0].changedFields.includes("name"), true);
  assert.equal(preview.diffs.clients.updated[0].changedFields.includes("active"), false);
  assert.equal(preview.equipmentHints.exact, 1);
  assert.equal(preview.equipmentHints.unmatched, 1);
  assert.equal(preview.hasChanges, true);
});

test("applyParsedImport mezcla sin borrar y preserva ajustes e ids locales", () => {
  const parsed = parseBaseWorkbook(syntheticWorkbook(), {
    fileName: "Base_operativa_HVAC_SIYS.xlsx",
    sha256: "B".repeat(64)
  });
  const document = createDefaultDocument("2026-07-30");
  const homecenter = parsed.catalog.clients.find((item) => item.name === "Homecenter");
  const responsible = parsed.catalog.responsibles[0];

  document.catalog.clients.push(
    {
      ...homecenter,
      id: "cliente_local_homecenter",
      name: "Homecenter anterior",
      active: false,
      aliases: ["HC"],
      color: "#123456"
    },
    {
      id: "cliente_faltante",
      sourceKey: "base-operativa:dm_clientes:999",
      name: "Cliente ausente en fuente",
      active: true,
      source: "base-operativa"
    }
  );
  document.catalog.responsibles.push({
    ...responsible,
    id: "responsable_local",
    group: "grupo anterior",
    initials: "XX",
    active: false,
    aliases: ["Alias local"],
    coverage: ["Manizales"],
    favorite: true,
    color: "#abcdef"
  });

  const applied = applyParsedImport(document, parsed, "2026-07-30T15:00:00.000Z");
  const mergedHomecenter = applied.catalog.clients.find(
    (item) => item.sourceKey === homecenter.sourceKey
  );
  assert.equal(mergedHomecenter.id, "cliente_local_homecenter");
  assert.equal(mergedHomecenter.name, "Homecenter");
  assert.equal(mergedHomecenter.active, false);
  assert.deepEqual(mergedHomecenter.aliases, ["HC"]);
  assert.equal(mergedHomecenter.color, "#123456");
  assert.equal(mergedHomecenter.updatedAt, "2026-07-30T15:00:00.000Z");
  assert.ok(applied.catalog.clients.some((item) => item.id === "cliente_faltante"));

  const homecenterSites = applied.catalog.sites.filter(
    (item) => item.clientId === "cliente_local_homecenter"
  );
  assert.equal(homecenterSites.length, 2);

  const mergedResponsible = applied.catalog.responsibles.find(
    (item) => item.sourceKey === responsible.sourceKey
  );
  assert.equal(mergedResponsible.id, "responsable_local");
  assert.equal(mergedResponsible.group, "siys pereira");
  assert.equal(mergedResponsible.initials, "XX");
  assert.equal(mergedResponsible.active, false);
  assert.deepEqual(mergedResponsible.aliases, ["Alias local"]);
  assert.deepEqual(mergedResponsible.coverage, ["Manizales"]);
  assert.equal(mergedResponsible.favorite, true);
  assert.equal(mergedResponsible.color, "#abcdef");
  assert.equal(mergedResponsible.updatedAt, "2026-07-30T15:00:00.000Z");

  assert.equal(document.catalog.clients[0].name, "Homecenter anterior");
  assert.equal(document.catalog.responsibles[0].group, "grupo anterior");
  assert.equal(applied.importMetadata.importedAt, "2026-07-30T15:00:00.000Z");
  assert.equal(applied.importMetadata.sha256, "B".repeat(64));
  assert.equal(applied.audit.at(-1).action, "base_operativa_imported");
});

function programmingDocument() {
  const document = createDefaultDocument("2026-07-30");
  document.catalog.clients.push({ id: "c1", name: "Cliente Uno", active: true });
  document.catalog.sites.push({ id: "s1", clientId: "c1", name: "Sede Centro", city: "Pereira", active: true });
  document.catalog.responsibles.push(
    { id: "r1", name: "Ana Nómina", responsibleType: "payroll", active: true },
    { id: "r2", name: "Carlos Contratista", responsibleType: "contractor", active: true }
  );
  return document;
}

function programmingWorkbook(rows) {
  return {
    SheetNames: ["Programacion"],
    Sheets: {
      Programacion: makeSheet([
        [
          "FechaInicio", "FechaFin", "Cliente", "Sede", "Ciudad", "Responsables",
          "TipoServicio", "Estado", "Observaciones", "IncluirNoLaborables"
        ],
        ...rows
      ])
    }
  };
}

test("la plantilla de programación valida filas operativas, administrativas y rangos", () => {
  const preview = parseProgrammingWorkbook(programmingWorkbook([
    [
      "2026-07-09", "2026-07-14", "Cliente Uno", "Sede Centro", "",
      "Ana Nómina; Carlos Contratista", "Mantenimiento preventivo", "Confirmada",
      "Rango preventivo", "No"
    ],
    [
      "2026-07-30", "", "", "", "", "", "Administrativo", "Programada",
      "Reunión interna", "No"
    ]
  ]), programmingDocument());
  assert.equal(preview.structuralErrors.length, 0);
  assert.equal(preview.counts.valid, 2);
  assert.equal(preview.counts.errors, 0);
  assert.equal(preview.rows[0].dates.length, 4);
  assert.equal(preview.rows[0].omitted.length, 2);
  assert.deepEqual(preview.rows[0].input.responsibleIds, ["r1", "r2"]);

  let counter = 0;
  const applied = applyProgrammingImport(programmingDocument(), preview, {
    now: "2026-07-30T12:00:00.000Z",
    idFactory: () => `id${++counter}`
  });
  assert.equal(applied.activities.length, 5);
  assert.equal(applied.document.series.length, 1);
  assert.equal(applied.document.audit.at(-1).action, "programming_imported");
});

test("la importación reporta faltantes, ambigüedad, duplicados y errores estructurales", () => {
  const document = programmingDocument();
  document.catalog.responsibles.push({
    id: "r3", name: "Ana Nómina", responsibleType: "contractor", active: true
  });
  const preview = parseProgrammingWorkbook(programmingWorkbook([
    [
      "2026-07-30", "", "Cliente Uno", "Sede Centro", "Pereira", "Ana Nómina",
      "Mantenimiento preventivo", "Confirmada", "Ambigua", "No"
    ],
    [
      "2026-07-31", "", "Cliente inexistente", "Sede Centro", "Pereira", "",
      "Mantenimiento preventivo", "Programada", "Faltante", "No"
    ]
  ]), document);
  assert.equal(preview.counts.errors, 2);
  assert.match(preview.rows[0].errors.join(" "), /ambiguo/i);
  assert.match(preview.rows[1].errors.join(" "), /no existe/i);

  const broken = {
    SheetNames: ["Programacion"],
    Sheets: { Programacion: makeSheet([["FechaInicio"], ["2026-07-30"]]) }
  };
  const structural = parseProgrammingWorkbook(broken, document);
  assert.ok(structural.structuralErrors.length >= 1);
  assert.throws(() => applyProgrammingImport(document, structural), /Falta la columna/);
});

test("los duplicados se omiten por defecto y pueden incluirse explícitamente", () => {
  const document = programmingDocument();
  const workbook = programmingWorkbook([
    [
      "2026-07-30", "", "Cliente Uno", "Sede Centro", "Pereira", "Ana Nómina",
      "Mantenimiento preventivo", "Programada", "Duplicada", "No"
    ],
    [
      "2026-07-30", "", "Cliente Uno", "Sede Centro", "Pereira", "Ana Nómina",
      "Mantenimiento preventivo", "Programada", "Duplicada", "No"
    ]
  ]);
  const preview = parseProgrammingWorkbook(workbook, document);
  assert.equal(preview.counts.valid, 1);
  assert.equal(preview.counts.duplicates, 1);
  let counter = 0;
  const applied = applyProgrammingImport(document, preview, {
    idFactory: () => `dup${++counter}`,
    includeDuplicates: false
  });
  assert.equal(applied.activities.length, 1);
  const included = applyProgrammingImport(document, preview, {
    idFactory: () => `all${++counter}`,
    includeDuplicates: true
  });
  assert.equal(included.activities.length, 2);
});
