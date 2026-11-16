-- Demo data tools of kc-dev (FR-ADMIN-031, supabase/seed/demo): who may call them, the dev
-- marker and the password rules, a full stepped restore and wipe, the exact scope of the wipe
-- (real and e2e members survive), a nonprofit with payment history kept, the operation lock,
-- the refusal to wipe oneself, the acting admin made org admin, and the audit rows.
-- The tools are a dev-only seed, not a migration, so this test installs them itself.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- The platform's auth tables carry more than the local shim: the columns and the identity
-- table the auth service writes, which the restore writes like it.
alter table auth.users
  add column if not exists instance_id uuid, add column if not exists aud text,
  add column if not exists role text, add column if not exists encrypted_password text,
  add column if not exists updated_at timestamptz, add column if not exists confirmation_token text,
  add column if not exists recovery_token text, add column if not exists email_change_token_new text,
  add column if not exists email_change text;
create table if not exists auth.identities (
  id uuid primary key, user_id uuid not null references auth.users (id) on delete cascade,
  provider_id text not null, identity_data jsonb not null, provider text not null,
  last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz);

-- Installed twice: the second run must succeed and change nothing.
\ir ../seed/demo/install.sql
\ir ../seed/demo/install.sql

create function pg_temp.uid(p_who text)
returns uuid
language sql
as $$ select ('00000000-0000-4000-8000-0000000000' || to_hex(ascii(p_who)))::uuid; $$;

-- Runs `p_sql` as the member and returns its single value as text ('ok' for none), or the
-- P0001 message / the SQLSTATE of its error.
create function pg_temp.run_id(p_user_id uuid, p_sql text)
returns text
language plpgsql
as $$
declare
  v_out text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    execute p_sql into v_out;
    v_out := coalesce(nullif(v_out, ''), 'ok');
  exception when others then
    v_out := case sqlstate when 'P0001' then sqlerrm else sqlstate end;
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '{}', true);
  return v_out;
end;
$$;

create function pg_temp.run(p_who text, p_sql text)
returns text
language sql
as $$ select pg_temp.run_id(pg_temp.uid(p_who), p_sql); $$;

-- The audit rows of an action: 'count|actor|metadata keys', newest row.
create function pg_temp.audit(p_action text)
returns text
language sql
as $$
  select count(*) over () || '|' || coalesce(e.actor_id::text, '-') || '|'
         || (select string_agg(k, ',' order by k) from jsonb_object_keys(e.metadata) k)
    from audit.events e where e.action = p_action order by e.id desc limit 1;
$$;

-- Calls a step RPC as the member until it answers done; returns the final answer, or the
-- refusal of the first step that failed.
create function pg_temp.steps(p_who text, p_first_call text, p_next_call text)
returns jsonb
language plpgsql
as $$
declare
  v_out text := pg_temp.run(p_who, p_first_call);
begin
  for i in 1..20 loop
    if v_out !~ '^\{' then
      return to_jsonb(v_out);
    end if;
    exit when (v_out::jsonb ->> 'done')::boolean;
    v_out := pg_temp.run(p_who, p_next_call);
  end loop;
  return v_out::jsonb;
end;
$$;

select plan(25);

-- s super admin · a org admin of the platform · o org admin of another org · g org manager of
-- the platform · m moderator · x member · e an e2e member on the seed domain.
insert into auth.users (id, email, raw_app_meta_data) values
  (pg_temp.uid('s'), 's@example.test', '{"provider":"google"}'),
  (pg_temp.uid('a'), 'a@example.test', '{"provider":"google"}'),
  (pg_temp.uid('o'), 'o@example.test', '{"provider":"google"}'),
  (pg_temp.uid('g'), 'g@example.test', '{"provider":"google"}'),
  (pg_temp.uid('m'), 'm@example.test', '{"provider":"google"}'),
  (pg_temp.uid('x'), 'x@example.test', '{"provider":"google"}'),
  (pg_temp.uid('e'), 'user1@seed.kc.test', '{"provider":"email","seed":true}');
update auth.users set email_confirmed_at = now() where id = pg_temp.uid('e');
insert into public.organizations (id, slug, name, is_platform) values
  ('40000000-0000-4000-8000-000000000001', 'karma-community', 'Karma Community', true),
  ('40000000-0000-4000-8000-000000000002', 'other-org', 'Other Org', false);
