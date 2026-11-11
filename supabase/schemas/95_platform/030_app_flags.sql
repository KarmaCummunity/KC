-- Platform · feature flags
--
-- A flag switches a product surface on or off without a release: a giving world
-- (`world_<slug>_enabled`), a feature behind a gradual roll-out. The table is structure;
-- its rows are configuration, loaded as seed data and changed by the super admin.
--   read   every signed-in member (the app needs them at start: `flags` in bootstrap_session)
--   write  the super admin, through public.admin_set_app_flag, which leaves an audit event

create table public.app_flags (
  key         text primary key check (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  enabled     boolean not null default false,
  description text not null default '' check (char_length(description) <= 500),
  updated_at  timestamptz not null default now(),
  -- Who switched it last; kept when that member is removed.
  updated_by  uuid references public.users (id) on delete set null
);
comment on table public.app_flags is 'Feature flags: one row per switch, read by every member, written by the super admin.';

-- Covers the foreign key (removal of a staff account).
create index app_flags_updated_by_idx on public.app_flags (updated_by) where updated_by is not null;

create trigger app_flags_set_updated_at
  before update on public.app_flags
  for each row execute function kc_private.set_updated_at();

alter table public.app_flags enable row level security;
alter table public.app_flags force row level security;

create policy app_flags_select_member on public.app_flags
  for select to authenticated
  using (true);

grant select (key, enabled, description, updated_at) on public.app_flags to authenticated;

-- Whether a flag is on. A flag that has no row is off, so code may ask for a flag before
-- its row is seeded. Runs with the caller's rights (the table is readable by members).
create function kc_access.flag_enabled(p_key text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((select f.enabled from public.app_flags f where f.key = p_key), false);
$$;
comment on function kc_access.flag_enabled(text) is 'True when the feature flag exists and is on.';
grant execute on function kc_access.flag_enabled(text) to authenticated;

-- Creates a flag or switches it. Returns the row. The description is kept when omitted.
-- Errors: forbidden (42501) unless the caller is the super admin; invalid_flag_key (P0001).
create function public.admin_set_app_flag(p_key text, p_enabled boolean, p_description text default null)
returns public.app_flags
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.require_admin_role('super_admin');
  v_flag public.app_flags;
begin
  if p_key is null or p_key !~ '^[a-z][a-z0-9_]{1,62}$' or p_enabled is null then
    raise exception 'invalid_flag_key' using errcode = 'P0001';
  end if;
  insert into public.app_flags as f (key, enabled, description, updated_by)
  values (p_key, p_enabled, coalesce(btrim(p_description), ''), v_actor)
  on conflict (key) do update
    set enabled = excluded.enabled,
        description = coalesce(nullif(btrim(p_description), ''), f.description),
        updated_by = excluded.updated_by
  returning f.* into v_flag;
  perform kc_private.audit_record('app_flag_set', 'app_flag', null,
                                  jsonb_build_object('key', p_key, 'enabled', p_enabled));
  return v_flag;
end;
$$;
comment on function public.admin_set_app_flag(text, boolean, text) is
  'Super admin: creates a feature flag or switches it on or off; audited.';
grant execute on function public.admin_set_app_flag(text, boolean, text) to authenticated;
