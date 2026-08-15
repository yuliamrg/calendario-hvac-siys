import { createHash } from "node:crypto";

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

export function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

export function documentHash(document) {
  return createHash("sha256").update(stableStringify(document), "utf8").digest("hex");
}

export function documentRevision(document) {
  const revision = document?.calendarMeta?.revision;
  if (revision === undefined || revision === null || revision === "") return null;
  return Number.isInteger(Number(revision)) && Number(revision) >= 0 ? Number(revision) : null;
}

export function fileSourceMetadata(document, envelope = {}, observedAt = new Date().toISOString()) {
  return {
    kind: "file",
    channel: envelope.channel ?? null,
    calendarId: document?.calendarMeta?.id ?? null,
    legacyId: null,
    calendarName: document?.calendarMeta?.name ?? null,
    createdBy: null,
    ownerName: null,
    cloudRevision: null,
    documentRevision: documentRevision(document),
    documentUpdatedAt: document?.calendarMeta?.updatedAt ?? null,
    observedAt,
    documentHash: documentHash(document),
    warnings: []
  };
}