insert into public.admin_role_grants (user_id, role, scope_org_id) values
  (pg_temp.uid('s'), 'super_admin', null),
  (pg_temp.uid('a'), 'org_admin', '40000000-0000-4000-8000-000000000001'),
  (pg_temp.uid('o'), 'org_admin', '40000000-0000-4000-8000-000000000002'),
  (pg_temp.uid('g'), 'org_manager', '40000000-0000-4000-8000-000000000001'),
  (pg_temp.uid('m'), 'moderator', null);

-- Reference data the restore places its content in.
insert into public.cities (city_id, name_he, name_en, location) values
  ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)'),
  ('c2', 'c2', 'City Two', 'SRID=4326;POINT(35.21 31.77)'),
  ('c3', 'c3', 'City Three', 'SRID=4326;POINT(34.99 32.79)');
insert into public.worlds (slug, label_he, label_en) values ('items', 'items', 'Items'), ('rides', 'rides', 'Rides');
insert into public.post_kinds (world_slug, slug, label_he, label_en, direction) values
  ('items', 'item_offer', 'o', 'o', 'offer'), ('items', 'item_request', 'r', 'r', 'request'),
  ('rides', 'ride_offer', 'o', 'o', 'offer'), ('rides', 'ride_request', 'r', 'r', 'request');
insert into public.item_subcategories (world_slug, slug, label_he, label_en) values ('items', 'furniture', 'f', 'Furniture');

-- ── Who may call ────────────────────────────────────────────────────────────
select ok(not has_function_privilege('anon', 'public.admin_demo_data_status()', 'execute')
          and not has_function_privilege('anon', 'public.admin_wipe_demo_data_step()', 'execute')
          and not has_function_privilege('anon', 'public.admin_seed_demo_data_step(text)', 'execute'),
  'anon cannot execute the demo-data RPCs');
select ok(has_function_privilege('authenticated', 'public.admin_demo_data_status()', 'execute')
          and has_function_privilege('authenticated', 'public.admin_wipe_demo_data_step()', 'execute')
          and has_function_privilege('authenticated', 'public.admin_seed_demo_data_step(text)', 'execute'),
  'signed-in members may call the demo-data RPCs (the bodies check the role)');
select is(
  (select string_agg(w || '=' || kc_private.can_manage_demo_data(pg_temp.uid(w)), ' ' order by w)
     from unnest(array['a', 'g', 'm', 'o', 's', 'x']) w) || ' null=' || kc_private.can_manage_demo_data(null),
  'a=true g=false m=false o=false s=true x=false null=false',
  'only the super admin and the platform org admin may manage demo data (AC6)');
select is(pg_temp.run('x', 'select public.admin_demo_data_status()') || '|'
  || pg_temp.run('o', 'select public.admin_demo_data_status()') || '|'
  || pg_temp.run('m', 'select public.admin_wipe_demo_data_step()') || '|'
  || pg_temp.run('g', 'select public.admin_seed_demo_data_step(null)'),
  '42501|42501|42501|42501', 'a member, another org''s admin, a moderator and an org manager are refused');

-- ── Status and the dev marker ───────────────────────────────────────────────
select is(pg_temp.run('a', 'select public.admin_demo_data_status()')::jsonb - 'operation' - 'phase',
  '{"demo_users": 0, "demo_organizations": 0, "demo_item_posts": 0, "demo_ride_posts": 0, "demo_follows": 0,
    "demo_chats": 0, "demo_org_memberships": 0, "can_seed": false, "has_saved_password": false}'::jsonb,
  'the platform org admin reads the status: nothing yet, and no restore without the dev marker');
select is(pg_temp.run('s', $$select public.admin_seed_demo_data_step('long-enough-1')$$), '42501',
  'without the dev marker a restore is refused (not_dev_environment, AC8)');
select is((select password_hash from kc_private.demo_data_state), null,
  'a refused restore does not keep the password');

update kc_private.demo_data_state set is_dev_environment = true where singleton;
select is(pg_temp.run('s', 'select public.admin_seed_demo_data_step(null)'), 'password_required',
  'the first restore needs a password (AC9)');
select is(pg_temp.run('s', $$select public.admin_seed_demo_data_step('short')$$), 'password_too_short',
  'the password has at least 8 characters (AC9)');

-- ── Restore ─────────────────────────────────────────────────────────────────
select is(
  pg_temp.steps('s', $$select public.admin_seed_demo_data_step('SeedPass-2026')$$,
                'select public.admin_seed_demo_data_step(null)') -> 'result',
  '{"demo_users": 200, "demo_organizations": 3, "demo_item_posts": 600, "demo_ride_posts": 120,
    "demo_follows": 1600, "demo_chats": 150, "demo_org_memberships": 12}'::jsonb,
  'the stepped restore creates members, item posts, rides, follows, chats and the demo nonprofits (AC7)');
