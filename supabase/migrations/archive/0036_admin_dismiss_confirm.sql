-- 0036_admin_dismiss_confirm | P2.2 / FR-ADMIN-003
-- admin_dismiss_report  — stamps a single open report as dismissed_no_violation,
--                         and cascades restore on the target if the dismissal
--                         drops the open-report distinct-reporter count below 3.
-- admin_confirm_report  — stamps a single open report as confirmed_violation;
--                         leaves any auto-removal in place.
--
-- Both: SECURITY DEFINER + is_admin(auth.uid()) gate + REVOKE FROM PUBLIC +
--       GRANT TO authenticated.
--
-- NEITHER RPC writes its own audit_events row. The existing AFTER trigger
-- reports_after_status_change_apply_effects (0005) is the single source of
-- truth for 'dismiss_report' / 'confirm_report' audit lines and supplies
-- richer metadata (reporter_id, target_type, target_id, reason) than these
-- RPCs would. Same lesson the BEFORE trigger taught us for resolved_at /
-- resolved_by.
--
-- DESIGN NOTES (post-review clarifications, do not "fix"):
--   1. admin_dismiss_report cascade restores ONLY when the target is in its
--      auto-removal terminal state ('removed_admin' for posts,
--      'suspended_admin' for users, removed_at IS NOT NULL for chats). It
--      intentionally does NOT lift 'suspended_for_false_reports' — that is a
--      sanction on the REPORTER imposed by 0039_sanction_trigger after 5
--      dismissed reports in 30 days, not an auto-removal of the user as a
--      target. Lifting it on a single dismiss would defeat the sanction.
--   2. The existing reports_after_status_change_apply_effects trigger (0005)
--      bumps users.false_reports_count for every dismissed report. With the
--      cascade enabled, one admin click can bump N reporters at once. This
--      is intentional: per FR-MOD-010 v0.3 the column is informational only;
--      the sanction trigger in 0039 uses a sliding-window count over
--      reports.sanction_consumed_at IS NULL, NOT this column. So bumping it
--      does NOT trigger sanctions. The column is kept for backward-compatible
--      denormalised reads only.

-- ── 1. admin_dismiss_report ─────────────────────────────────────────────────

create or replace function public.admin_dismiss_report(p_report_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_target_type text;
  v_target_id   uuid;
  v_distinct_open int;
  v_post_status text;
  v_user_status text;
  v_chat_removed timestamptz;
begin
  if v_actor is null or not public.is_admin(v_actor) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Lock the report row first so a concurrent dismissal can't race us.
  select target_type, target_id into v_target_type, v_target_id
    from public.reports
   where report_id = p_report_id and status = 'open'
   for update;
  if not found then
    raise exception 'report_not_open' using errcode = 'P0012';
  end if;

  -- Serialize concurrent dismissals against the same target so the cascade
  -- count(*) below sees a consistent view (mirrors the trigger lock pattern
  -- from 0039_sanction_trigger).
  if v_target_id is not null and v_target_type <> 'none' then
    perform pg_advisory_xact_lock(
      hashtext('mod_target_' || v_target_type || '_' || v_target_id::text)::bigint);
  end if;

  update public.reports
     set status = 'dismissed_no_violation'
   where report_id = p_report_id;
  -- resolved_at / resolved_by populated by reports_on_status_change BEFORE trigger (0005).
  -- audit row written by reports_after_status_change_apply_effects AFTER trigger (0005).

  -- Cascade restore if applicable (skip support-thread / no-target reports).
  if v_target_type = 'none' or v_target_id is null then
    return;
  end if;

  select count(distinct reporter_id) into v_distinct_open
    from public.reports
   where target_type = v_target_type
     and target_id   = v_target_id
     and status      = 'open';

  if v_distinct_open >= 3 then
    return;  -- still over threshold; auto-removal stands.
  end if;

  -- Below threshold AND target is in its auto-removal terminal state → restore.
  -- admin_restore_target (0035) is itself idempotent and emits its own
  -- 'restore_target' audit row.
  if v_target_type = 'post' then
    select status into v_post_status from public.posts where post_id = v_target_id;
    if v_post_status = 'removed_admin' then
      perform public.admin_restore_target('post', v_target_id);
    end if;
  elsif v_target_type = 'user' then
    select account_status into v_user_status from public.users where user_id = v_target_id;
    if v_user_status = 'suspended_admin' then
      perform public.admin_restore_target('user', v_target_id);
    end if;
  elsif v_target_type = 'chat' then
    select removed_at into v_chat_removed from public.chats where chat_id = v_target_id;
    if v_chat_removed is not null then
      perform public.admin_restore_target('chat', v_target_id);
    end if;
  end if;
end;
$$;

revoke execute on function public.admin_dismiss_report(uuid) from public;
grant  execute on function public.admin_dismiss_report(uuid) to authenticated;


-- ── 2. admin_confirm_report ─────────────────────────────────────────────────

create or replace function public.admin_confirm_report(p_report_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or not public.is_admin(v_actor) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.reports
     set status = 'confirmed_violation'
   where report_id = p_report_id and status = 'open';
  -- resolved_at / resolved_by populated by reports_on_status_change BEFORE trigger (0005).
  -- audit row written by reports_after_status_change_apply_effects AFTER trigger (0005).
  if not found then
    raise exception 'report_not_open' using errcode = 'P0012';
  end if;
end;
$$;

revoke execute on function public.admin_confirm_report(uuid) from public;
grant  execute on function public.admin_confirm_report(uuid) to authenticated;
