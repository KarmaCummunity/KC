-- 0075_recipient_unmark_self | FR-CLOSURE-007, TD-120
-- Allows the credited recipient to remove their own mark from a closed_delivered post.
--
-- Flow:
--   1. Caller must be the active recipient on this post (verified inside RPC).
--   2. DELETE recipients row
--        → trigger recipients_after_delete_counters: items_received_count -1 for recipient
--        → trigger tg_recipients_enqueue_notifications: Critical notif to post owner
--   3. Explicitly decrement owner's items_given_count (posts trigger only fires on →open).
--   4. UPDATE post: closed_delivered → deleted_no_recipient, delete_after = now()+7d.
--   5. Write audit event.

-- ── 1. Extend audit_events action enum ───────────────────────────────────────
alter table public.audit_events
  add constraint audit_events_action_check_v3 check (action in (
    'block_user','unblock_user',
    'report_target',
    'auto_remove_target','manual_remove_target','restore_target',
    'suspend_user','unsuspend_user',
    'ban_user',
    'false_report_sanction_applied',
    'dismiss_report','confirm_report',
    'delete_message',
    'delete_account',
    'unmark_recipient_self'
  )) not valid;

alter table public.audit_events validate constraint audit_events_action_check_v3;
alter table public.audit_events drop constraint if exists audit_events_action_check;
alter table public.audit_events rename constraint audit_events_action_check_v3 to audit_events_action_check;

-- ── 2. RPC ────────────────────────────────────────────────────────────────────
create or replace function public.rpc_recipient_unmark_self(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller   uuid    := auth.uid();
  v_owner_id uuid;
  v_post_type text;
begin
  if v_caller is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Verify caller is the active recipient and post is closed_delivered.
  select p.owner_id, p.type
    into v_owner_id, v_post_type
    from public.posts p
    join public.recipients r on r.post_id = p.post_id
   where p.post_id   = p_post_id
     and p.status    = 'closed_delivered'
     and r.recipient_user_id = v_caller;

  if not found then
    raise exception 'not_recipient_or_wrong_status' using errcode = 'P0001';
  end if;

  -- Delete recipient row (triggers fire: items_received -1 + notification to owner).
  delete from public.recipients
   where post_id = p_post_id
     and recipient_user_id = v_caller;

  -- Decrement owner's items_given_count (posts trigger doesn't cover closed→deleted).
  -- Give post: owner gave → decrement items_given.
  -- Request post: owner received → decrement items_received.
  if v_post_type = 'Give' then
    update public.users
       set items_given_count = public.stats_safe_dec(items_given_count)
     where user_id = v_owner_id;
  else
    update public.users
       set items_received_count = public.stats_safe_dec(items_received_count)
     where user_id = v_owner_id;
  end if;

  -- Transition post to deleted_no_recipient, give owner 7 days to reopen/re-mark.
  update public.posts
     set status       = 'deleted_no_recipient',
         delete_after = now() + interval '7 days'
   where post_id = p_post_id;

  -- Audit trail.
  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (
    v_caller,
    'unmark_recipient_self',
    'post',
    p_post_id,
    jsonb_build_object('owner_id', v_owner_id)
  );
end $$;

revoke execute on function public.rpc_recipient_unmark_self(uuid) from public;
grant  execute on function public.rpc_recipient_unmark_self(uuid) to authenticated;
