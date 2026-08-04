-- Create the first cloud calendar from the authenticated server identity.
-- The frontend must not provide or be trusted with created_by.

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

  select c.*
    into calendar_row
    from public.calendars as c
   where c.legacy_id = calendar_key;

  if found then
    if calendar_row.created_by <> current_user_id
       and not exists (
         select 1
           from public.calendar_members as member
          where member.calendar_id = calendar_row.id
            and member.user_id = current_user_id
       ) then
      raise exception 'La cuenta no tiene una membresía para este cronograma.' using errcode = '42501';
    end if;

    -- Repair the owner membership if an earlier creation was interrupted
    -- after inserting the calendar but before the trigger completed.
    if calendar_row.created_by = current_user_id then
      insert into public.calendar_members (calendar_id, user_id, role)
      values (calendar_row.id, current_user_id, 'owner')
      on conflict (calendar_id, user_id) do update set role = 'owner';
    end if;

    return next calendar_row;
    return;
  end if;

  insert into public.calendars (legacy_id, name, coordinator, created_by)
  values (calendar_key, calendar_name, calendar_coordinator, current_user_id)
  on conflict (legacy_id) do nothing;

  select c.*
    into calendar_row
    from public.calendars as c
   where c.legacy_id = calendar_key;

  if not found then
    raise exception 'No fue posible crear el cronograma.' using errcode = 'P0001';
  end if;

  if calendar_row.created_by <> current_user_id
     and not exists (
       select 1
         from public.calendar_members as member
        where member.calendar_id = calendar_row.id
          and member.user_id = current_user_id
     ) then
    raise exception 'La cuenta no tiene una membresía para este cronograma.' using errcode = '42501';
  end if;

  return next calendar_row;
end;
$$;

revoke all on function public.create_calendar_for_current_user(text, text, text) from public;
grant execute on function public.create_calendar_for_current_user(text, text, text) to authenticated;
