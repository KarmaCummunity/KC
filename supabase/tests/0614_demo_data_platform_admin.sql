-- 0611 (FR-ADMIN-031 AC6): demo-data RPCs accept the super admin and the org_admin of the platform org.
-- Refused: a plain member, a moderator, the org_admin of any other organization, and a platform-org
-- org_manager. Everything is rolled back at the end.

begin;

create temp table personas as
select kc_test.create_user('demo_super') as super_admin,
       kc_test.create_user('demo_platform_admin') as platform_admin,
       kc_test.create_user('demo_other_admin') as other_admin,
       kc_test.create_user('demo_platform_mgr') as platform_manager,
       kc_test.create_user('demo_moderator') as moderator,
       kc_test.create_user('demo_real') as real_user;

-- At most one active super_admin may exist (0112), so clear any on the stack inside this transaction.
delete from public.admin_role_grants where role = 'super_admin';

insert into public.organizations (org_id, name, slug, is_platform)
values ('00000000-0000-0000-0000-00000000d0b1', 'Other org 0611', 'other-org-0611', false);

insert into public.admin_role_grants (user_id, role, scope_org_id)
select super_admin, 'super_admin', null::uuid from personas
union all
select moderator, 'moderator', null from personas
union all
select platform_admin, 'org_admin', (select org_id from public.organizations where is_platform) from personas
union all
select platform_manager, 'org_manager', (select org_id from public.organizations where is_platform) from personas
union all
select other_admin, 'org_admin', '00000000-0000-0000-0000-00000000d0b1' from personas;

do $$
declare p personas;
begin
  select * into p from personas;

  perform kc_test.assert_true(
    not has_function_privilege('anon', 'public.can_manage_demo_data(uuid)', 'execute'),
    'anon cannot execute the predicate');

  perform kc_test.assert_true(public.can_manage_demo_data(p.super_admin), 'super admin is allowed');
  perform kc_test.assert_true(public.can_manage_demo_data(p.platform_admin), 'platform org admin is allowed');
  perform kc_test.assert_true(not public.can_manage_demo_data(p.other_admin), 'org admin of another org is refused');
  perform kc_test.assert_true(not public.can_manage_demo_data(p.platform_manager), 'platform org_manager is refused');
  perform kc_test.assert_true(not public.can_manage_demo_data(p.moderator), 'moderator is refused');
  perform kc_test.assert_true(not public.can_manage_demo_data(p.real_user), 'plain member is refused');
  perform kc_test.assert_true(not public.can_manage_demo_data(null), 'null user is refused');
end $$;

-- ── the three RPCs follow the predicate ─────────────────────────────────────
do $$
declare p personas;
begin
  select * into p from personas;

  perform kc_test.act_as(p.other_admin);
  perform kc_test.assert_raises('select public.admin_demo_data_status()', 'forbidden', 'other org admin refused (status)');
  perform kc_test.assert_raises('select public.admin_wipe_demo_data()', 'forbidden', 'other org admin refused (wipe)');
  perform kc_test.assert_raises('select public.admin_seed_demo_data(null)', 'forbidden', 'other org admin refused (seed)');

  perform kc_test.act_as(p.platform_admin);
  perform kc_test.assert_true((public.admin_demo_data_status()) is not null, 'platform org admin can read the status');
  perform kc_test.assert_true((public.admin_wipe_demo_data()) is not null, 'platform org admin can wipe');
  perform kc_test.assert_eq(
    (select count(*)::int from public.audit_events where action = 'admin_wipe_demo_data' and actor_id = p.platform_admin),
    1, 'the wipe is audit-logged for the platform org admin');
end $$;

rollback;

\echo '✓ 0614_demo_data_platform_admin.sql passed'
