import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = resolve(root, "supabase", "migrations");
const MIGRATION_FILE = "20260927120000_atomic_calendar_document_write.sql";
const migrationPath = resolve(migrationsDir, MIGRATION_FILE);

// Comments describe intent; the assertions must hold for the executable SQL.
const stripComments = (sql) => sql.replace(/--[^\n]*/g, "");
const sql = stripComments(readFileSync(migrationPath, "utf8"));
const withoutWhitespace = sql.replace(/\s+/g, " ");

test("la migración atómica es la más reciente y crea la función de persistencia", () => {
  const files = readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();
  assert.equal(files.at(-1), MIGRATION_FILE, "la migración atómica debe ser la última");
  assert.match(withoutWhitespace, /create or replace function public\.persist_calendar_document\s*\(/i);
});

test("la firma sólo acepta el calendario, la revisión esperada, el documento y su esquema", () => {
  const signature = withoutWhitespace.match(
    /create or replace function public\.persist_calendar_document\s*\(([\s\S]*?)\)\s*returns table/i
  );
  assert.ok(signature, "debe existir la función con retorno table");
  const parameters = signature[1];
  assert.match(parameters, /target_calendar_id\s+uuid/i);
  assert.match(parameters, /expected_revision\s+bigint/i);
  assert.match(parameters, /next_document\s+jsonb/i);
  assert.match(parameters, /next_schema_version\s+integer/i);
  // No client-supplied identity parameter is allowed.
  assert.doesNotMatch(parameters, /user|actor|created_by|requested_by/i);
  assert.match(withoutWhitespace, /returns table\s*\(\s*revision\s+bigint\s*,\s*updated_at\s+timestamptz\s*,\s*updated_by\s+uuid\s*\)/i);
});

test("la función deriva la identidad de auth.uid() y jamás del cliente", () => {
  assert.match(withoutWhitespace, /current_user_id\s+uuid\s*:=\s*auth\.uid\(\)/i);
  assert.match(withoutWhitespace, /if current_user_id is null then/i);
  assert.match(withoutWhitespace, /using errcode = '42501'/);
});

test("la función exige owner del calendario objetivo con has_calendar_role", () => {
  assert.match(
    withoutWhitespace,
    /not public\.has_calendar_role\(\s*target_calendar_id\s*,\s*array\['owner'\]\s*\)/i
  );
  assert.doesNotMatch(withoutWhitespace, /array\['owner',\s*'editor'\]/i);
});

test("la validación server-side falla cerrado para entradas inválidas", () => {
  assert.match(withoutWhitespace, /target_calendar_id is null/i);
  assert.match(withoutWhitespace, /expected_revision is not null and expected_revision < 0/i);
  assert.match(withoutWhitespace, /jsonb_typeof\(\s*next_document\s*\)\s*<>\s*'object'/i);
  assert.match(withoutWhitespace, /next_schema_version is null or next_schema_version < 1/i);
  assert.match(withoutWhitespace, /derived_name = ''/i);
});

test("el CAS se hace con predicado de revisión y next_revision = expected + 1", () => {
  const update = withoutWhitespace.match(
    /update public\.calendar_documents[\s\S]*?returning document_row\.\* into persisted/i
  );
  assert.ok(update, "debe existir el UPDATE de calendar_documents");
  assert.match(update[0], /set document = next_document/i);
  assert.match(update[0], /revision = expected_revision \+ 1/i);
  assert.match(update[0], /schema_version = next_schema_version/i);
  assert.match(update[0], /where document_row\.calendar_id = target_calendar_id/i);
  assert.match(update[0], /and document_row\.revision = expected_revision/i);
  assert.doesNotMatch(update[0], /limit 1/i);
});

test("cero filas del CAS señalizan conflicto sin retry", () => {
  assert.match(withoutWhitespace, /if persisted\.calendar_id is null then[\s\S]*?return;/i);
  assert.doesNotMatch(withoutWhitespace, /loop|perform public\.persist_calendar_document/i);
});

test("la creación inicial se soporta cuando expected_revision es null", () => {
  assert.match(withoutWhitespace, /if expected_revision is null then/i);
  assert.match(withoutWhitespace, /insert into public\.calendar_documents as document_row/i);
  assert.match(withoutWhitespace, /on conflict \(calendar_id\) do nothing/i);
});

test("la sincronización de metadata ocurre después del CAS y actualiza name y coordinator", () => {
  const documentsUpdate = withoutWhitespace.indexOf("update public.calendar_documents");
  const calendarsUpdate = withoutWhitespace.indexOf("update public.calendars");
  assert.ok(documentsUpdate !== -1 && calendarsUpdate !== -1);
  assert.ok(
    calendarsUpdate > documentsUpdate,
    "calendars debe actualizarse sólo después del CAS del documento"
  );

  const metadata = withoutWhitespace.match(/update public\.calendars[\s\S]*?where calendar_row\.id = target_calendar_id/i);
  assert.ok(metadata, "debe existir el UPDATE de calendars");
  assert.match(metadata[0], /set name = derived_name/i);
  assert.match(metadata[0], /coordinator = derived_coordinator/i);

  assert.match(withoutWhitespace, /next_document -> 'calendarMeta' ->> 'name'/i);
  assert.match(withoutWhitespace, /next_document -> 'calendarMeta' ->> 'coordinator'/i);
});

test("la actualización de metadata falla cerrado y obliga al rollback", () => {
  const calendarsUpdate = withoutWhitespace.indexOf("update public.calendars");
  const failClosed = withoutWhitespace.slice(calendarsUpdate);
  assert.match(failClosed, /if not found then/i);
  assert.match(failClosed, /raise exception 'El calendario no existe\.' using errcode = 'P0002'/i);
});

test("SECURITY DEFINER usa search_path seguro", () => {
  assert.match(withoutWhitespace, /security definer/i);
  assert.match(withoutWhitespace, /set search_path = public, pg_temp/i);
});

test("los privilegios sólo conceden ejecución a authenticated y jamás service_role", () => {
  const signature = "\\(uuid, bigint, jsonb, integer\\)";
  assert.match(
    withoutWhitespace,
    new RegExp(`revoke all on function public\\.persist_calendar_document${signature} from public`, "i")
  );
  assert.match(
    withoutWhitespace,
    new RegExp(`revoke execute on function public\\.persist_calendar_document${signature} from anon`, "i")
  );
  assert.match(
    withoutWhitespace,
    new RegExp(`grant execute on function public\\.persist_calendar_document${signature} to authenticated`, "i")
  );
  assert.doesNotMatch(withoutWhitespace, /service_role/i);
  const grants = withoutWhitespace.match(/\bgrant\b[^;]*;/gi) ?? [];
  assert.equal(grants.length, 1, "sólo debe existir un GRANT");
  assert.match(grants[0], /to authenticated\s*;?$/i);
  assert.doesNotMatch(withoutWhitespace, /\bgrant\b[^;]*to (public|anon)\b/i);
});

test("la migración no altera las políticas RLS existentes", () => {
  assert.doesNotMatch(sql, /(create|drop|alter)\s+policy/i);
  assert.doesNotMatch(sql, /enable row level security/i);
});
