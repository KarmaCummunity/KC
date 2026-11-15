-- 0128_admin_restore_target_audit_parity | FR-ADMIN-007 — closes TD-94 (5)
--
-- Symmetry fix: auto_remove_target writes metadata {distinct_reporters: N}
-- (see reports_after_insert_apply_effects in 0125). The companion
-- restore_target audit row was written with metadata='{}'::jsonb in 0119,
-- which leaves an admin investigating a target's timeline with no record
-- of who flagged it. This migration collects the list of distinct reporter
-- UUIDs from the still-open reports at the moment of restore and stores
-- them in the audit metadata under 'distinct_reporters'.
--
-- Why the same key name as auto_remove_target: the audit timeline renderer
-- (FR-ADMIN-007) can read 'distinct_reporters' uniformly across both
-- events — auto-removal stores a count (int), restore stores the actual
-- UUID array. That asymmetry is fine for now; widening auto-removal to
-- also write UUIDs is a separate ticket (it requires changing the
-- before/after parity check across upstream consumers).
--
-- Deterministic ordering: array_agg(distinct reporter_id) without an
-- explicit ORDER BY can vary by plan. We sort by reporter_id so the audit
-- row is byte-identical when the same set of reporters resolved. (The
-- timeline renderer doesn't care about order, but byte-identical metadata
-- helps audit-log diffing tools.)
--
-- Edge case: if all open reports have already been dismissed by the time
-- the admin clicks restore, v_reporters is array[]::uuid[] → metadata
-- contains an empty 'distinct_reporters' array. That's the correct truth
-- — there were no remaining unresolved reporters at restore time.
--
-- Every other semantic from 0119 is preserved verbatim:
--   * RBAC gate via admin_assert_role([super_admin, moderator]).
--   * Target-type validation (P0010), target-existence check (P0017).
--   * 'user' restoration only from 'suspended_admin' (P0011 otherwise).
--   * Idempotent no-op when target is already in restored state.
--   * NO cascade dismiss of open reports (TD-94 fix from 0119 holds).

create or replace function public.admin_restore_target(
  p_target_type text,
  p_target_id   uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor     uuid := auth.uid();
  v_changed   boolean := false;
  v_reporters uuid[];
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

  -- TD-94 (5) audit parity: collect the open reporters at the moment of
  -- restore. Ordered by reporter_id for deterministic audit-row bytes.
  select coalesce(array_agg(distinct reporter_id order by reporter_id),
                  array[]::uuid[])
    into v_reporters
    from public.reports
   where target_type = p_target_type
     and target_id   = p_target_id
     and status      = 'open';

  -- TD-94 fix (0119): do NOT touch other open reports on this target. Each
  -- case is reviewed independently via admin_dismiss_report /
  -- admin_confirm_report.

  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (v_actor, 'restore_target', p_target_type, p_target_id,
          jsonb_build_object('distinct_reporters', to_jsonb(v_reporters)));
end;
$$;

revoke execute on function public.admin_restore_target(text, uuid) from public;
grant  execute on function public.admin_restore_target(text, uuid) to authenticated;
