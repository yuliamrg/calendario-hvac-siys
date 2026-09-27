import { CloudCliError } from "./cloud-errors.js";
import { createSupabaseRestClient } from "./cloud-rest.js";
import { supabaseConfigFromEnv } from "./cloud-auth.js";

const DEFAULT_OPERATION = "escribir documento cloud";
const DEFAULT_SCHEMA_VERSION = 4;

function safeCalendarId(value) {
  const id = String(value ?? "").trim();
  if (!id || id.length > 128 || !/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new CloudCliError("INVALID_REQUEST", "calendarId debe ser un identificador seguro (normalmente UUID).");
  }
  return id;
}

function safeExpectedRevision(value) {
  if (value === null || value === undefined || value === "") {
    throw new CloudCliError("REMOTE_INVALID", "La revisión cloud esperada es inválida; no se puede aplicar concurrencia optimista.");
  }
  const revision = Number(value);
  if (!Number.isInteger(revision) || revision < 0) {
    throw new CloudCliError("REMOTE_INVALID", "La revisión cloud esperada es inválida; no se puede aplicar concurrencia optimista.");
  }
  return revision;
}

function safeDocument(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CloudCliError("INVALID_REQUEST", "El documento cloud debe ser un objeto JSON válido.");
  }
  return value;
}

function normalizeRevision(value) {
  if (value === undefined || value === null || value === "") return null;
  return Number.isInteger(Number(value)) ? Number(value) : null;
}

export function createCloudCalendarWriter(config, {
  auth,
  fetchImpl,
  timeoutMs
} = {}) {
  const normalized = config ?? supabaseConfigFromEnv();
  const rest = createSupabaseRestClient(normalized, { auth, fetchImpl, timeoutMs });

  async function writeDocument({ calendarId, expectedRevision, document, operation = DEFAULT_OPERATION } = {}) {
    const id = safeCalendarId(calendarId);
    const currentRevision = safeExpectedRevision(expectedRevision);
    const nextDocument = safeDocument(document);
    const nextRevision = currentRevision + 1;
    const path = `/rest/v1/calendar_documents?calendar_id=eq.${encodeURIComponent(id)}&revision=eq.${currentRevision}&select=document,revision,updated_at,updated_by`;
    const payload = await rest.request(path, {
      method: "PATCH",
      body: {
        document: nextDocument,
        revision: nextRevision,
        schema_version: Number(nextDocument?.schemaVersion) || DEFAULT_SCHEMA_VERSION
      },
      headers: { Prefer: "return=representation" },
      operation
    });
    if (!Array.isArray(payload)) {
      throw new CloudCliError("REMOTE_INVALID", `Supabase no devolvió una lista durante ${operation}.`);
    }
    if (payload.length === 0) {
      throw new CloudCliError("CONFLICT", "El documento cloud cambió en el servidor; la revisión esperada ya no es la actual.", {
        details: { operation, calendarId: id, expectedRevision: currentRevision }
      });
    }
    if (payload.length > 1) {
      throw new CloudCliError("REMOTE_INVALID", "Supabase devolvió más de una fila al escribir el documento cloud.");
    }
    const record = payload[0];
    const returnedRevision = normalizeRevision(record?.revision);
    if (returnedRevision !== nextRevision) {
      throw new CloudCliError("REMOTE_INVALID", "La revisión devuelta por Supabase no coincide con la esperada tras la escritura.", {
        details: { operation, expectedRevision: nextRevision, returnedRevision }
      });
    }
    return Object.freeze({
      calendarId: id,
      revision: returnedRevision,
      updatedAt: record?.updated_at ?? null,
      updatedBy: record?.updated_by ?? null
    });
  }

  return Object.freeze({ writeDocument });
}
