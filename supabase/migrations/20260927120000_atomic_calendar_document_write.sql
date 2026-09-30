-- Atomic document + calendar metadata persistence for SIYS Sync.
--
-- Before this migration the browser persisted an existing document with two
-- independent writes: a PATCH on public.calendar_documents followed by a second
-- PATCH on public.calendars. If the first write succeeded and the second failed,
-- calendar_documents.document and calendars.name/coordinator diverged.
--
-- This RPC makes both writes one transaction. It keeps optimistic concurrency on
-- the authoritative calendar_documents.revision column and derives the calendar
-- metadata from the same persisted document, so a single successful write can
-- never leave document and metadata out of sync.
--
-- The server only persists and enforces concurrency; it does not reimplement the
-- calendar contract. Ownership is derived from auth.uid(), never from the client.

create or replace function public.persist_calendar_document(
  target_calendar_id uuid,
  expected_revision bigint,
  next_document jsonb,
  next_schema_version integer
)
returns table (
  revision bigint,
  updated_at timestamptz,
  updated_by uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  derived_name text;
  derived_coordinator text;
  persisted public.calendar_documents;
begin
  if current_user_id is null then
    raise exception 'Se necesita una sesión autenticada.' using errcode = '42501';
  end if;

  if target_calendar_id is null then
    raise exception 'El calendario objetivo es obligatorio.' using errcode = '22004';
  end if;

  -- expected_revision = NULL means initial creation; otherwise it must be a
  -- non-negative revision for compare-and-swap.
  if expected_revision is not null and expected_revision < 0 then
    raise exception 'La revisión esperada no puede ser negativa.' using errcode = '22023';
  end if;

  if next_document is null or jsonb_typeof(next_document) <> 'object' then
    raise exception 'El documento debe ser un objeto JSON.' using errcode = '22023';
  end if;

  if next_schema_version is null or next_schema_version < 1 then
    raise exception 'La versión de esquema debe ser al menos 1.' using errcode = '22023';
  end if;

  -- Ownership check against the authenticated identity. This function is
  -- SECURITY DEFINER, so it must not rely on RLS to reject non-owners.
  if not public.has_calendar_role(target_calendar_id, array['owner']) then
    raise exception 'Se requiere el rol owner del calendario.' using errcode = '42501';
  end if;

  -- The only trusted source for calendar metadata is the persisted document.
  derived_name := btrim(coalesce(next_document -> 'calendarMeta' ->> 'name', ''));
  derived_coordinator := btrim(coalesce(next_document -> 'calendarMeta' ->> 'coordinator', ''));

  if derived_name = '' then
    raise exception 'El nombre del cronograma no puede estar vacío.' using errcode = '23514';
  end if;

  if expected_revision is null then
    -- Initial document creation (bootstrap). Revision starts at 0.
    insert into public.calendar_documents as document_row (
      calendar_id,
      document,
      revision,
      schema_version
    )
    values (
      target_calendar_id,
      next_document,
      0,
      next_schema_version
    )
    on conflict (calendar_id) do nothing
    returning document_row.* into persisted;

    if persisted.calendar_id is null then
      -- A document already exists: the caller must reload and retry with CAS.
      -- Zero rows signal a concurrency conflict to the client.
      return;
    end if;
  else
    -- Compare-and-swap on the authoritative revision column only. There is no
    -- read-then-write and no retry inside the database.
    update public.calendar_documents as document_row
       set document = next_document,
           revision = expected_revision + 1,
           schema_version = next_schema_version
     where document_row.calendar_id = target_calendar_id
       and document_row.revision = expected_revision
    returning document_row.* into persisted;

    if persisted.calendar_id is null then
      -- Zero rows updated: optimistic concurrency conflict.
      return;
    end if;
  end if;

  -- The document CAS succeeded. Metadata must move in the same transaction; any
  -- failure past this point rolls back the document write as well.
  update public.calendars as calendar_row
     set name = derived_name,
         coordinator = derived_coordinator
   where calendar_row.id = target_calendar_id;

  if not found then
    raise exception 'El calendario no existe.' using errcode = 'P0002';
  end if;

  return query
    select persisted.revision, persisted.updated_at, persisted.updated_by;
end;
$$;

comment on function public.persist_calendar_document(uuid, bigint, jsonb, integer) is
  'Atomically persists a calendar document with CAS on calendar_documents.revision and synchronizes calendars.name/coordinator from the same document.';

revoke all on function public.persist_calendar_document(uuid, bigint, jsonb, integer) from public;
revoke execute on function public.persist_calendar_document(uuid, bigint, jsonb, integer) from anon;
grant execute on function public.persist_calendar_document(uuid, bigint, jsonb, integer) to authenticated;
