-- Cloud persistence foundation for SIYS Sync.
-- The application document remains JSONB in this first migration so the
-- existing calendar contract can be reused before normalizing every entity.

create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'Application profile linked one-to-one to Supabase Auth users.';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create table public.calendars (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  name text not null check (length(trim(name)) > 0),
  coordinator text not null default '',
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.calendars is
  'Logical calendars/workspaces visible to one or more authenticated users.';

create table public.calendar_members (
  calendar_id uuid not null references public.calendars (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (calendar_id, user_id)
);

comment on table public.calendar_members is
  'Access control for each calendar. Owners manage membership; editors write data.';

create table public.calendar_documents (
  calendar_id uuid primary key references public.calendars (id) on delete cascade,
  document jsonb not null check (jsonb_typeof(document) = 'object'),
  revision bigint not null default 0 check (revision >= 0),
  schema_version integer not null default 4 check (schema_version >= 1),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

comment on table public.calendar_documents is
  'Versioned canonical calendar document. Entity normalization can be added later.';

create index calendar_members_user_id_idx
  on public.calendar_members (user_id);

create index calendar_documents_updated_at_idx
  on public.calendar_documents (updated_at desc);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.touch_document_metadata()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

create trigger calendars_touch_updated_at
  before update on public.calendars
  for each row execute function public.touch_updated_at();

create trigger calendar_documents_touch_metadata
  before insert or update on public.calendar_documents
  for each row execute function public.touch_document_metadata();

create or replace function public.add_calendar_owner()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.calendar_members (calendar_id, user_id, role)
  values (new.id, new.created_by, 'owner')
  on conflict (calendar_id, user_id) do update set role = 'owner';
  return new;
end;
$$;

create trigger calendars_add_owner
  after insert on public.calendars
  for each row execute function public.add_calendar_owner();

create or replace function public.is_calendar_member(target_calendar_id uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1
    from public.calendar_members as member
    where member.calendar_id = target_calendar_id
      and member.user_id = auth.uid()
  );
$$;

create or replace function public.has_calendar_role(
  target_calendar_id uuid,
  allowed_roles text[]
)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1
    from public.calendar_members as member
    where member.calendar_id = target_calendar_id
      and member.user_id = auth.uid()
      and member.role = any (allowed_roles)
  );
$$;

alter table public.profiles enable row level security;
alter table public.calendars enable row level security;
alter table public.calendar_members enable row level security;
alter table public.calendar_documents enable row level security;

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.calendars to authenticated;
grant select, insert, update, delete on public.calendar_members to authenticated;
grant select, insert, update on public.calendar_documents to authenticated;
grant execute on function public.is_calendar_member(uuid) to authenticated;
grant execute on function public.has_calendar_role(uuid, text[]) to authenticated;

create policy profiles_select_own
  on public.profiles for select to authenticated
  using (id = auth.uid());

create policy profiles_update_own
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy calendars_select_member
  on public.calendars for select to authenticated
  using (public.is_calendar_member(id));

create policy calendars_insert_owner
  on public.calendars for insert to authenticated
  with check (created_by = auth.uid());

create policy calendars_update_editor
  on public.calendars for update to authenticated
  using (public.has_calendar_role(id, array['owner', 'editor']))
  with check (public.has_calendar_role(id, array['owner', 'editor']));

create policy calendars_delete_owner
  on public.calendars for delete to authenticated
  using (public.has_calendar_role(id, array['owner']));

create policy calendar_members_select_member
  on public.calendar_members for select to authenticated
  using (public.is_calendar_member(calendar_id));

create policy calendar_members_insert_owner
  on public.calendar_members for insert to authenticated
  with check (public.has_calendar_role(calendar_id, array['owner']));

create policy calendar_members_update_owner
  on public.calendar_members for update to authenticated
  using (public.has_calendar_role(calendar_id, array['owner']))
  with check (public.has_calendar_role(calendar_id, array['owner']));

create policy calendar_members_delete_owner
  on public.calendar_members for delete to authenticated
  using (public.has_calendar_role(calendar_id, array['owner']));

create policy calendar_documents_select_member
  on public.calendar_documents for select to authenticated
  using (public.is_calendar_member(calendar_id));

create policy calendar_documents_insert_editor
  on public.calendar_documents for insert to authenticated
  with check (public.has_calendar_role(calendar_id, array['owner', 'editor']));

create policy calendar_documents_update_editor
  on public.calendar_documents for update to authenticated
  using (public.has_calendar_role(calendar_id, array['owner', 'editor']))
  with check (public.has_calendar_role(calendar_id, array['owner', 'editor']));

-- The client adapter will use an optimistic predicate such as
-- `where revision = expected_revision` when updating a document. A later
-- server-side operation endpoint can enforce the calendar contract atomically.
