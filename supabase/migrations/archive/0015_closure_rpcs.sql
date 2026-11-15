-- 0015_closure_rpcs | P0.6 — Closure flow RPCs (FR-CLOSURE-003, FR-CLOSURE-005)
--
-- Two atomic functions for the multi-table closure transitions:
--   1. close_post_with_recipient(p_post_id, p_recipient_user_id)
--      INSERT recipients row + UPDATE posts.status = 'closed_delivered'.
--      Triggers cascade: items_received +1 (recipients_after_insert_counters),
--      items_given +1 (posts_after_update_counters in 0006).
--   2. reopen_post_marked(p_post_id)
--      DELETE recipients row + UPDATE posts.status = 'open' (reopen_count++).
--      Triggers cascade: items_received −1, items_given −1.
--
-- Single-table transitions stay as plain UPDATEs from the client:
--   • close without recipient → UPDATE posts SET status='deleted_no_recipient', delete_after=now()+'7 days'.
--   • reopen of deleted_no_recipient → UPDATE posts SET status='open', delete_after=null.
--
-- All functions are SECURITY INVOKER — they rely on the existing 0002 RLS:
-- posts_update_owner (UPDATE), recipients_insert_owner (INSERT),
-- recipients_delete_participants (DELETE). The function's own checks
-- give callers a clean error code rather than an opaque RLS rejection.
--
-- Errors map to client PostError codes via SQLSTATE P0001 + the message
-- text. SupabasePostRepository.mapClosurePgError reads the message and
-- emits the matching PostError code.

set search_path = public;

-- ── 1. close_post_with_recipient ────────────────────────────────────────────
create or replace function public.close_post_with_recipient(
  p_post_id uuid,
  p_recipient_user_id uuid
)
returns public.posts
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_owner   uuid;
  v_status  text;
  v_post    public.posts;
  v_chat_ok boolean;
begin
  -- Lock the post row to serialize concurrent close attempts.
  select owner_id, status into v_owner, v_status
    from public.posts
   where post_id = p_post_id
   for update;

  if v_owner is null then
    raise exception 'closure_wrong_status' using errcode = 'P0001';
  end if;
  if v_owner <> auth.uid() then
    raise exception 'closure_not_owner' using errcode = 'P0001';
  end if;
  if v_status <> 'open' then
    raise exception 'closure_wrong_status' using errcode = 'P0001';
  end if;

  -- Recipient must be a chat partner anchored to this post.
  -- The chat schema (0004) stores participant_a + participant_b; the recipient
  -- is whichever side is NOT the owner.
  select exists (
    select 1
      from public.chats c
     where c.anchor_post_id = p_post_id
       and (
         (c.participant_a = v_owner and c.participant_b = p_recipient_user_id) or
         (c.participant_b = v_owner and c.participant_a = p_recipient_user_id)
       )
  ) into v_chat_ok;

  if not v_chat_ok then
    raise exception 'closure_recipient_not_in_chat' using errcode = 'P0001';
  end if;

  -- Insert recipient first (trigger fires items_received +1).
  insert into public.recipients (post_id, recipient_user_id)
       values (p_post_id, p_recipient_user_id);

  -- Then flip status (trigger fires items_given +1).
  update public.posts
     set status = 'closed_delivered',
         delete_after = null,
         updated_at = now()
   where post_id = p_post_id
   returning * into v_post;

  return v_post;
end;
$$;

grant execute on function public.close_post_with_recipient(uuid, uuid) to authenticated;

-- ── 2. reopen_post_marked ───────────────────────────────────────────────────
create or replace function public.reopen_post_marked(p_post_id uuid)
returns public.posts
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_owner   uuid;
  v_status  text;
  v_post    public.posts;
begin
  select owner_id, status into v_owner, v_status
    from public.posts
   where post_id = p_post_id
   for update;

  if v_owner is null then
    raise exception 'closure_wrong_status' using errcode = 'P0001';
  end if;
  if v_owner <> auth.uid() then
    raise exception 'closure_not_owner' using errcode = 'P0001';
  end if;
  if v_status <> 'closed_delivered' then
    raise exception 'closure_wrong_status' using errcode = 'P0001';
  end if;

  -- Delete the recipient row (trigger fires items_received −1).
  delete from public.recipients where post_id = p_post_id;

  -- Flip status back to open + bump reopen_count (trigger fires items_given −1).
  update public.posts
     set status = 'open',
         reopen_count = reopen_count + 1,
         delete_after = null,
         updated_at = now()
   where post_id = p_post_id
   returning * into v_post;

  return v_post;
end;
$$;

grant execute on function public.reopen_post_marked(uuid) to authenticated;

-- end of 0015_closure_rpcs
