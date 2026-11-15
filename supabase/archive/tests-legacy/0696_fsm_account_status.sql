-- supabase/tests/0696_fsm_account_status.sql
-- Wave 3a (#1989): users.account_status follows the kernel machine `account_status`, with the
-- PM decisions of 2026-11-09 — a super admin lifts a ban, a report suspension lifts by the
-- rule that imposed it, a false-report sanction never replaces a heavier state. Runs in a
-- rolled-back transaction.

begin;

create temp table personas as
select kc_test.create_user('w3_super')     as super_admin,
       kc_test.create_user('w3_moderator') as moderator,
       kc_test.create_user('w3_member')    as member,
       kc_test.create_user('w3_reporter')  as reporter,
       kc_test.create_user('w3_leaving')   as leaving;

-- One active super admin (the revoke is rolled back with the rest) and one moderator.
update public.admin_role_grants set revoked_at = now()
 where role = 'super_admin' and revoked_at is null;
insert into public.admin_role_grants (user_id, role)
select super_admin, 'super_admin' from personas
union all select moderator, 'moderator' from personas;
-- `admin_ban_user` checks the legacy super-admin flag (0037).
update public.users set is_super_admin = true where user_id = (select super_admin from personas);

-- Runs p_sql and returns its error message, or null.
create function pg_temp.error_of(p_sql text)
returns text
language plpgsql
as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end;
$$;

create function pg_temp.status_of(p_user uuid) returns text
language sql as $$ select account_status from public.users where user_id = p_user $$;

-- ── 1. The graph ───────────────────────────────────────────────────────────────
do $$
declare
  p personas;
begin
  select * into p from personas;
  update public.users set account_status = 'banned' where user_id = p.member;
  perform kc_test.assert_eq(
    pg_temp.error_of(format(
      'update public.users set account_status = %L where user_id = %L', 'suspended_for_false_reports', p.member)),
    'account_status_transition_invalid', 'a ban is not replaced by a false-report sanction');
  update public.users set account_status = 'banned' where user_id = p.member; -- same status: a no-op
  update public.users set account_status = 'active' where user_id = p.member; -- a lifted ban
  perform kc_test.assert_eq(pg_temp.status_of(p.member), 'active', 'banned -> active is an edge');
end $$;

-- ── 2. An account under deletion is neither banned nor sanctioned ──────────────
do $$
declare
  p personas;
begin
  select * into p from personas;
  update public.users
     set account_status = 'pending_deletion', deletion_purge_at = now() + interval '30 days'
   where user_id = p.leaving;

  perform kc_test.act_as(p.super_admin);
  perform kc_test.assert_eq(
    pg_temp.error_of(format('select public.admin_ban_user(%L, %L, null)', p.leaving, 'spam')),
    'account_pending_deletion', 'admin_ban_user refuses an account under deletion');
  perform kc_test.assert_eq(pg_temp.status_of(p.leaving), 'pending_deletion', 'the deletion stands');
end $$;

-- ── 3. Lifting a ban is a super admin's; a moderator restores a suspension ─────
do $$
declare
  p personas;
begin
  select * into p from personas;
  update public.users set account_status = 'banned' where user_id = p.member;

  perform kc_test.act_as(p.moderator);
  perform kc_test.assert_true(
    pg_temp.error_of(format('select public.admin_restore_target(%L, %L)', 'user', p.member)) is not null,
    'a moderator cannot lift a ban');
  perform kc_test.assert_eq(pg_temp.status_of(p.member), 'banned', 'the ban stands');

  perform kc_test.act_as(p.super_admin);
  perform public.admin_restore_target('user', p.member);
  perform kc_test.assert_eq(pg_temp.status_of(p.member), 'active', 'a super admin lifts the ban');

  -- The open-ended third false-report level has no timer: a moderator restore lifts it.
  update public.users
     set account_status = 'suspended_for_false_reports', account_status_until = null
   where user_id = p.member;
  perform kc_test.act_as(p.moderator);
  perform public.admin_restore_target('user', p.member);
  perform kc_test.assert_eq(pg_temp.status_of(p.member), 'active', 'a moderator lifts a level-3 sanction');
end $$;

-- ── 4. A false-report sanction leaves a heavier status alone ───────────────────
do $$
declare
  p personas;
  i int;
begin
  select * into p from personas;
  perform kc_test.act_as(p.reporter);
  for i in 1..5 loop
    insert into public.reports (reporter_id, target_type, target_id, reason)
    values (p.reporter, 'none', null, 'Other');
  end loop;
  update public.users set account_status = 'banned' where user_id = p.reporter;

  perform kc_test.act_as(p.super_admin);
  update public.reports set status = 'dismissed_no_violation' where reporter_id = p.reporter;

  perform kc_test.assert_eq(pg_temp.status_of(p.reporter), 'banned', 'the ban is not replaced by a sanction');
  perform kc_test.assert_eq(
    (select false_report_sanction_count from public.users where user_id = p.reporter), 1,
    'the sanction level still counts');
end $$;

rollback;

\echo '✓ 0696_fsm_account_status.sql passed'
