-- Messaging · RPCs that write (open, send, read, hide, react)
--
-- Nothing in this module is writable from a device. Errors are raised with SQLSTATE P0001
-- and a stable snake_case message the app maps to its error types.

-- Opens the caller's conversation with a member: the pair's existing chat, or a new one
-- (FR-CHAT-006, FR-CHAT-017, D13). Two members opening at the same moment get the same
-- chat: the unique index on the pair decides, not a lookup. Entering from a post pins the
-- chat to that post, replacing an earlier pin; entering without one keeps the pin
-- (FR-CHAT-014 AC6). A chat the caller had removed from their inbox comes back.
create function public.open_direct_chat(p_user_id uuid, p_anchor_post_id uuid default null)
returns public.chats
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_active_caller();
  v_chat public.chats;
begin
  if p_user_id is null or p_user_id = v_user_id then
    raise exception 'cannot_chat_self' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.users u where u.id = p_user_id and u.is_active) then
    raise exception 'user_unavailable' using errcode = 'P0001';
  end if;
  if kc_access.is_blocked_between(v_user_id, p_user_id) then
    raise exception 'blocked_relationship' using errcode = 'P0001';
  end if;
  -- The pin must be an open post of one of the two members (FR-CHAT-005).
  if p_anchor_post_id is not null and not exists (
       select 1 from public.posts p
        where p.id = p_anchor_post_id and p.status = 'open'
          and p.owner_id in (v_user_id, p_user_id)) then
    raise exception 'post_unavailable' using errcode = 'P0001';
  end if;

  insert into public.chats as c (kind, direct_user_a, direct_user_b, anchor_post_id)
  values ('direct', least(v_user_id, p_user_id), greatest(v_user_id, p_user_id), p_anchor_post_id)
  on conflict (direct_user_a, direct_user_b) where kind = 'direct'
  do update set anchor_post_id = coalesce(excluded.anchor_post_id, c.anchor_post_id)
  returning c.* into v_chat;

  insert into public.chat_members (chat_id, user_id)
  values (v_chat.id, v_user_id), (v_chat.id, p_user_id)
  on conflict do nothing;

  update public.chat_members cm
     set hidden_at = null
   where cm.chat_id = v_chat.id and cm.user_id = v_user_id and cm.hidden_at is not null;
  return v_chat;
end;
$$;
comment on function public.open_direct_chat(uuid, uuid) is
  'Returns the caller''s one chat with a member, creating it if needed; optionally pins it to a post.';
grant execute on function public.open_direct_chat(uuid, uuid) to authenticated;

-- Opens the caller's thread with the support team (FR-CHAT-007): one per member, created on
-- first use. Open to every signed-in member whatever their account status, so that a
-- suspended member can still reach support (D33).
create function public.open_support_thread()
returns public.chats
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_caller();
  v_chat public.chats;
begin
  insert into public.chats as c (kind, support_user_id)
  values ('support', v_user_id)
  on conflict (support_user_id) where kind = 'support'
  do update set support_user_id = excluded.support_user_id
  returning c.* into v_chat;

  insert into public.chat_members (chat_id, user_id)
  values (v_chat.id, v_user_id)
  on conflict do nothing;
  return v_chat;
end;
$$;
comment on function public.open_support_thread() is 'Returns the caller''s support thread, creating it on first use.';
grant execute on function public.open_support_thread() to authenticated;

-- Sends a message as the caller. A text message has a body; a media message has a payload
-- and an optional caption. `p_message_id` is the id the app gave the message when it
-- showed it optimistically: sending the same id again returns the stored message instead
-- of a second one, so a retry after a lost answer is safe (FR-CHAT-003 AC3).
-- A message to a member whose account is gone or inactive is stored and simply not
-- delivered (FR-CHAT-013 AC2).
create function public.send_message(
  p_chat_id uuid,
  p_body text,
  p_media_payload jsonb default null,
  p_message_id uuid default null
)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_caller();
  v_body constant text := nullif(btrim(p_body), '');
  v_chat public.chats;
  v_message public.messages;
