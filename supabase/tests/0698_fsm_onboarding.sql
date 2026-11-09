-- supabase/tests/0698_fsm_onboarding.sql
-- Wave 3b (#1989): users.onboarding_state follows the kernel machine `onboarding`. A member moves
-- forward only, through rpc_set_onboarding_state, and leaves step 1 only with name, city and date
-- of birth on file; the developer reset works on a dev database alone. Runs in a rolled-back
-- transaction.

begin;

create temp table personas as
select kc_test.create_user('w3b_onb_direct') as direct_member,
       kc_test.create_user('w3b_onb_member') as member;

-- A dev-only check below inserts the kc-dev marker; this transaction starts without it (CI).
create function pg_temp.stage_of(p_user uuid) returns text
language sql as $$ select onboarding_state from public.users where user_id = p_user $$;

-- ── 1. The graph holds for every writer ────────────────────────────────────────
do $$
declare
  p personas;
begin
  select * into p from personas;
  update public.users set onboarding_state = 'completed' where user_id = p.direct_member;
  update public.users set onboarding_state = 'completed' where user_id = p.direct_member; -- same stage: a no-op
  perform kc_test.assert_raises(
    format('update public.users set onboarding_state = %L where user_id = %L', 'pending_avatar', p.direct_member),
    'onboarding_transition_invalid', 'completed never returns to the photo step');
  perform kc_test.assert_raises(
    format('update public.users set onboarding_state = %L where user_id = %L', 'pending_basic_info', p.direct_member),
    'onboarding_transition_invalid', 'step 1 is reached back only through the developer reset');
  perform kc_test.assert_eq(pg_temp.stage_of(p.direct_member), 'completed', 'the stage stands');
end $$;

-- ── 2. The member's write path ─────────────────────────────────────────────────
do $$
declare
  p personas;
begin
  select * into p from personas;
  update public.users set city = '5000', city_name = 'תל אביב - יפו' where user_id = p.member;

  perform kc_test.act_as(p.member);
  perform kc_test.assert_raises(
    $q$select public.rpc_set_onboarding_state('pending_avatar')$q$,
    'onboarding_basic_info_missing', 'step 1 is not left without a date of birth');

  perform public.rpc_set_date_of_birth(date '1990-05-15');
  perform public.rpc_set_onboarding_state('pending_avatar');
  perform kc_test.assert_eq(pg_temp.stage_of(p.member), 'pending_avatar', 'basic info done');
  perform public.rpc_set_onboarding_state('pending_avatar');
  perform public.rpc_set_onboarding_state('completed');
  perform kc_test.assert_eq(pg_temp.stage_of(p.member), 'completed', 'the photo step may be skipped');

  perform kc_test.assert_raises(
    $q$select public.rpc_set_onboarding_state('pending_basic_info')$q$,
    'onboarding_transition_invalid', 'a member never moves back');
  perform kc_test.assert_raises(
    $q$select public.rpc_set_onboarding_state('finished')$q$,
    'onboarding_transition_invalid', 'an unknown stage is refused');
end $$;

-- ── 3. The developer reset needs a dev database ────────────────────────────────
do $$
declare
  p personas;
begin
  select * into p from personas;
  perform kc_test.act_as(p.member);
  if not exists (select 1 from public.kc_dev_demo_config) then
    perform kc_test.assert_raises(
      'select public.rpc_dev_reset_onboarding()',
      'onboarding_reset_dev_only', 'the reset is refused outside kc-dev');
    insert into public.kc_dev_demo_config (password_hash) values (null);
  end if;

  update public.users set basic_info_skipped = true where user_id = p.member;
  perform public.rpc_dev_reset_onboarding();
  perform kc_test.assert_eq(pg_temp.stage_of(p.member), 'pending_basic_info', 'the reset returns to step 1');
  perform kc_test.assert_eq(
    (select basic_info_skipped from public.users where user_id = p.member), false, 'and clears the skip flag');
  perform kc_test.assert_eq(
    coalesce(current_setting('kc.onboarding_reset', true), ''), '', 'the reset role ends with its update');
end $$;

-- ── 4. The client cannot write the stage directly ──────────────────────────────
do $$
begin
  perform kc_test.assert_true(
    not has_column_privilege('authenticated', 'public.users', 'onboarding_state', 'UPDATE'),
    'authenticated has no UPDATE on users.onboarding_state');
  perform kc_test.assert_true(
    has_column_privilege('authenticated', 'public.users', 'basic_info_skipped', 'UPDATE'),
    'the skip flag stays client-writable (FR-AUTH-010 AC3)');
end $$;

rollback;

\echo '✓ 0698_fsm_onboarding.sql passed'
