-- supabase/tests/0700_fsm_reports_follow_requests.sql
-- Wave 4a (#1989): reports and follow requests follow the kernel machines `report` and
-- `follow_request`. A report resolves once; a follow request resolves once, by its parties or by
-- the server (block cleanup, auto-accept on going public). Runs in a rolled-back transaction.

begin;

create temp table personas as
select kc_test.create_user('w4a_admin')     as admin,
       kc_test.create_user('w4a_reporter')  as reporter,
       kc_test.create_user('w4a_private')   as private_member,
       kc_test.create_user('w4a_follower')  as follower,
       kc_test.create_user('w4a_blocked')   as blocked,
       kc_test.create_user('w4a_late')      as late_follower;

update public.users set privacy_mode = 'Private' where user_id = (select private_member from personas);

-- ── 1. A report resolves once ──────────────────────────────────────────────────
do $$
declare
  p personas;
  v_report uuid;
begin
  select * into p from personas;
  perform kc_test.act_as(p.reporter);
  insert into public.reports (reporter_id, target_type, target_id, reason)
  values (p.reporter, 'none', null, 'Other')
  returning report_id into v_report;

  perform kc_test.act_as(p.admin);
  update public.reports set status = 'open' where report_id = v_report; -- same status: a no-op
  update public.reports set status = 'confirmed_violation' where report_id = v_report;
  perform kc_test.assert_true(
    (select resolved_at is not null and resolved_by = p.admin from public.reports where report_id = v_report),
    'resolving stamps resolved_at and resolved_by');

  perform kc_test.assert_raises(
    format('update public.reports set status = %L where report_id = %L', 'dismissed_no_violation', v_report),
    'invalid_report_status_transition', 'a confirmed report is not turned into a dismissal');
  perform kc_test.assert_raises(
    format('update public.reports set status = %L where report_id = %L', 'open', v_report),
    'invalid_report_status_transition', 'a resolved report is not reopened');
end $$;

-- ── 2. A follow request resolves once, by its parties ──────────────────────────
do $$
declare
  p personas;
begin
  select * into p from personas;
  insert into public.follow_requests (requester_id, target_id) values (p.follower, p.private_member);
  update public.follow_requests set status = 'accepted'
   where requester_id = p.follower and target_id = p.private_member;
  perform kc_test.assert_true(public.is_following(p.follower, p.private_member), 'accepting creates the follow edge');

  perform kc_test.assert_raises(
    format('update public.follow_requests set status = %L where requester_id = %L', 'pending', p.follower),
    'follow_request_transition_invalid', 'an accepted request is not reopened');
  perform kc_test.assert_raises(
    format('update public.follow_requests set status = %L where requester_id = %L', 'cancelled', p.follower),
    'follow_request_transition_invalid', 'an accepted request is not cancelled afterwards');
end $$;

-- ── 3. The server resolves pending requests through the same graph ─────────────
do $$
declare
  p personas;
begin
  select * into p from personas;
  insert into public.follow_requests (requester_id, target_id) values (p.blocked, p.private_member);
  insert into public.blocks (blocker_id, blocked_id) values (p.private_member, p.blocked);
  perform kc_test.assert_eq(
    (select status from public.follow_requests where requester_id = p.blocked), 'cancelled',
    'a block cancels the pending request');

  insert into public.follow_requests (requester_id, target_id) values (p.late_follower, p.private_member);
  update public.users set privacy_mode = 'Public' where user_id = p.private_member;
  perform kc_test.assert_eq(
    (select status from public.follow_requests where requester_id = p.late_follower), 'accepted',
    'going public accepts the pending request');
end $$;

rollback;

\echo '✓ 0700_fsm_reports_follow_requests.sql passed'
