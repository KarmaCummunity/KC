-- supabase/tests/0592_admin_seed_demo_data.sql | 0592 (FR-ADMIN-031): restore demo data from the portal.
-- Access control (super admin only), the dev-marker guard, password rules, the seeded shape
-- (200 flagged users, content, 5 demo nonprofits, usable login hash), the saved password hash,
-- the audit row, and that the seed does not trip on the caller's JWT. Rolled back at the end.
-- The seed uses temp tables that drop on commit, so it runs once per transaction here.

begin;

create temp table personas as
select kc_test.create_user('seed_super') as super_admin,
       kc_test.create_user('seed_moderator') as moderator;

-- At most one active super_admin may exist (0112), so clear any on the stack inside this transaction.
delete from public.admin_role_grants where role = 'super_admin';
insert into public.admin_role_grants (user_id, role)
select super_admin, 'super_admin' from personas
union all
select moderator, 'moderator' from personas;

-- No dev marker on this stack: the seed must be refused, even for a super admin.
delete from public.kc_dev_demo_config;

do $$
declare p personas;
begin
  select * into p from personas;
  perform kc_test.assert_true(
    not has_function_privilege('anon', 'public.admin_seed_demo_data(text)', 'execute')
    and not has_function_privilege('authenticated', 'public.kc_dev_seed_demo_data(text)', 'execute'),
    'anon cannot call the portal RPC and nobody but service_role can call the internal seed');

  perform kc_test.act_as(p.moderator);
  perform kc_test.assert_raises($q$select public.admin_seed_demo_data('SeedPass-2026')$q$, 'forbidden', 'a moderator is refused');

  perform kc_test.act_as(p.super_admin);
  perform kc_test.assert_raises($q$select public.admin_seed_demo_data('SeedPass-2026')$q$, 'not_dev_environment',
    'without the dev marker even a super admin cannot seed');
  perform kc_test.assert_true(
    (public.admin_demo_data_status()->>'can_seed')::boolean is false, 'status reports that seeding is not possible here');
end $$;

-- Dev marker present, no saved password yet.
insert into public.kc_dev_demo_config (password_hash) values (null);

do $$
declare p personas;
begin
  select * into p from personas;
  perform kc_test.act_as(p.super_admin);
  perform kc_test.assert_raises($q$select public.admin_seed_demo_data()$q$, 'password_required', 'a first seed needs a password');
  perform kc_test.assert_raises($q$select public.admin_seed_demo_data('short')$q$, 'password_too_short', 'a short password is refused');
  perform kc_test.assert_true(
    (public.admin_demo_data_status()->>'can_seed')::boolean is true
    and (public.admin_demo_data_status()->>'has_saved_password')::boolean is false,
    'status: seed possible, no password saved');
end $$;

-- The seed.
do $$
declare
  p personas;
  r jsonb;
begin
  select * into p from personas;
  perform kc_test.act_as(p.super_admin);
  r := public.admin_seed_demo_data('SeedPass-2026');

  perform kc_test.assert_eq((r->>'users')::int, 200, 'two hundred demo users');
  perform kc_test.assert_true((r->>'posts')::int > 0, 'demo posts were created');
  perform kc_test.assert_true((r->>'rides')::int > 0, 'demo rides were created');
  perform kc_test.assert_eq((r->>'organizations')::int, 5, 'five demo nonprofits');

  perform kc_test.assert_eq(
    (select count(*)::int from auth.users
      where email like '%@seed.kc.test' and coalesce(raw_app_meta_data->>'seed', '') = 'true'),
    200, 'every demo user is flagged and on the seed domain');
  perform kc_test.assert_true(
    exists (select 1 from auth.users
             where email = 'user1@seed.kc.test'
               and encrypted_password = extensions.crypt('SeedPass-2026', encrypted_password)),
    'the demo users can log in with the given password');
  perform kc_test.assert_true(
    (select password_hash is not null from public.kc_dev_demo_config), 'the password hash is saved for later restores');
  perform kc_test.assert_true(
    (public.admin_demo_data_status()->>'has_saved_password')::boolean is true
    and (public.admin_demo_data_status()->>'demo_users')::int = 200,
    'status now shows 200 users and a saved password');

  perform kc_test.assert_eq(
    (select count(*)::int from public.audit_events where action = 'admin_seed_demo_data' and actor_id = p.super_admin),
    1, 'the seed is audit-logged once');
  perform kc_test.assert_true(
    exists (select 1 from public.users where user_id = p.super_admin), 'the real admin user is untouched');

  -- Wipe then clears exactly what the seed made.
  perform public.admin_wipe_demo_data();
  perform kc_test.assert_eq((public.admin_demo_data_status()->>'demo_users')::int, 0, 'wipe removes all demo users');
  perform kc_test.assert_eq((public.admin_demo_data_status()->>'demo_organizations')::int, 0, 'wipe removes demo nonprofits');
end $$;

rollback;

\echo '✓ 0592_admin_seed_demo_data.sql passed'
