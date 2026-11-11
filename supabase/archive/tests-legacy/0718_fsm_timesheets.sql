-- supabase/tests/0718_fsm_timesheets.sql
-- Wave 5 (#1989): admin timesheet entries follow the kernel machine `timesheet`.
-- Runs in a rolled-back transaction.

begin;

create temp table personas as
select kc_test.create_user('w5_author')   as author,
       kc_test.create_user('w5_approver') as approver;

insert into public.admin_role_grants (user_id, role)
select author, 'support' from personas
union all
select approver, 'moderator' from personas;

-- ── 1. The RPCs walk the graph: draft → submitted → rejected → draft → submitted → approved ──
do $$
declare
  p personas;
  v uuid;
begin
  select * into p from personas;

  perform kc_test.act_as(p.author);
  v := public.timesheet_upsert(null, current_date, 450, 'W5 project', 'Timesheet walk');
  perform public.timesheet_submit(v);

  perform kc_test.act_as(p.approver);
  perform public.timesheet_reject(v, 'Split the hours by project');

  -- Editing a rejected entry is its move back to draft.
  perform kc_test.act_as(p.author);
  perform public.timesheet_upsert(v, null, 400, null, null);
  perform kc_test.assert_eq(
    (select status from public.timesheet_entries where entry_id = v), 'draft',
    'an edited rejection is a draft again');
  perform public.timesheet_submit(v);

  perform kc_test.act_as(p.approver);
  perform public.timesheet_approve(v, null);
  perform kc_test.assert_eq(
    (select status from public.timesheet_entries where entry_id = v), 'approved',
    'the resubmitted entry is approved');
end $$;

-- ── 2. Any other writer is held to the same graph ──────────────────────────────
do $$
declare
  p personas;
  v uuid;
begin
  select * into p from personas;
  insert into public.timesheet_entries (user_id, work_date, hours_x100)
  values (p.author, current_date, 100) returning entry_id into v;

  perform kc_test.assert_raises(
    format('update public.timesheet_entries set status = %L where entry_id = %L', 'approved', v),
    'timesheet_transition_invalid', 'a draft is not approved without being submitted');

  update public.timesheet_entries set status = 'submitted' where entry_id = v;
  perform kc_test.assert_raises(
    format('update public.timesheet_entries set status = %L where entry_id = %L', 'draft', v),
    'timesheet_transition_invalid', 'a submitted entry is not pulled back to draft');

  update public.timesheet_entries set status = 'approved' where entry_id = v;
  perform kc_test.assert_raises(
    format('update public.timesheet_entries set status = %L where entry_id = %L', 'rejected', v),
    'timesheet_transition_invalid', 'an approval is final');

  -- A same-status write is not a transition.
  update public.timesheet_entries set status = 'approved' where entry_id = v;
end $$;

rollback;