begin
  select c.* into v_chat
    from public.chats c
    join public.chat_members cm on cm.chat_id = c.id and cm.user_id = v_user_id
   where c.id = p_chat_id;
  if not found then
    raise exception 'chat_not_found' using errcode = 'P0001';
  end if;
  -- Only a support thread is open to a member whose account is not active (D33).
  if v_chat.kind <> 'support' then
    perform kc_private.require_active_caller();
  end if;
  if v_chat.kind = 'direct' and kc_access.is_blocked_between(v_chat.direct_user_a, v_chat.direct_user_b) then
    raise exception 'blocked_relationship' using errcode = 'P0001';
  end if;

  select m.* into v_message
    from public.messages m
   where m.id = p_message_id and m.chat_id = p_chat_id and m.sender_id = v_user_id;
  if found then
    return v_message;
  end if;

  if p_media_payload is null and (v_body is null or char_length(v_body) > 2000) then
    raise exception 'message_body_invalid' using errcode = 'P0001';
  end if;
  if p_media_payload is not null and (
       jsonb_typeof(p_media_payload) <> 'object'
       or coalesce(p_media_payload ->> 'type', '') not in ('image', 'video', 'voice', 'location', 'post_share')
       or char_length(v_body) > 2000) then
    raise exception 'invalid_media_payload' using errcode = 'P0001';
  end if;

  insert into public.messages (id, chat_id, sender_id, kind, body, media_payload)
  values (
    coalesce(p_message_id, gen_random_uuid()), p_chat_id, v_user_id,
    case when p_media_payload is null then 'user' else 'media' end, v_body, p_media_payload)
  returning * into v_message;
  return v_message;
end;
$$;
comment on function public.send_message(uuid, text, jsonb, uuid) is
  'Sends a text or media message to a chat the caller is a member of; idempotent on p_message_id.';
grant execute on function public.send_message(uuid, text, jsonb, uuid) to authenticated;

-- Marks the chat read for the caller: the read marker moves to the newest message, of any
-- kind, in one statement (FR-CHAT-011 AC2, AC4). It never moves backwards.
create function public.mark_chat_read(p_chat_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_caller();
begin
  if not kc_access.can_access_chat(p_chat_id) then
    raise exception 'chat_not_found' using errcode = 'P0001';
  end if;
  update public.chat_members cm
     set last_read_at = c.last_message_at
    from public.chats c
   where c.id = cm.chat_id and cm.chat_id = p_chat_id and cm.user_id = v_user_id
     and c.last_message_at > cm.last_read_at;
end;
$$;
comment on function public.mark_chat_read(uuid) is 'Advances the caller''s read marker in a chat to its newest message.';
grant execute on function public.mark_chat_read(uuid) to authenticated;

-- Removes the chat from the caller's own inbox (FR-CHAT-016). The other member is not
-- affected and is not told. The support thread cannot be hidden (AC1).
create function public.hide_chat(p_chat_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_caller();
  v_kind text;
begin
  select c.kind into v_kind
    from public.chats c
    join public.chat_members cm on cm.chat_id = c.id and cm.user_id = v_user_id
   where c.id = p_chat_id;
  if not found then
    raise exception 'chat_not_found' using errcode = 'P0001';
  end if;
  if v_kind = 'support' then
    raise exception 'support_thread_not_hideable' using errcode = 'P0001';
  end if;
  update public.chat_members cm
     set hidden_at = now()
   where cm.chat_id = p_chat_id and cm.user_id = v_user_id and cm.hidden_at is null;
end;
$$;
comment on function public.hide_chat(uuid) is 'Hides a chat from the caller''s inbox until its next message.';
grant execute on function public.hide_chat(uuid) to authenticated;

-- Sets, changes or (with a null type) clears the caller's reaction to a message.
create function public.set_message_reaction(p_message_id uuid, p_reaction_type text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_active_caller();
begin
  if not exists (select 1 from public.messages m
                  where m.id = p_message_id and kc_access.can_access_chat(m.chat_id)) then
    raise exception 'message_not_found' using errcode = 'P0001';
  end if;
  if p_reaction_type is null then
    delete from public.message_reactions r
     where r.message_id = p_message_id and r.user_id = v_user_id;
    return;
  end if;
  if p_reaction_type not in ('like', 'love', 'laugh', 'sad') then
    raise exception 'invalid_reaction_type' using errcode = 'P0001';
  end if;
  insert into public.message_reactions as r (message_id, user_id, reaction_type)
  values (p_message_id, v_user_id, p_reaction_type)
  on conflict (message_id, user_id) do update set reaction_type = excluded.reaction_type
  where r.reaction_type <> excluded.reaction_type;
end;
$$;
comment on function public.set_message_reaction(uuid, text) is
  'Sets, changes or clears the caller''s reaction to a message of a chat they are in.';
grant execute on function public.set_message_reaction(uuid, text) to authenticated;

-- True when the two members have exchanged at least one message in a direct chat. Used by
-- the handoffs module for the "chat partners only" rule of the recipient picker
-- (FR-CLOSURE-003 AC1).
create function kc_private.members_share_chat(p_user_a uuid, p_user_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.chats c
     where c.kind = 'direct'
       and c.direct_user_a = least(p_user_a, p_user_b)
       and c.direct_user_b = greatest(p_user_a, p_user_b)
       and c.last_message_at is not null);
$$;
comment on function kc_private.members_share_chat(uuid, uuid) is
  'The two members have a direct chat with at least one message.';
