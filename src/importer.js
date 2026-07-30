import {
  importDiff,
  mergeImportedItems,
  normalizeKey,
  normalizeText,
  safeText
} from "./core.js";

const SOURCE = "base-operativa";
const REQUIRED_SHEETS = Object.freeze([
  "dm_ciudad",
  "dm_clientes",
  "dm_sede",
  "dm_directorio_siys"
]);
const OPTIONAL_SHEETS = Object.freeze(["dm_equipo_cronograma"]);
const MONTHS = Object.freeze([
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre"
]);

const SOURCE_FIELDS = Object.freeze({
  cities: ["name", "zone"],
  clients: ["name"],
  sites: [
    "clientId",
    "name",
    "city",
    "zone",
    "shoppingCenter",
    "address",
    "entryConditions",
    "requiresApp",
    "coverageHints"
  ],
  responsibles: [
    "name",
    "company",
    "responsibleType",
    "baseCity",
    "group",
    "heights",
    "courses"
  ]
});

function present(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function cleanLabel(value, maxLength = 240) {
  return safeText(value, maxLength).replace(/\s+/g, " ");
}

function textOrNull(value, maxLength = 5000) {
  const text = safeText(value, maxLength);
  return text || null;
}

function normalizedHeader(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "");
}

function makeWarning(code, message, sheet = null, row = null) {
  return {
    code,
    message: safeText(message, 500),
    ...(sheet ? { sheet } : {}),
    ...(Number.isInteger(row) ? { row } : {})
  };
}

function sourceKey(sheet, rawKey) {
  return `${SOURCE}:${sheet}:${normalizeKey(rawKey)}`;
}

function catalogId(prefix, itemSourceKey) {
  return `${prefix}_${normalizeKey(itemSourceKey)}`;
}

