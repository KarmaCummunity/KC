-- Moderation · resolving a report (FR-ADMIN-003, FR-ADMIN-013, FR-MOD-010, D134)
--
-- A moderator closes one report at a time; each case is independent (FR-ADMIN-013 AC3).
--   confirm   the report was right. A post hidden for review is removed; a suspension stands.
--   dismiss   the report was wrong. It counts against its reporter, and when the reports
--             still open no longer meet the threshold, the automatic action is undone.
-- Errors: forbidden (42501); P0001 — report_not_open.

-- Locks an open report, stamps the outcome and audits it.
create function kc_private.report_resolve(p_report_id uuid, p_status text, p_actor uuid)
returns public.reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report public.reports;
begin
  select r.* into v_report from public.reports r where r.id = p_report_id and r.status = 'open' for update;
  if not found then
    raise exception 'report_not_open' using errcode = 'P0001';
  end if;
  -- Same lock as a new report on the target takes: the threshold is judged on settled data.
  perform pg_advisory_xact_lock(
    hashtextextended('report:' || v_report.target_type || ':' || v_report.target_id, 0));

  perform set_config('kc.fsm_role', 'admin', true);
  update public.reports r set status = p_status, resolved_at = now(), resolved_by = p_actor
   where r.id = p_report_id;
  perform set_config('kc.fsm_role', '', true);
  perform kc_private.audit_record(
    case p_status when 'confirmed_violation' then 'confirm_report' else 'dismiss_report' end,
    'report', p_report_id,
    jsonb_build_object('target_type', v_report.target_type, 'target_id', v_report.target_id), p_actor);
  return v_report;
end;
$$;

create function public.admin_confirm_report(p_report_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.require_admin_role('moderator');
  v_report constant public.reports := kc_private.report_resolve(p_report_id, 'confirmed_violation', v_actor);
begin
  -- The review of a hidden post ends here: a confirmed violation removes it.
  if v_report.target_type = 'post' and exists (
       select 1 from public.posts p where p.id = v_report.target_id and p.status = 'hidden_pending_review') then
    perform kc_private.moderation_remove_post(v_report.target_id, v_actor);
  end if;
end;
$$;
comment on function public.admin_confirm_report(uuid) is
  'Staff: marks an open report as a confirmed violation; a post hidden for review is removed.';
grant execute on function public.admin_confirm_report(uuid) to authenticated;

create function public.admin_dismiss_report(p_report_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.require_admin_role('moderator');
  v_report constant public.reports := kc_private.report_resolve(p_report_id, 'dismissed_no_violation', v_actor);
begin
  perform kc_private.apply_false_report_sanction(v_report.reporter_id);

  -- The automatic action stands while the rule that imposed it still holds (D134).
  if kc_private.report_threshold_reached(v_report.target_type, v_report.target_id) then
    return;
  end if;

  if v_report.target_type = 'post' then
    if exists (select 1 from public.posts p
                where p.id = v_report.target_id and p.status = 'hidden_pending_review') then
      perform kc_private.moderation_restore_post(v_report.target_id, v_actor);
    end if;
  elsif v_report.target_type = 'user' then
    -- Only the suspension the report rule imposed is lifted, never one a staff member issued.
    if exists (select 1 from public.user_account a
                 join public.user_sanctions s on s.user_id = a.user_id and s.lifted_at is null
                where a.user_id = v_report.target_id and a.status = 'suspended_admin'
                  and s.reason = 'report_threshold') then
      perform kc_private.account_restore(v_report.target_id, v_actor, 'report_dismissed');
    end if;
  elsif v_report.target_type = 'chat' then
    perform kc_private.outbox_enqueue('moderation_target', jsonb_build_object(
      'kind', 'restore', 'target_type', 'chat', 'target_id', v_report.target_id));
  end if;
  perform kc_private.moderation_queue_close(
    v_report.target_type, v_report.target_id, v_actor, 'report_threshold');
end;
$$;
comment on function public.admin_dismiss_report(uuid) is
  'Staff: dismisses an open report; counts it against the reporter and lifts an automatic action that no longer holds.';
grant execute on function public.admin_dismiss_report(uuid) to authenticated;
