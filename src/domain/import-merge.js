export function importDiff(existing, incoming, fields) {
  const seenIncomingKeys = new Set();
  for (const item of incoming) {
    if (!item.sourceKey || seenIncomingKeys.has(item.sourceKey)) {
      throw new TypeError("La importación contiene claves de origen vacías o duplicadas.");
    }
    seenIncomingKeys.add(item.sourceKey);
  }
  const existingByKey = new Map(
    existing.filter((item) => item.sourceKey).map((item) => [item.sourceKey, item])
  );
  const incomingKeys = new Set();
  const result = { newItems: [], updated: [], unchanged: [], missing: [] };
  for (const item of incoming) {
    incomingKeys.add(item.sourceKey);
    const current = existingByKey.get(item.sourceKey);
    if (!current) {
      result.newItems.push(item);
      continue;
    }
    const changedFields = fields.filter(
      (field) => JSON.stringify(current[field] ?? null) !== JSON.stringify(item[field] ?? null)
    );
    if (changedFields.length) result.updated.push({ current, incoming: item, changedFields });
    else result.unchanged.push(current);
  }
  result.missing = existing.filter(
    (item) => item.source === "base-operativa" && !incomingKeys.has(item.sourceKey)
  );
  return result;
}

export function mergeImportedItems(existing, incoming, sourceFields, preservedFields = []) {
  const byKey = new Map(
    existing.filter((item) => item.sourceKey).map((item) => [item.sourceKey, item])
  );
  const merged = [...existing];
  for (const item of incoming) {
    const current = byKey.get(item.sourceKey);
    if (!current) {
      merged.push(item);
      byKey.set(item.sourceKey, item);
      continue;
    }
    for (const field of sourceFields) current[field] = item[field];
    for (const field of preservedFields) {
      if (current[field] === undefined && item[field] !== undefined) current[field] = item[field];
    }
  }
  return merged;
}
