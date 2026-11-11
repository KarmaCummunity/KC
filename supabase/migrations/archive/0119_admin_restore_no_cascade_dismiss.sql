-- 0119_admin_restore_no_cascade_dismiss | FR-ADMIN-013 AC3 — closes TD-94
--
-- admin_restore_target previously (0035) stamped every still-open report on
-- the restored target as 'dismissed_no_violation'. That cascade is the TD-94
-- bug: each open report represents an independent reporter's complaint and
-- must be reviewed individually. Restoring the target tells us the auto-
-- removal was wrong, but it does NOT tell us each underlying report was a
-- false report.
--
-- This migration:
--   * widens the role check from is_admin() to admin_assert_role([super_admin,
--     moderator]) per FR-ADMIN-012 / PERMISSION_MATRIX.
--   * removes the `update public.reports set status = 'dismissed_no_violation'`
--     block. All other semantics from 0035 (existence checks, idempotent
--     no-op, single 'restore_target' audit row, P0017/P0011 SQLSTATEs) are
--     preserved verbatim.

create or replace function public.admin_restore_target(
  p_target_type text,
  p_target_id   uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor   uuid := auth.uid();
  v_changed boolean := false;
begin
  perform public.admin_assert_role(v_actor, array['super_admin','moderator']);

  if p_target_type not in ('post','user','chat') then
    raise exception 'invalid_target_type' using errcode = 'P0010';
  end if;

  -- Existence check up-front so typos don't silently succeed.
  if p_target_type = 'post' then
    if not exists (select 1 from public.posts where post_id = p_target_id) then
      raise exception 'target_not_found' using errcode = 'P0017', detail = 'post';
    end if;
  elsif p_target_type = 'user' then
    if not exists (select 1 from public.users where user_id = p_target_id) then
      raise exception 'target_not_found' using errcode = 'P0017', detail = 'user';
    end if;
  elsif p_target_type = 'chat' then
    if not exists (select 1 from public.chats where chat_id = p_target_id) then
      raise exception 'target_not_found' using errcode = 'P0017', detail = 'chat';
    end if;
  end if;

  if p_target_type = 'post' then
    update public.posts set status = 'open', updated_at = now()
     where post_id = p_target_id and status = 'removed_admin';
    v_changed := found;
  elsif p_target_type = 'user' then
    -- Only suspended_admin is restorable via this path. 'active' is included
    -- so re-running on an already-restored user is a quiet no-op.
    if exists (select 1 from public.users
               where user_id = p_target_id
                 and account_status not in ('suspended_admin','active')) then
      raise exception 'invalid_restore_state'
        using errcode = 'P0011', detail = 'user not in suspended_admin state';
    end if;
    update public.users set account_status = 'active'
     where user_id = p_target_id and account_status = 'suspended_admin';
    v_changed := found;
  elsif p_target_type = 'chat' then
    update public.chats set removed_at = null
     where chat_id = p_target_id and removed_at is not null;
    v_changed := found;
  end if;

  if not v_changed then
    return;  -- idempotent no-op
  end if;

  -- TD-94 fix: do NOT touch other open reports on this target. Each case is
  -- reviewed independently via admin_dismiss_report / admin_confirm_report.
  -- The previous cascade also indirectly bumped false_reports_count for every
  -- reporter via the AFTER trigger; removing the cascade removes that side
  -- effect, which is the intended behaviour.

  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (v_actor, 'restore_target', p_target_type, p_target_id, '{}'::jsonb);
end;
$$;

revoke execute on function public.admin_restore_target(text, uuid) from public;
grant  execute on function public.admin_restore_target(text, uuid) to authenticated;
