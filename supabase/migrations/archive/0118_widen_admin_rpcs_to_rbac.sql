-- 0118_widen_admin_rpcs_to_rbac | FR-ADMIN-012, FR-ADMIN-013
-- Widen 3 moderation RPCs from is_admin(uid) to admin_assert_role([super_admin, moderator]).
-- admin_ban_user / admin_delete_message stay super_admin only (per PERMISSION_MATRIX).
-- admin_restore_target widens AND drops cascade-dismiss in 0119 (TD-94).
--
-- Existing semantics preserved verbatim:
--   admin_remove_post     (0020 + 0097): snapshots status_before_admin_removal,
--                                        only acts on open/closed_delivered/deleted_no_recipient.
--   admin_dismiss_report  (0036): SQLSTATE P0012 (report_not_open), advisory
--                                 transaction lock per target, cascade restore
--                                 if open distinct-reporter count drops below 3.
--                                 NO direct audit row — AFTER trigger writes it.
--   admin_confirm_report  (0036): SQLSTATE P0012, no direct audit row.

-- ── 1. admin_remove_post ────────────────────────────────────────────────────
create or replace function public.admin_remove_post(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  perform public.admin_assert_role(v_actor, array['super_admin','moderator']);

  update public.posts
     set status_before_admin_removal = status,
         status = 'removed_admin',
         updated_at = now()
   where post_id = p_post_id
     and status <> 'removed_admin'
     and status in ('open', 'closed_delivered', 'deleted_no_recipient');

  if not found then
    -- Already removed, doesn't exist, or in a terminal state we don't touch.
    -- Quiet no-op preserves legacy idempotency contract (no audit row written).
    return;
  end if;

  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (v_actor, 'manual_remove_target', 'post', p_post_id, '{}'::jsonb);
end;
$$;

revoke execute on function public.admin_remove_post(uuid) from public;
grant  execute on function public.admin_remove_post(uuid) to authenticated;


-- ── 2. admin_dismiss_report ─────────────────────────────────────────────────
-- Semantics preserved from 0036:
--   * lock report row FOR UPDATE
--   * SQLSTATE P0012 when not open
--   * advisory xact lock per (target_type, target_id) for cascade serialization
--   * cascade-restore when distinct open reporters drops below 3 AND target is
--     in its auto-removal terminal state
--   * NO direct audit row (the AFTER trigger in 0005 writes 'dismiss_report'
--     with richer metadata)
create or replace function public.admin_dismiss_report(p_report_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_target_type   text;
  v_target_id     uuid;
  v_distinct_open int;
  v_post_status   text;
  v_user_status   text;
  v_chat_removed  timestamptz;
begin
  perform public.admin_assert_role(v_actor, array['super_admin','moderator']);

  select target_type, target_id into v_target_type, v_target_id
    from public.reports
   where report_id = p_report_id and status = 'open'
   for update;
  if not found then
    raise exception 'report_not_open' using errcode = 'P0012';
  end if;

  if v_target_id is not null and v_target_type <> 'none' then
    perform pg_advisory_xact_lock(
      hashtext('mod_target_' || v_target_type || '_' || v_target_id::text)::bigint);
  end if;

  update public.reports
     set status = 'dismissed_no_violation'
   where report_id = p_report_id;
  -- resolved_at / resolved_by populated by reports_on_status_change BEFORE trigger (0005).
  -- audit row written by reports_after_status_change_apply_effects AFTER trigger (0005).

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

  -- Below threshold AND target is in auto-removal terminal state → restore.
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


-- ── 3. admin_confirm_report ─────────────────────────────────────────────────
-- Semantics preserved from 0036: SQLSTATE P0012 (report_not_open), no direct
-- audit row (AFTER trigger writes 'confirm_report' with richer metadata).
create or replace function public.admin_confirm_report(p_report_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  perform public.admin_assert_role(v_actor, array['super_admin','moderator']);

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