function initialsFor(name) {
  const parts = cleanLabel(name, 240).split(" ").filter(Boolean);
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts.at(-1)[0]}`.toUpperCase();
}

function encodeColumn(index) {
  let value = Number(index) + 1;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function decodeAddress(address) {
  const match = String(address ?? "").replaceAll("$", "").match(/^([A-Z]+)(\d+)$/i);
  if (!match) throw new TypeError(`Referencia de celda inválida: ${address}`);
  let column = 0;
  for (const character of match[1].toUpperCase()) {
    column = column * 26 + character.charCodeAt(0) - 64;
  }
  return { row: Number(match[2]) - 1, column: column - 1 };
}

function decodeRange(reference) {
  const [startReference, endReference = startReference] = String(reference ?? "").split(":");
  const start = decodeAddress(startReference);
  const end = decodeAddress(endReference);
  return { start, end };
}

function cellValue(cell) {
  if (cell && typeof cell === "object" && !Array.isArray(cell)) {
    if (Object.hasOwn(cell, "v")) return cell.v;
    if (Object.hasOwn(cell, "w")) return cell.w;
  }
  return cell ?? null;
}

function worksheetRows(worksheet) {
  if (Array.isArray(worksheet)) return worksheet.map((row) => [...row]);
  if (Array.isArray(worksheet?.__rows)) return worksheet.__rows.map((row) => [...row]);
  if (Array.isArray(worksheet?.rows)) return worksheet.rows.map((row) => [...row]);
  if (!worksheet || !worksheet["!ref"]) return [];

  const { start, end } = decodeRange(worksheet["!ref"]);
  const rows = [];
  for (let row = start.row; row <= end.row; row += 1) {
    const values = [];
    for (let column = start.column; column <= end.column; column += 1) {
      values.push(cellValue(worksheet[`${encodeColumn(column)}${row + 1}`]));
    }
    rows.push(values);
  }
  return rows;
}

function resolveSheet(workbook, expectedName, warnings, optional = false) {
  const sheets = workbook?.Sheets;
  if (!sheets || typeof sheets !== "object") {
    throw new TypeError("El libro no tiene una colección SheetJS Sheets válida.");
  }
  if (sheets[expectedName]) return sheets[expectedName];
  const alternate = Object.keys(sheets).find(
    (name) => normalizeText(name) === normalizeText(expectedName)
  );
  if (alternate) {
    warnings.push(makeWarning(
      "sheet_name_variation",
      `Se usó la hoja ${alternate} como equivalente de ${expectedName}.`,
      alternate
    ));
    return sheets[alternate];
  }
  warnings.push(makeWarning(
    optional ? "optional_sheet_missing" : "required_sheet_missing",
    `No se encontró la hoja ${expectedName}.`,
    expectedName
  ));
  return null;
}

function sheetTable(workbook, name, warnings, optional = false) {
  const worksheet = resolveSheet(workbook, name, warnings, optional);
  const rows = worksheetRows(worksheet);
  if (!rows.length) {
    if (worksheet) {
      warnings.push(makeWarning(
        optional ? "optional_sheet_empty" : "required_sheet_empty",
        `La hoja ${name} está vacía.`,
        name
      ));
    }
    return { headers: [], rows: [] };
  }
  return { headers: rows[0], rows: rows.slice(1) };
}

function headerMap(headers) {
  const result = new Map();
  headers.forEach((header, index) => {
    const key = normalizedHeader(header);
    if (key && !result.has(key)) result.set(key, index);
  });
  return result;
}

function findHeader(headers, aliases) {
  const byName = headerMap(headers);
  for (const alias of aliases) {
    const index = byName.get(normalizedHeader(alias));
    if (index !== undefined) return index;
  }
  return -1;
}

function requireHeaders(sheetName, headers, definitions, warnings) {
  const indexes = {};
  for (const [field, definition] of Object.entries(definitions)) {
    const aliases = Array.isArray(definition) ? definition : definition.aliases;
    const required = Array.isArray(definition) ? true : definition.required !== false;
    indexes[field] = findHeader(headers, aliases);
    if (required && indexes[field] < 0) {
      warnings.push(makeWarning(
        "required_header_missing",
        `Falta el encabezado ${aliases[0]} en ${sheetName}.`,
        sheetName,
        1
      ));
    }
  }
  return indexes;
}

function rowValue(row, index) {
  return index >= 0 ? row[index] : null;
}

function nonEmptyRows(rows) {
  return rows
    .map((row, index) => ({ row, rowNumber: index + 2 }))
    .filter(({ row }) => row.some(present));
}

function pushUnique(items, item, seen, warnings, sheet, rowNumber) {
  if (!item.sourceKey || seen.has(item.sourceKey)) {
    warnings.push(makeWarning(
      "duplicate_source_key",
      `Se omitió una fila con clave de origen duplicada en ${sheet}.`,
      sheet,
      rowNumber
    ));
    return false;
  }
  seen.add(item.sourceKey);
  items.push(item);
  return true;
}

function parseCities(table, warnings) {
  const sheet = "dm_ciudad";
  const indexes = requireHeaders(sheet, table.headers, {
    id: ["id"],
    zone: ["Zona"],
    name: ["Ciudad"]
  }, warnings);
  const items = [];
  const seen = new Set();
  let skipped = 0;
  const sourceRows = nonEmptyRows(table.rows);
  for (const { row, rowNumber } of sourceRows) {
    const name = cleanLabel(rowValue(row, indexes.name), 120);
    if (!name) {
      skipped += 1;
      warnings.push(makeWarning("city_without_name", "Se omitió una ciudad sin nombre.", sheet, rowNumber));
      continue;
    }
    const rawId = cleanLabel(rowValue(row, indexes.id), 120) || name;
    if (!present(rowValue(row, indexes.id))) {
      warnings.push(makeWarning(
        "city_without_id",
        "Una ciudad no tiene id; se usó el nombre como clave auxiliar.",
        sheet,
        rowNumber
      ));
    }
    const itemSourceKey = sourceKey(sheet, rawId);
    const item = {
      id: catalogId("ciudad", itemSourceKey),
      sourceKey: itemSourceKey,
      name,
      zone: cleanLabel(rowValue(row, indexes.zone), 120),
      active: true,
      source: SOURCE
    };
    if (!pushUnique(items, item, seen, warnings, sheet, rowNumber)) skipped += 1;
  }
  return {
    items,
    count: { sourceRows: sourceRows.length, imported: items.length, skipped }
  };
}

function parseClients(table, warnings) {
  const sheet = "dm_clientes";
  const indexes = requireHeaders(sheet, table.headers, {
    id: ["id"],
    name: ["Nombre"]
  }, warnings);
  const items = [];
  const seen = new Set();
  let skipped = 0;
  const sourceRows = nonEmptyRows(table.rows);
  for (const { row, rowNumber } of sourceRows) {
    const name = cleanLabel(rowValue(row, indexes.name), 200);
    if (!name) {
      skipped += 1;
      warnings.push(makeWarning("client_without_name", "Se omitió un cliente sin nombre.", sheet, rowNumber));
      continue;
    }
    const rawId = cleanLabel(rowValue(row, indexes.id), 120) || name;
    if (!present(rowValue(row, indexes.id))) {
      warnings.push(makeWarning(
        "client_without_id",
        "Un cliente no tiene id; se usó el nombre como clave auxiliar.",
        sheet,
        rowNumber
      ));
    }
    const itemSourceKey = sourceKey(sheet, rawId);
    const item = {
      id: catalogId("cliente", itemSourceKey),
      sourceKey: itemSourceKey,
      name,
      active: true,
      source: SOURCE,
      aliases: []
    };
    if (!pushUnique(items, item, seen, warnings, sheet, rowNumber)) skipped += 1;
  }
  return {
    items,
    count: { sourceRows: sourceRows.length, imported: items.length, skipped }
  };
}

function parseRequiresApp(value) {
  const normalized = normalizeText(value);
  if (normalized === "necesita app") return true;
  if (normalized === "no necesita app") return false;
  return null;
}

function resolveRequiresAppColumn(table, warnings) {
  let index = findHeader(table.headers, [
    "requiere app",
    "requisito app",
    "necesita app",
    "app"
  ]);
  if (index >= 0) return index;

  const columnK = 10;
  const headerIsBlank = !present(table.headers[columnK]);
  const recognizedValues = table.rows
    .map((row) => row[columnK])
    .filter(present)
    .filter((value) => parseRequiresApp(value) !== null);
  if (headerIsBlank && recognizedValues.length) {
    index = columnK;
    warnings.push(makeWarning(
      "dm_sede_app_header_blank",
      "K1 está vacío; K se interpretó como requisito de App por sus valores reconocidos.",
      "dm_sede",
      1
    ));
  }
  return index;
}

function parseSites(table, clients, warnings) {
  const sheet = "dm_sede";
  const indexes = requireHeaders(sheet, table.headers, {
    id: ["id"],
    client: ["Cliente"],
    zone: ["Zona"],
    city: ["Ciudad"],
    shoppingCenter: ["Centro comercial"],
    name: ["Nombre"],
    address: { aliases: ["direccion", "dirección"], required: false },
    entryConditions: { aliases: ["ingresos"], required: false }
  }, warnings);
  indexes.requiresApp = resolveRequiresAppColumn(table, warnings);

  const clientsByName = new Map();
  for (const client of clients) {
    const key = normalizeText(client.name);
    const current = clientsByName.get(key) ?? [];
    current.push(client);
    clientsByName.set(key, current);
  }

  const items = [];
  const seen = new Set();
  let skipped = 0;
  const sourceRows = nonEmptyRows(table.rows);
  for (const { row, rowNumber } of sourceRows) {
    const name = cleanLabel(rowValue(row, indexes.name), 240);
    if (!name) {
      skipped += 1;
      warnings.push(makeWarning("site_without_name", "Se omitió una sede sin nombre.", sheet, rowNumber));
      continue;
    }
    const rawId = cleanLabel(rowValue(row, indexes.id), 120) || name;
    const clientName = cleanLabel(rowValue(row, indexes.client), 200);
    const clientCandidates = clientsByName.get(normalizeText(clientName)) ?? [];
    const client = clientCandidates.length === 1 ? clientCandidates[0] : null;
    if (!client) {
      warnings.push(makeWarning(
        clientCandidates.length ? "ambiguous_site_client" : "site_client_not_found",
        clientCandidates.length
          ? "La sede coincide con más de un cliente normalizado."
          : "No se encontró el cliente de una sede.",
        sheet,
        rowNumber
      ));
    }

    const appRaw = rowValue(row, indexes.requiresApp);
    const requiresApp = parseRequiresApp(appRaw);
    if (indexes.requiresApp >= 0 && present(appRaw) && requiresApp === null) {
      warnings.push(makeWarning(
        "unknown_requires_app_value",
        "El requisito de App contiene un valor no reconocido y se conservó como desconocido.",
        sheet,
        rowNumber
      ));
    }

    const city = cleanLabel(rowValue(row, indexes.city), 120);
    const zone = cleanLabel(rowValue(row, indexes.zone), 120);
    const isGeneral = normalizeText(name).endsWith(" general")
      || (normalizeText(city) === "no aplica" && normalizeText(zone) === "no aplica");
    if (isGeneral) {
      warnings.push(makeWarning(
        "general_site_inactive",
        "Una sede general o con ubicación No aplica quedó inactiva por defecto.",
        sheet,
        rowNumber
      ));
    }

    const itemSourceKey = sourceKey(sheet, rawId);
    const item = {
      id: catalogId("sede", itemSourceKey),
      sourceKey: itemSourceKey,
      clientId: client?.id ?? null,
      clientSourceKey: client?.sourceKey ?? null,
      name,
      city,
      zone,
      shoppingCenter: cleanLabel(rowValue(row, indexes.shoppingCenter), 240),
      address: textOrNull(rowValue(row, indexes.address), 500),
      entryConditions: textOrNull(rowValue(row, indexes.entryConditions), 5000),
      requiresApp,
      active: !isGeneral,
      source: SOURCE,
      aliases: [],
      coverageHints: []
    };
    if (!pushUnique(items, item, seen, warnings, sheet, rowNumber)) skipped += 1;
  }
  return {
    items,
    count: { sourceRows: sourceRows.length, imported: items.length, skipped }
  };
}

function responsibleType(value) {
  const normalized = normalizeText(value);
  if (normalized === "nomina") return "payroll";
  if (normalized === "contratista") return "contractor";
  return null;
}

function parseResponsibles(table, warnings) {
  const sheet = "dm_directorio_siys";
  const indexes = requireHeaders(sheet, table.headers, {
    name: ["nombre"],
    company: ["empresa"],
    type: ["tipo"],
    baseCity: ["ciudad base"],
    heights: { aliases: ["alturas"], required: false },
    group: ["grupo"],
    courses: { aliases: ["cursos"], required: false }
  }, warnings);
  const items = [];
  const seen = new Set();
  let skipped = 0;
  const sourceRows = nonEmptyRows(table.rows);
  for (const { row, rowNumber } of sourceRows) {
    const name = cleanLabel(rowValue(row, indexes.name), 240);
    if (!name) {
      skipped += 1;
      const group = cleanLabel(rowValue(row, indexes.group), 160);
      warnings.push(makeWarning(
        normalizeText(group).includes("barranquilla")
          ? "barranquilla_group_without_person"
          : "responsible_without_name",
        normalizeText(group).includes("barranquilla")
          ? "Existe una fila de cobertura Barranquilla sin una persona identificada; no se creó responsable."
          : "Se omitió una fila de directorio sin nombre.",
        sheet,
        rowNumber
      ));
      continue;
    }

    const type = responsibleType(rowValue(row, indexes.type));
    if (!type) {
      skipped += 1;
      warnings.push(makeWarning(
        "unknown_responsible_type",
        "Se omitió una persona porque su tipo no es nómina ni contratista.",
        sheet,
        rowNumber
      ));
      continue;
    }

    const company = cleanLabel(rowValue(row, indexes.company), 240);
    const identity = [name, company, type].map(normalizeText).join("|");
    const itemSourceKey = sourceKey(sheet, identity);
    const item = {
      id: catalogId("responsable", itemSourceKey),
      sourceKey: itemSourceKey,
      name,
      initials: initialsFor(name),
      company,
      responsibleType: type,
      baseCity: cleanLabel(rowValue(row, indexes.baseCity), 120),
      group: cleanLabel(rowValue(row, indexes.group), 160),
      heights: textOrNull(rowValue(row, indexes.heights), 120),
      courses: textOrNull(rowValue(row, indexes.courses), 500),
      active: true,
      coverage: [],
      source: SOURCE,
      aliases: [],
      favorite: false
    };
    if (!pushUnique(items, item, seen, warnings, sheet, rowNumber)) skipped += 1;
  }
  return {
    items,
    count: { sourceRows: sourceRows.length, imported: items.length, skipped }
  };
}

function parseEquipmentHints(table, sites, warnings) {
  if (!table.headers.length) {
    return {
      items: [],
      count: { sourceRows: 0, imported: 0, skipped: 0, hints: 0 }
    };
  }
  const sheet = "dm_equipo_cronograma";
  const indexes = requireHeaders(sheet, table.headers, {
    id: { aliases: ["_id", "id"], required: false },
    subsidiaryId: { aliases: ["subsidiary._id"], required: false },
    subsidiaryName: ["subsidiary.name"],
    responsibleGroup: { aliases: ["responsable ejecucion"], required: false },
    frequency: { aliases: ["Frecuencia"], required: false }
  }, warnings);
  indexes.months = Object.fromEntries(
    MONTHS.map((month) => [month, findHeader(table.headers, [month])])
  );

  const aggregates = new Map();
  let importedRows = 0;
  let skipped = 0;
  const sourceRows = nonEmptyRows(table.rows);
  for (const { row, rowNumber } of sourceRows) {
    const subsidiaryName = cleanLabel(rowValue(row, indexes.subsidiaryName), 240);
    if (!subsidiaryName) {
      skipped += 1;
      warnings.push(makeWarning(
        "equipment_without_subsidiary",
        "Se omitió un equipo sin nombre de subsidiaria.",
        sheet,
        rowNumber
      ));
      continue;
    }
    importedRows += 1;
    const subsidiaryId = cleanLabel(rowValue(row, indexes.subsidiaryId), 160);
    const aggregateKey = subsidiaryId || normalizeText(subsidiaryName);
    let aggregate = aggregates.get(aggregateKey);
    if (!aggregate) {
      aggregate = {
        sourceKey: sourceKey(`${sheet}-subsidiary`, aggregateKey),
        subsidiaryId: subsidiaryId || null,
        subsidiaryName,
        equipmentCount: 0,
        responsibleGroups: new Set(),
        frequencies: new Set(),
        scheduledMonths: new Set()
      };
      aggregates.set(aggregateKey, aggregate);
    }
    aggregate.equipmentCount += 1;
    const group = cleanLabel(rowValue(row, indexes.responsibleGroup), 160);
    const frequency = cleanLabel(rowValue(row, indexes.frequency), 120);
    if (group) aggregate.responsibleGroups.add(group);
    if (frequency) aggregate.frequencies.add(frequency);
    for (const month of MONTHS) {
      if (present(rowValue(row, indexes.months[month]))) aggregate.scheduledMonths.add(month);
    }
  }

  const sitesByName = new Map();
  for (const site of sites) {
    const key = normalizeText(site.name);
    const current = sitesByName.get(key) ?? [];
    current.push(site);
    sitesByName.set(key, current);
  }

  const items = [...aggregates.values()].map((aggregate) => {
    const candidates = sitesByName.get(normalizeText(aggregate.subsidiaryName)) ?? [];
    const match = candidates.length === 1
      ? "exact"
      : candidates.length > 1
        ? "ambiguous"
        : "unmatched";
    if (match !== "exact") {
      warnings.push(makeWarning(
        match === "ambiguous" ? "equipment_site_ambiguous" : "equipment_site_unmatched",
        match === "ambiguous"
          ? "Una subsidiaria de equipos coincide con varias sedes; no se vinculó automáticamente."
          : "Una subsidiaria de equipos no coincide exactamente con una sede; quedó como pista sin vincular.",
        sheet
      ));
    }
    return {
      sourceKey: aggregate.sourceKey,
      subsidiaryId: aggregate.subsidiaryId,
      subsidiaryName: aggregate.subsidiaryName,
      equipmentCount: aggregate.equipmentCount,
      responsibleGroups: [...aggregate.responsibleGroups].sort(),
      frequencies: [...aggregate.frequencies].sort(),
      scheduledMonths: MONTHS.filter((month) => aggregate.scheduledMonths.has(month)),
      candidateSiteSourceKeys: candidates.map((site) => site.sourceKey),
      match
    };
  });

  const hintsBySite = new Map();
  for (const hint of items.filter((item) => item.match === "exact")) {
    const siteKey = hint.candidateSiteSourceKeys[0];
    const current = hintsBySite.get(siteKey) ?? [];
    current.push({
      source: "dm_equipo_cronograma",
      sourceKey: hint.sourceKey,
      subsidiaryId: hint.subsidiaryId,
      subsidiaryName: hint.subsidiaryName,
      equipmentCount: hint.equipmentCount,
      responsibleGroups: hint.responsibleGroups,
      frequencies: hint.frequencies,
      scheduledMonths: hint.scheduledMonths
    });
    hintsBySite.set(siteKey, current);
  }
  for (const site of sites) {
    site.coverageHints = hintsBySite.get(site.sourceKey) ?? [];
  }

  return {
    items,
    count: {
      sourceRows: sourceRows.length,
      imported: importedRows,
      skipped,
      hints: items.length
    }
  };
}

function sanitizeFileMetadata(metadata, warnings) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  const result = {};
  const fileName = cleanLabel(metadata.fileName ?? metadata.name, 260);
  if (fileName) result.fileName = fileName;

  const fileSize = Number(metadata.fileSize ?? metadata.size);
  if (Number.isFinite(fileSize) && fileSize >= 0) result.fileSize = fileSize;

  const lastModified = metadata.lastModified instanceof Date
    ? metadata.lastModified.toISOString()
    : safeText(metadata.lastModified, 80);
  if (lastModified) result.lastModified = lastModified;

  const sha256 = safeText(metadata.sha256, 64).toUpperCase();
  if (/^[A-F0-9]{64}$/.test(sha256)) {
    result.sha256 = sha256;
  } else if (present(metadata.sha256)) {
    warnings.push(makeWarning(
      "invalid_source_hash",
      "El hash SHA-256 suministrado no tiene un formato válido y no se guardó."
    ));
  }
  return result;
}

function validateWorkbook(workbook) {
  if (!workbook || typeof workbook !== "object" || Array.isArray(workbook)) {
    throw new TypeError("Se requiere un workbook SheetJS ya leído.");
  }
}

export function parseBaseWorkbook(workbook, fileMetadata = {}) {
  validateWorkbook(workbook);
  const warnings = [];
  const tables = {};
  for (const sheet of REQUIRED_SHEETS) {
    tables[sheet] = sheetTable(workbook, sheet, warnings, false);
  }
  for (const sheet of OPTIONAL_SHEETS) {
    tables[sheet] = sheetTable(workbook, sheet, warnings, true);
  }

  const cities = parseCities(tables.dm_ciudad, warnings);
  const clients = parseClients(tables.dm_clientes, warnings);
  const sites = parseSites(tables.dm_sede, clients.items, warnings);
  const responsibles = parseResponsibles(tables.dm_directorio_siys, warnings);
  const equipmentHints = parseEquipmentHints(
    tables.dm_equipo_cronograma,
    sites.items,
    warnings
  );

  return {
    source: SOURCE,
    fileMetadata: sanitizeFileMetadata(fileMetadata, warnings),
    catalog: {
      cities: cities.items,
      clients: clients.items,
      sites: sites.items,
      responsibles: responsibles.items
    },
    equipmentHints: equipmentHints.items,
    sheetCounts: {
      dm_ciudad: cities.count,
      dm_clientes: clients.count,
      dm_sede: sites.count,
      dm_directorio_siys: responsibles.count,
      dm_equipo_cronograma: equipmentHints.count
    },
    warnings
  };
}

function catalogArray(document, kind) {
  return Array.isArray(document?.catalog?.[kind]) ? document.catalog[kind] : [];
}

function resolveIncomingCatalog(document, parsed) {
  const existingClients = catalogArray(document, "clients");
  const clientIdBySourceKey = new Map(
    existingClients
      .filter((item) => item?.sourceKey && item?.id)
      .map((item) => [item.sourceKey, item.id])
  );
  for (const client of parsed.catalog.clients ?? []) {
    if (!clientIdBySourceKey.has(client.sourceKey)) {
      clientIdBySourceKey.set(client.sourceKey, client.id);
    }
  }
  const sites = (parsed.catalog.sites ?? []).map((site) => {
    const { clientSourceKey, ...allowed } = site;
    return {
      ...allowed,
      clientId: clientIdBySourceKey.get(clientSourceKey) ?? site.clientId ?? null
    };
  });
  return {
    cities: parsed.catalog.cities ?? [],
    clients: parsed.catalog.clients ?? [],
    sites,
    responsibles: parsed.catalog.responsibles ?? []
  };
}

function summarizeDiff(diff) {
  return {
    new: diff.newItems.length,
    updated: diff.updated.length,
    unchanged: diff.unchanged.length,
    missing: diff.missing.length
  };
}

export function buildImportPreview(document, parsed) {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new TypeError("Se requiere un documento de calendario válido.");
  }
  if (!parsed?.catalog || parsed.source !== SOURCE) {
    throw new TypeError("Se requiere una importación analizada de la Base Operativa.");
  }
  const incoming = resolveIncomingCatalog(document, parsed);
  const diffs = {};
  const catalogs = {};
  for (const kind of Object.keys(SOURCE_FIELDS)) {
    diffs[kind] = importDiff(
      catalogArray(document, kind),
      incoming[kind],
      SOURCE_FIELDS[kind]
    );
    catalogs[kind] = summarizeDiff(diffs[kind]);
  }
  const equipmentHints = {
    total: parsed.equipmentHints?.length ?? 0,
    exact: parsed.equipmentHints?.filter((item) => item.match === "exact").length ?? 0,
    ambiguous: parsed.equipmentHints?.filter((item) => item.match === "ambiguous").length ?? 0,
    unmatched: parsed.equipmentHints?.filter((item) => item.match === "unmatched").length ?? 0
  };
  const hasChanges = Object.values(catalogs).some(
    (summary) => summary.new > 0 || summary.updated > 0 || summary.missing > 0
  );
  return {
    catalogs,
    diffs,
    equipmentHints,
    sheetCounts: parsed.sheetCounts,
    warnings: parsed.warnings ?? [],
    hasChanges
  };
}

function cloneCatalogItems(items) {
  return items.map((item) => ({ ...item }));
}

function mergeKind(existing, incoming, fields) {
  return mergeImportedItems(
    cloneCatalogItems(existing),
    incoming.map((item) => ({ ...item })),
    fields
  );
}

function normalizeNow(now) {
  if (now instanceof Date) return now.toISOString();
  const value = safeText(now, 80);
  if (!value) throw new TypeError("La fecha de importación no es válida.");
  return value;
}

function metadataWarnings(warnings) {
  return (warnings ?? []).map((warning) => ({
    code: safeText(warning?.code, 80),
    message: safeText(warning?.message, 500),
    ...(warning?.sheet ? { sheet: safeText(warning.sheet, 80) } : {}),
    ...(Number.isInteger(warning?.row) ? { row: warning.row } : {})
  }));
}

export function applyParsedImport(document, parsed, now = new Date().toISOString()) {
  const preview = buildImportPreview(document, parsed);
  const importedAt = normalizeNow(now);
  const incoming = resolveIncomingCatalog(document, parsed);

  const clients = mergeKind(
    catalogArray(document, "clients"),
    incoming.clients,
    SOURCE_FIELDS.clients
  );
  const clientIdBySourceKey = new Map(
    clients
      .filter((item) => item?.sourceKey && item?.id)
      .map((item) => [item.sourceKey, item.id])
  );
  const sites = incoming.sites.map((site) => ({
    ...site,
    clientId: clientIdBySourceKey.get(
      parsed.catalog.sites.find((item) => item.sourceKey === site.sourceKey)?.clientSourceKey
    ) ?? site.clientId
  }));

  const catalog = {
    ...(document.catalog ?? {}),
    cities: mergeKind(
      catalogArray(document, "cities"),
      incoming.cities,
      SOURCE_FIELDS.cities
    ),
    clients,
    sites: mergeKind(
      catalogArray(document, "sites"),
      sites,
      SOURCE_FIELDS.sites
    ),
    responsibles: mergeKind(
      catalogArray(document, "responsibles"),
      incoming.responsibles,
      SOURCE_FIELDS.responsibles
    )
  };

  const changeCount = Object.values(preview.catalogs)
    .reduce((sum, item) => sum + item.new + item.updated, 0);
  const warnings = metadataWarnings(parsed.warnings);
  const previousAudit = Array.isArray(document.audit) ? document.audit.slice(-499) : [];

  return {
    ...document,
    catalog,
    importMetadata: {
      ...parsed.fileMetadata,
      importedAt,
      sheetCounts: parsed.sheetCounts,
      warnings
    },
    audit: [
      ...previousAudit,
      {
        at: importedAt,
        action: "base_operativa_imported",
        detail: `Importación aplicada: ${changeCount} registros nuevos o actualizados; ${warnings.length} advertencias.`
      }
    ]
  };
}
