-- supabase/tests/0697_fsm_account_status_writers.sql
-- Wave 3a-2 (#1989): the report auto-action suspends only a live account — reporting an account
-- under deletion no longer fails — and the admin user search filters by the graph's states.
-- Runs in a rolled-back transaction.

begin;

create temp table personas as
select kc_test.create_user('w3b_live')    as live_member,
       kc_test.create_user('w3b_leaving') as leaving_member,
       kc_test.create_user('w3b_admin')   as admin,
       array(select kc_test.create_user('w3b_reporter_' || i) from generate_series(1, 5) i) as reporters;

update public.admin_role_grants set revoked_at = now()
 where role = 'super_admin' and revoked_at is null;
insert into public.admin_role_grants (user_id, role) select admin, 'super_admin' from personas;

-- Five distinct reporters report p_target (the D61 threshold for a user).
create function pg_temp.report_five_times(p_target uuid)
returns void
language plpgsql
as $$
declare
  v_reporter uuid;
begin
  foreach v_reporter in array (select reporters from personas) loop
    perform kc_test.act_as(v_reporter);
    insert into public.reports (reporter_id, target_type, target_id, reason)
    values (v_reporter, 'user', p_target, 'Spam');
  end loop;
end;
$$;

-- ── 1. A live account is suspended at the threshold, as before ──────────────────
do $$
declare
  p personas;
begin
  select * into p from personas;
  perform pg_temp.report_five_times(p.live_member);
  perform kc_test.assert_eq(
    (select account_status from public.users where user_id = p.live_member), 'suspended_admin',
    'five distinct reporters suspend a live account');
end $$;

-- ── 2. An account under deletion is not suspended, and the reports go through ───
do $$
declare
  p personas;
begin
  select * into p from personas;
  update public.users
     set account_status = 'pending_deletion', deletion_purge_at = now() + interval '30 days'
   where user_id = p.leaving_member;

  perform pg_temp.report_five_times(p.leaving_member);  -- raised before 0697
  perform kc_test.assert_eq(
    (select account_status from public.users where user_id = p.leaving_member), 'pending_deletion',
    'an account under deletion stays pending_deletion');
  perform kc_test.assert_eq(
    (select count(*) from public.reports where target_type = 'user' and target_id = p.leaving_member),
    5::bigint, 'every report on it is filed');
end $$;

-- ── 3. The admin search filters by pending_deletion ────────────────────────────
do $$
declare
  p personas;
begin
  select * into p from personas;
  perform kc_test.act_as(p.admin);
  perform kc_test.assert_true(
    exists (select 1 from public.admin_search_users(null, 'pending_deletion', 50, 0) u
             where u.user_id = p.leaving_member),
    'the pending_deletion filter lists the account under deletion');
end $$;

rollback;

\echo '✓ 0697_fsm_account_status_writers.sql passed'
