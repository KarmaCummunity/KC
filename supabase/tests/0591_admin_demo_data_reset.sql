-- supabase/tests/0591_admin_demo_data_reset.sql | 0591 (FR-ADMIN-031): demo data status + wipe.
-- Access control (super admin only), the exact scope of the wipe (flagged seed users and demo
-- nonprofits go; real users and look-alike accounts stay), cascades to user content, the audit
-- row, self-wipe protection, and idempotence. Everything is rolled back at the end.

begin;

create temp table personas as
select kc_test.create_user('demo_super') as super_admin,
       kc_test.create_user('demo_moderator') as moderator,
       kc_test.create_user('demo_real') as real_user,
       kc_test.create_user('demo_seed_a') as seed_a,
       kc_test.create_user('demo_seed_b') as seed_b,
       kc_test.create_user('demo_lookalike') as lookalike;

-- At most one active super_admin may exist (0112), so clear any on the stack inside this transaction.
delete from public.admin_role_grants where role = 'super_admin';

insert into public.admin_role_grants (user_id, role)
select super_admin, 'super_admin' from personas
union all
select moderator, 'moderator' from personas;

-- Two flagged seed users who follow each other (content that must cascade), plus a look-alike
-- with the seed e-mail domain but WITHOUT the app_metadata flag, which must survive.
update auth.users
   set email = 'demo_seed_a@seed.kc.test',
       raw_app_meta_data = jsonb_build_object('provider', 'email', 'seed', true)
 where id = (select seed_a from personas);
update auth.users
   set email = 'demo_seed_b@seed.kc.test',
       raw_app_meta_data = jsonb_build_object('provider', 'email', 'seed', true)
 where id = (select seed_b from personas);
update auth.users
   set email = 'demo_lookalike@seed.kc.test'
 where id = (select lookalike from personas);

insert into public.follow_edges (follower_id, followed_id)
select seed_a, seed_b from personas;

insert into public.organizations (org_id, name, slug, is_platform, is_verified_nonprofit, verified_at, verification_method)
values ('00000000-0000-0000-0000-00000000d0a1', '[DEMO] test org', 'demo-test-org-0591', false, true, now(), 'demo_seed');

-- ── audit allow-list: extended in place, existing actions survive ─────────────
do $$
begin
  -- 'account_deletion_requested' comes from another migration; this one must not drop it.
  insert into public.audit_events (action, target_type) values ('account_deletion_requested', 'none');
  insert into public.audit_events (action, target_type) values ('admin_wipe_demo_data', 'none');
  insert into public.audit_events (action, target_type) values ('admin_seed_demo_data', 'none');
  perform kc_test.assert_raises($q$insert into public.audit_events (action, target_type) values ('not_an_action', 'none')$q$,
    'new row for relation "audit_events" violates check constraint "audit_events_action_check"',
    'an unknown audit action is still rejected');
end $$;

-- ── access control ──────────────────────────────────────────────────────────
do $$
declare p personas;
begin
  select * into p from personas;
  perform kc_test.assert_true(
    not has_function_privilege('anon', 'public.admin_wipe_demo_data()', 'execute')
    and not has_function_privilege('anon', 'public.admin_demo_data_status()', 'execute'),
    'anon cannot execute the demo-data RPCs');
  perform kc_test.act_as(p.real_user);
  perform kc_test.assert_raises('select public.admin_demo_data_status()', 'forbidden', 'a plain member is refused (status)');
  perform kc_test.assert_raises('select public.admin_wipe_demo_data()', 'forbidden', 'a plain member is refused (wipe)');
  perform kc_test.act_as(p.moderator);
  perform kc_test.assert_raises('select public.admin_wipe_demo_data()', 'forbidden', 'a moderator is refused: super admin only');
end $$;

-- ── status counts the flagged seed users and the demo nonprofit, not the look-alike ──
do $$
declare
  p personas;
  s jsonb;
begin
  select * into p from personas;
  perform kc_test.act_as(p.super_admin);
  s := public.admin_demo_data_status();
  perform kc_test.assert_true((s->>'demo_users')::int >= 2, 'status counts the two flagged seed users');
  perform kc_test.assert_true((s->>'demo_organizations')::int >= 1, 'status counts the demo nonprofit');
  perform kc_test.assert_true(public.is_demo_seed_user(p.seed_a), 'flagged seed user is recognised');
  perform kc_test.assert_true(not public.is_demo_seed_user(p.lookalike), 'look-alike without the flag is not a seed user');
end $$;

-- ── a seed-flagged super admin cannot wipe itself ──────────────────────────
do $$
declare p personas;
begin
  select * into p from personas;
  update auth.users
     set email = 'demo_super@seed.kc.test',
         raw_app_meta_data = jsonb_build_object('provider', 'email', 'seed', true)
   where id = p.super_admin;
  perform kc_test.act_as(p.super_admin);
  perform kc_test.assert_raises('select public.admin_wipe_demo_data()', 'cannot_wipe_self', 'a seed super admin cannot wipe itself');
  update auth.users
     set email = 'demo_super@kc-test.local',
         raw_app_meta_data = jsonb_build_object('provider', 'email')
   where id = p.super_admin;
end $$;

-- ── the wipe ────────────────────────────────────────────────────────────────
do $$
declare
  p personas;
  r jsonb;
begin
  select * into p from personas;
  perform kc_test.act_as(p.super_admin);
  r := public.admin_wipe_demo_data();

  perform kc_test.assert_true((r->>'users_deleted')::int >= 2, 'the flagged seed users were deleted');
  perform kc_test.assert_true((r->>'organizations_deleted')::int >= 1, 'the demo nonprofit was deleted');
  perform kc_test.assert_eq((r->>'organizations_kept')::int, 0, 'no nonprofit was kept');

  perform kc_test.assert_true(not exists (select 1 from auth.users where id in (p.seed_a, p.seed_b)), 'seed users are gone');
  perform kc_test.assert_true(not exists (select 1 from public.follow_edges where follower_id = p.seed_a), 'their content cascaded');
  perform kc_test.assert_true(not exists (select 1 from public.organizations where slug = 'demo-test-org-0591'), 'demo nonprofit is gone');
  perform kc_test.assert_true(exists (select 1 from auth.users where id = p.real_user), 'a real user is untouched');
  perform kc_test.assert_true(exists (select 1 from auth.users where id = p.lookalike), 'the unflagged look-alike is untouched');

  perform kc_test.assert_eq(
    (select count(*)::int from public.audit_events where action = 'admin_wipe_demo_data' and actor_id = p.super_admin),
    1, 'the wipe is audit-logged once');

  -- Second run: nothing left, so it deletes nothing (idempotent).
  r := public.admin_wipe_demo_data();
  perform kc_test.assert_eq((r->>'users_deleted')::int, 0, 'a second wipe deletes no users');
  perform kc_test.assert_eq((public.admin_demo_data_status()->>'demo_users')::int, 0, 'status reports zero demo users');
end $$;

rollback;

\echo '✓ 0591_admin_demo_data_reset.sql passed'
