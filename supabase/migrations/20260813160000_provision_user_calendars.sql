-- Provision one calendar per user and channel so an Auth account cannot exist
-- without a selectable calendar. Documents remain lazy: the owner creates the
-- empty document on first access through the existing bootstrap flow.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  display_name text := btrim(coalesce(new.raw_user_meta_data ->> 'display_name', ''));
begin
  insert into public.profiles (id, display_name)
  values (new.id, display_name)
  on conflict (id) do nothing;

  insert into public.calendars (legacy_id, name, coordinator, created_by)
  values
    ('calendario-hvac-siys', 'Cronograma HVAC', display_name, new.id),
    ('calendario-hvac-siys-beta', 'Cronograma HVAC', display_name, new.id)
  on conflict (legacy_id, created_by) do nothing;

  return new;
end;
$$;

-- Backfill accounts created before the provisioning trigger was strengthened.
insert into public.calendars (legacy_id, name, coordinator, created_by)
select channel.legacy_id, 'Cronograma HVAC', p.display_name, p.id
from public.profiles as p
cross join (
  values
    ('calendario-hvac-siys'::text),
    ('calendario-hvac-siys-beta'::text)
) as channel(legacy_id)
on conflict (legacy_id, created_by) do nothing;

comment on function public.handle_new_user() is
  'Creates the profile and one empty logical calendar per published channel for each new Auth user.';