select ok((select password_hash like '$2%' and password_hash <> 'SeedPass-2026' from kc_private.demo_data_state),
  'only the bcrypt hash of the password is kept (AC9)');
select is((select count(*)::int from auth.users u
            where u.id = any (kc_private.demo_member_ids())
              and u.encrypted_password = extensions.crypt('SeedPass-2026', u.encrypted_password)), 200,
  'every demo member signs in with that password');
select is((select count(*)::int from public.users u join public.user_account a on a.user_id = u.id
            where u.id = any (kc_private.demo_member_ids()) and u.is_active and a.onboarding_state = 'completed'
              and u.display_name is not null and u.city_id is not null), 200,
  'demo members are active, onboarded, named and placed in a city');
select is((select count(*)::int from public.posts p join public.post_ride_details d on d.post_id = p.id
            where p.owner_id = any (kc_private.demo_member_ids()) and d.departs_at > now()), 120,
  'every demo ride has its upcoming ride row');
select is((select count(*)::int from public.admin_role_grants g
            where g.user_id = pg_temp.uid('s') and g.role = 'org_admin' and g.revoked_at is null
              and g.scope_org_id = any (kc_private.demo_org_ids())), 3,
  'the admin who restored manages each demo nonprofit (AC10)');
select is(pg_temp.audit('admin_seed_demo_data'),
  '1|' || pg_temp.uid('s') || '|demo_chats,demo_follows,demo_item_posts,demo_org_memberships,demo_organizations,demo_ride_posts,demo_users',
  'the restore is audited with its counts only, never the password (AC9)');
select is(
  pg_temp.steps('a', 'select public.admin_seed_demo_data_step(null)', 'select public.admin_seed_demo_data_step(null)')
    -> 'result' -> 'demo_users', '200'::jsonb,
  'a later restore reuses the saved password and replaces the demo data instead of doubling it');

-- ── The lock, and wiping oneself ────────────────────────────────────────────
select is(pg_temp.run('s', 'select public.admin_wipe_demo_data_step()')::jsonb ->> 'progress_key', 'wipe_accounts',
  'a wipe runs one phase per call');
select is(pg_temp.run('a', 'select public.admin_seed_demo_data_step(null)'), 'demo_operation_busy',
  'a restore cannot start while a wipe is half done');
insert into public.admin_role_grants (user_id, role, scope_org_id)
values ((kc_private.demo_member_ids())[1], 'org_admin', '40000000-0000-4000-8000-000000000001');
select is(pg_temp.run_id((kc_private.demo_member_ids())[1], 'select public.admin_wipe_demo_data_step()'), '42501',
  'a demo member with the right role still cannot wipe the demo data it belongs to (AC5)');

-- ── Wipe ────────────────────────────────────────────────────────────────────
-- One demo nonprofit has a finance account: billing keeps it from being deleted (AC4).
insert into billing.org_finance_accounts (org_id, name, kind) values ('00000000-0000-4000-8000-00000000d001', 'cash', 'cash');
select is(pg_temp.steps('s', 'select public.admin_wipe_demo_data_step()', 'select public.admin_wipe_demo_data_step()') -> 'result',
  '{"posts_deleted": 720, "chats_deleted": 150, "users_deleted": 200, "organizations_deleted": 2, "organizations_kept": 1}'::jsonb,
  'the wipe finishes: every demo member goes, and a nonprofit with payment history is kept and reported (AC2, AC4)');
select is(pg_temp.run('s', 'select public.admin_demo_data_status()')::jsonb - 'can_seed' - 'has_saved_password',
  '{"demo_users": 0, "demo_organizations": 1, "demo_item_posts": 0, "demo_ride_posts": 0, "demo_follows": 0,
    "demo_chats": 0, "demo_org_memberships": 1, "operation": "idle", "phase": "idle"}'::jsonb,
  'nothing of the demo members is left (the kept nonprofit keeps its real admin); the lock is released');
select is((select count(*)::int from auth.users), 7,
  'real members and the e2e member on the seed domain are never touched (AC3)');
select is(pg_temp.audit('admin_wipe_demo_data'),
  '1|' || pg_temp.uid('s') || '|chats_deleted,organizations_deleted,organizations_kept,posts_deleted,users_deleted',
  'the completed wipe is audited with its counts');
select is(pg_temp.steps('s', 'select public.admin_wipe_demo_data_step()', 'select public.admin_wipe_demo_data_step()')
    -> 'result' ->> 'users_deleted', '0',
  'a wipe with nothing left deletes nothing');

select * from finish();
rollback;
