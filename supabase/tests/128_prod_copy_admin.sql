-- The "Copied from production" card's RPCs (FR-ADMIN-037 AC13, supabase/seed/prod-copy/lib/
-- 60_admin_rpcs.sql): who may call them, the status they read, and "Delete copied data" with
-- its audit row. Both seeds are dev-only, so this test installs them itself.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
set local client_min_messages = warning;

-- The platform's auth tables carry more than the local shim (as in 110_demo_data.sql).
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

-- The card admits the demo-data managers, a rule of the demo-data tools.
\ir ../seed/demo/install.sql
\ir ../seed/prod-copy/install.sql

select plan(7);

create function pg_temp.uid(p_who text)
returns uuid
language sql
as $$ select md5('prod-copy-admin-' || p_who)::uuid; $$;

-- Runs `p_sql` as the member and returns its single value as text, or the SQLSTATE / P0001
-- message of its error.
create function pg_temp.run(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_out text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.uid(p_who), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    execute p_sql into v_out;
  exception when others then
    v_out := case sqlstate when 'P0001' then sqlerrm else sqlstate end;
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '{}', true);
  return v_out;
end;
$$;

-- s super admin · x member.
insert into auth.users (id, email, raw_app_meta_data, email_confirmed_at) values
  (pg_temp.uid('s'), 's@example.test', '{"provider":"google"}', now()),
  (pg_temp.uid('x'), 'x@example.test', '{"provider":"google"}', now());
insert into public.admin_role_grants (user_id, role) values (pg_temp.uid('s'), 'super_admin');
insert into public.cities (city_id, name_he, name_en, location) values ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)');

update kc_private.prod_copy_state set is_dev_environment = true where singleton;
select kc_private.prod_copy_apply(jsonb_build_object('format', 1,
  'members', jsonb_build_array(
    jsonb_build_object('id', pg_temp.uid('m1'), 'email', 'prodcopy-1@seed.kc.test', 'display_name', 'א ב', 'city_id', 'c1'),
    jsonb_build_object('id', pg_temp.uid('m2'), 'email', 'prodcopy-2@seed.kc.test', 'display_name', 'ג ד', 'city_id', 'c1')),
  'follows', jsonb_build_array(jsonb_build_object('follower_id', pg_temp.uid('m1'), 'followed_id', pg_temp.uid('m2'))))) is not null as applied
\gset

select ok(not has_function_privilege('anon', 'public.admin_prod_copy_status()', 'execute')
          and not has_function_privilege('anon', 'public.admin_delete_prod_copy()', 'execute')
          and has_function_privilege('authenticated', 'public.admin_prod_copy_status()', 'execute')
          and has_function_privilege('authenticated', 'public.admin_delete_prod_copy()', 'execute'),
  'anon cannot call the card''s RPCs; signed-in members can, and the bodies check the role');
select is(pg_temp.run('x', 'select public.admin_prod_copy_status()::text'), '42501',
  'a member without the demo-data role cannot read the copy status');
select is(pg_temp.run('x', 'select public.admin_delete_prod_copy()::text'), '42501',
  'a member without the demo-data role cannot delete the copy');
select is((pg_temp.run('s', 'select public.admin_prod_copy_status()::text'))::jsonb - 'last_copied_at',
  '{"members": 2, "posts": 0, "organizations": 0, "follows": 1, "saved_posts": 0, "is_dev_environment": true}'::jsonb,
  'the super admin reads what the copy holds');
select ok((pg_temp.run('s', 'select public.admin_prod_copy_status()::text'))::jsonb ->> 'last_copied_at' is not null,
  'the status says when the last copy ran');
select is((pg_temp.run('s', 'select public.admin_delete_prod_copy()::text'))::jsonb,
  '{"members": 2, "posts": 0, "organizations": 0, "follows": 1, "saved_posts": 0}'::jsonb,
  '"Delete copied data" deletes the copy and says what it deleted');
select is((select e.actor_id::text || '|' || e.metadata::text from audit.events e
            where e.action = 'admin_delete_prod_copy' order by e.id desc limit 1),
  pg_temp.uid('s')::text || '|{"posts": 0, "follows": 1, "members": 2, "saved_posts": 0, "organizations": 0}',
  'the delete is audited with its counts only, by the admin who ran it');

select * from finish();
rollback;
