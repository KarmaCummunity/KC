-- 0035_admin_restore_target | P2.2 / FR-ADMIN-002
-- Reverses auto-removal performed by reports_after_insert_apply_effects:
--   post → 'open'  (only if currently 'removed_admin')
--   user → 'active' (ONLY if currently 'suspended_admin'; banned/deleted/false-
--                    reports states are rejected with invalid_restore_state)
--   chat → removed_at = null
-- Stamps every still-open report on the target as dismissed_no_violation.
-- Idempotent: re-running on already-restored target is a quiet no-op.

create or replace function public.admin_restore_target(
  p_target_type text,
  p_target_id   uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_changed boolean := false;
begin
  if v_actor is null or not public.is_admin(v_actor) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
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
    -- Only suspended_admin is restorable via this path.
    -- 'active' included so re-running on an already-restored user is a quiet
    -- no-op (the conditional UPDATE below matches 0 rows), not an error.
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

  -- Stamp all open reports on the target.
  -- resolved_at / resolved_by populated by reports_on_status_change BEFORE trigger.
  update public.reports
     set status = 'dismissed_no_violation'
   where target_type = p_target_type
     and target_id   = p_target_id
     and status      = 'open';
  -- Side-effect: the existing reports_after_status_change_apply_effects
  -- trigger (defined in 0005) increments users.false_reports_count for each
  -- reporter whose row we just stamped. This is intentional — the admin's
  -- restore decision is the moderator's signal that those reports were
  -- not violations — but it cascades sanction pressure onto reporters.
  -- The UI confirmation copy in admin actions modals must call this out.

  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (v_actor, 'restore_target', p_target_type, p_target_id, '{}'::jsonb);
end;
$$;

revoke execute on function public.admin_restore_target(text, uuid) from public;
grant  execute on function public.admin_restore_target(text, uuid) to authenticated;

-- ── Hardening: posts_enforce_active_cap must NOT block admin restore ──────
-- The cap trigger from 0002 re-checks the 20-active-posts limit whenever a
-- post's status changes to 'open'. When admin_restore_target flips a post
-- from 'removed_admin' back to 'open', that's a moderation reversal — not a
-- user creating a 21st post — so we exempt the transition.
create or replace function public.posts_enforce_active_cap()
returns trigger language plpgsql as $$
declare
  active_n int;
begin
  -- Admin restore exemption: removed_admin → open is moderation, not creation.
  if tg_op = 'UPDATE' and old.status = 'removed_admin' and new.status = 'open' then
    return new;
  end if;
  if new.status = 'open' and (tg_op = 'INSERT' or old.status <> 'open') then
    select count(*) into active_n
    from public.posts
    where owner_id = new.owner_id and status = 'open';
    if active_n >= 20 then
      raise exception 'active_post_limit_exceeded'
        using errcode = 'check_violation', detail = 'limit=20';
    end if;
  end if;
  return new;
end;
$$;
