-- Give every authenticated user a private calendar for the current channel
-- while allowing all authenticated users to inspect every calendar document.
-- Writes remain restricted to the owner by RLS.

alter table public.calendars
  drop constraint if exists calendars_legacy_id_key;

alter table public.calendars
  add constraint calendars_legacy_id_created_by_key unique (legacy_id, created_by);

comment on table public.calendars is
  'One logical calendar per owner and channel; authenticated users can read all calendars, but only owners can write their own.';

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_authenticated
  on public.profiles for select to authenticated
  using (true);

drop policy if exists calendars_select_member on public.calendars;
create policy calendars_select_authenticated
  on public.calendars for select to authenticated
  using (true);

drop policy if exists calendars_update_editor on public.calendars;
create policy calendars_update_owner
  on public.calendars for update to authenticated
  using (public.has_calendar_role(id, array['owner']))
  with check (public.has_calendar_role(id, array['owner']));

drop policy if exists calendar_documents_select_member on public.calendar_documents;
create policy calendar_documents_select_authenticated
  on public.calendar_documents for select to authenticated
  using (true);

drop policy if exists calendar_documents_insert_editor on public.calendar_documents;
create policy calendar_documents_insert_owner
  on public.calendar_documents for insert to authenticated
  with check (public.has_calendar_role(calendar_id, array['owner']));

drop policy if exists calendar_documents_update_editor on public.calendar_documents;
create policy calendar_documents_update_owner
  on public.calendar_documents for update to authenticated
  using (public.has_calendar_role(calendar_id, array['owner']))
  with check (public.has_calendar_role(calendar_id, array['owner']));

create or replace function public.create_calendar_for_current_user(
  requested_legacy_id text,
  requested_name text,
  requested_coordinator text default ''
)
returns setof public.calendars
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  calendar_key text := btrim(coalesce(requested_legacy_id, ''));
  calendar_name text := coalesce(nullif(btrim(coalesce(requested_name, '')), ''), 'Cronograma HVAC');
  calendar_coordinator text := btrim(coalesce(requested_coordinator, ''));
  calendar_row public.calendars;
begin
  if current_user_id is null then
    raise exception 'Se necesita una sesión autenticada.' using errcode = '42501';
  end if;

  if calendar_key = '' then
    raise exception 'El identificador del cronograma no puede estar vacío.' using errcode = '22023';
  end if;

  -- A user owns one calendar for each channel key. Other users' calendars
  -- with the same key are intentionally not treated as a conflict.
  select c.*
    into calendar_row
    from public.calendars as c
   where c.legacy_id = calendar_key
     and c.created_by = current_user_id;

  if found then
    insert into public.calendar_members (calendar_id, user_id, role)
    values (calendar_row.id, current_user_id, 'owner')
    on conflict (calendar_id, user_id) do update set role = 'owner';
    return next calendar_row;
    return;
  end if;

  insert into public.calendars (legacy_id, name, coordinator, created_by)
  values (calendar_key, calendar_name, calendar_coordinator, current_user_id)
  on conflict (legacy_id, created_by) do nothing;

  select c.*
    into calendar_row
    from public.calendars as c
   where c.legacy_id = calendar_key
     and c.created_by = current_user_id;

  if not found then
    raise exception 'No fue posible crear el cronograma.' using errcode = 'P0001';
  end if;

  return next calendar_row;
end;
$$;

revoke all on function public.create_calendar_for_current_user(text, text, text) from public;
revoke execute on function public.create_calendar_for_current_user(text, text, text) from anon;
grant execute on function public.create_calendar_for_current_user(text, text, text) to authenticated;

-- These helpers are used by RLS/triggers, not as public RPC endpoints.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.add_calendar_owner() from public, anon, authenticated;
revoke execute on function public.is_calendar_member(uuid) from public, anon;
revoke execute on function public.has_calendar_role(uuid, text[]) from public, anon;
grant execute on function public.is_calendar_member(uuid) to authenticated;
grant execute on function public.has_calendar_role(uuid, text[]) to authenticated;
