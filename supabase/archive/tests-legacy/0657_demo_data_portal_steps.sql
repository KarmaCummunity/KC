-- 0657 (FR-ADMIN-031): portal wipe advances in short steps and still deletes only flagged seed users.

begin;

create temp table personas as
select kc_test.create_user('step_super') as super_admin,
       kc_test.create_user('step_seed') as seed_user,
       kc_test.create_user('step_real') as real_user;

delete from public.admin_role_grants where role = 'super_admin';
insert into public.admin_role_grants (user_id, role)
select super_admin, 'super_admin' from personas;

update auth.users
   set email = 'step_seed@seed.kc.test',
       raw_app_meta_data = jsonb_build_object('provider', 'email', 'seed', true)
 where id = (select seed_user from personas);

insert into public.follow_edges (follower_id, followed_id)
select seed_user, real_user from personas;

insert into public.organizations (org_id, name, slug, is_platform, is_verified_nonprofit, verified_at, verification_method)
values ('00000000-0000-0000-0000-00000000d657', '[DEMO] step org', 'demo-step-org-0657', false, true, now(), 'demo_seed');

update public.kc_dev_demo_operation_state
   set operation = 'idle', phase = 'idle', aux = '{}'::jsonb, updated_at = now()
 where singleton;

do $$
declare
  p personas;
  s jsonb;
  n int := 0;
begin
  select * into p from personas;
  perform kc_test.act_as(p.super_admin);
  loop
    n := n + 1;
    s := public.admin_wipe_demo_data_step();
    exit when coalesce((s->>'done')::boolean, false) or n > 40;
  end loop;

  perform kc_test.assert_true(coalesce((s->>'done')::boolean, false), 'stepped wipe finishes');
  perform kc_test.assert_true((s->'result'->>'users_deleted')::int >= 1, 'the flagged seed user was deleted');
  perform kc_test.assert_true(not exists (select 1 from auth.users where id = p.seed_user), 'seed user is gone');
  perform kc_test.assert_true(not exists (select 1 from public.follow_edges where follower_id = p.seed_user), 'seed follow is gone');
  perform kc_test.assert_true(not exists (select 1 from public.organizations where slug = 'demo-step-org-0657'), 'demo nonprofit is gone');
  perform kc_test.assert_true(exists (select 1 from auth.users where id = p.real_user), 'a real user is untouched');
  perform kc_test.assert_eq(
    (select phase from public.kc_dev_demo_operation_state where singleton),
    'idle', 'operation state returns to idle');
end $$;

rollback;

\echo '✓ 0657_demo_data_portal_steps.sql passed'
