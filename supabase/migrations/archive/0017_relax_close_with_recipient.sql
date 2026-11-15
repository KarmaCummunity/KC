-- 0017_relax_close_with_recipient | P0.6 follow-up
-- Drop the chat-partner gate on close_post_with_recipient. Owners can now mark
-- any user as the recipient (including users who never messaged about the
-- post). The original gate was too narrow: in production, findOrCreateChat
-- reuses existing chats between two users without re-anchoring them, so a
-- chat that started about post A stays anchor=A even when the same users
-- now talk about post B. The user-facing UX (recipient picker) was shipping
-- empty even when chat history clearly existed.
--
-- Trust model: the recipient's `items_received_count` increments on every
-- mark, with no notification (TD-119) and no un-mark path (TD-120) yet.
-- Abuse vector is "I mark a stranger to inflate their counter" — low-impact
-- in MVP. When TD-119 + TD-120 land, the recipient gets a notification and
-- can self-un-mark; revisit gating then.
--
-- We still validate that the recipient row exists in public.users, so the
-- FK constraint on public.recipients always has something to point at.

set search_path = public;

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
  v_user_ok boolean;
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

  -- Reject self-recipient (owner cannot mark themselves).
  if v_owner = p_recipient_user_id then
    raise exception 'closure_recipient_not_in_chat' using errcode = 'P0001';
  end if;

  -- Validate the recipient user exists.
  select exists (select 1 from public.users where user_id = p_recipient_user_id)
    into v_user_ok;
  if not v_user_ok then
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

-- Grant unchanged from 0015 — `authenticated` already has execute.

-- end of 0017_relax_close_with_recipient
