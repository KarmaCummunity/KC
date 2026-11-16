-- Demo data (FR-ADMIN-031) · scope: the dev marker, the operation lock, and what counts as demo.
--
-- Everything in this directory is installed only on kc-dev (and local or CI scratch databases)
-- by supabase/seed/demo/install.sql. It is never a migration: the production baseline holds no
-- seed, demo or dev object (docs/db/target-design.md §6, §9).

-- bcrypt for the demo members' password; the platform ships pgcrypto in `extensions`.
create extension if not exists pgcrypto with schema extensions;

-- One row. `is_dev_environment` is the marker that allows a restore: only load.sql sets it,
-- and only when the session says `kc.seed_target = 'dev'`. `password_hash` is the bcrypt hash
-- of the demo members' login password, typed once in the portal. The operation columns are
-- the lock and the progress of a stepped wipe or restore (one short RPC call per phase).
create table if not exists kc_private.demo_data_state (
  singleton          boolean primary key default true check (singleton),
  is_dev_environment boolean not null default false,
  password_hash      text,
  operation          text not null default 'idle' check (operation in ('idle', 'seed', 'wipe')),
  phase              text not null default 'idle',
  actor_id           uuid,
  -- Counts gathered by the phases of the running operation, returned when it completes.
  aux                jsonb not null default '{}'::jsonb check (jsonb_typeof(aux) = 'object'),
  updated_at         timestamptz not null default now()
);
comment on table kc_private.demo_data_state is
  'kc-dev demo data (FR-ADMIN-031): dev marker, saved password hash and the stepped-operation lock.';
alter table kc_private.demo_data_state enable row level security;
alter table kc_private.demo_data_state force row level security;
revoke all on kc_private.demo_data_state from public, anon, authenticated;

insert into kc_private.demo_data_state (singleton) values (true) on conflict (singleton) do nothing;

-- The demo members: auth accounts on the reserved test domain with the `demo` flag. The e2e
-- members (`userN@seed.kc.test`, supabase/seed/e2e) carry no `demo` flag and are never matched.
create or replace function kc_private.demo_member_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(u.id order by u.email), '{}')
    from auth.users u
   where u.email like 'demo%@seed.kc.test'
     and coalesce(u.raw_app_meta_data ->> 'demo', '') = 'true';
$$;
comment on function kc_private.demo_member_ids() is
  'Ids of the kc-dev demo members (demoN@seed.kc.test with app_metadata.demo = true), ordered by email.';

-- The three demo nonprofits have fixed ids, so the wipe can never reach a real organization.
create or replace function kc_private.demo_org_ids()
returns uuid[]
language sql
immutable
set search_path = ''
as $$
  select array['00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000d002',
               '00000000-0000-4000-8000-00000000d003']::uuid[];
$$;
comment on function kc_private.demo_org_ids() is 'Fixed ids of the three [DEMO] nonprofits.';

-- FR-ADMIN-031 AC6, the single rule of the screen: the super admin, or the org admin of the
-- platform organization. The org admins of every other organization are refused.
create or replace function kc_private.can_manage_demo_data(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null and exists (
    select 1
      from public.admin_role_grants g
      join public.users u on u.id = g.user_id and u.is_active
     where g.user_id = p_user_id
       and g.revoked_at is null
       and (g.role = 'super_admin'
            or (g.role = 'org_admin'
                and g.scope_org_id = (select o.id from public.organizations o where o.is_platform))));
$$;
comment on function kc_private.can_manage_demo_data(uuid) is
  'FR-ADMIN-031 AC6: true for the super admin and the org admin of the platform organization only.';

-- Every demo-data RPC starts here: the signed-in caller, who must pass the rule above.
create or replace function kc_private.require_demo_data_manager()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_caller();
begin
  if not kc_private.can_manage_demo_data(v_user_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return v_user_id;
end;
$$;
comment on function kc_private.require_demo_data_manager() is
  'Returns auth.uid(); raises forbidden (42501) unless the caller may manage demo data.';

-- Cities the demo content is spread over: a fixed list of large cities when the reference
-- data has them (kc-dev), otherwise the first cities by id (a scratch test database).
create or replace function kc_private.demo_city_pool()
returns text[]
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select array_agg(c.city_id order by c.city_id) from public.cities c
      where c.city_id in ('3000', '5000', '4000', '8300', '9000', '7900', '7100', '7400', '2600', '6400',
                          '70', '8400', '8600', '6500', '6600', '6900', '1200', '7000', '9700', '8800')),
    (select array_agg(x.city_id order by x.city_id)
       from (select c.city_id from public.cities c order by c.city_id limit 20) x),
    '{}');
$$;
comment on function kc_private.demo_city_pool() is 'Cities the demo members and posts are placed in.';
