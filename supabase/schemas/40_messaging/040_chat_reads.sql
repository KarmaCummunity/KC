-- Messaging · RPCs that read (unread counters, inbox page, message page)
--
-- Each screen is one round trip. The functions run with definer rights and apply the access
-- rule once per call (membership of the caller, no closing block) instead of once per row,
-- which is what the row level policies would do for the same query.

-- Unread messages per chat of one member: messages created after the member's read marker
-- and not sent by them, counted on messages_chat_created_uidx. Chats the member removed
-- from their inbox and direct chats closed by a block count nothing (FR-CHAT-012 AC4,
-- FR-CHAT-009 AC1). A chat whose newest message is already read is skipped without
-- touching `messages`.
create function kc_private.chat_unread_counts(p_user_id uuid, p_chat_ids uuid[] default null)
returns table (chat_id uuid, unread_count bigint)
language sql
stable
set search_path = ''
as $$
  select cm.chat_id,
         (select count(*) from public.messages m
           where m.chat_id = cm.chat_id
             and m.created_at > cm.last_read_at
             and m.sender_id is distinct from p_user_id)
    from public.chat_members cm
    join public.chats c on c.id = cm.chat_id
   where cm.user_id = p_user_id
     and cm.hidden_at is null
     and (p_chat_ids is null or cm.chat_id = any (p_chat_ids))
     and c.last_message_at > cm.last_read_at
     and not (c.kind = 'direct' and kc_access.is_blocked_between(c.direct_user_a, c.direct_user_b));
$$;
comment on function kc_private.chat_unread_counts(uuid, uuid[]) is
  'Unread message count of each chat of a member that has any; all chats or the listed ones.';

-- Badge on the chat icon: unread messages across all of the caller's chats (FR-CHAT-012).
create function public.chat_unread_total()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(n.unread_count), 0)::bigint
    from kc_private.chat_unread_counts(kc_private.require_caller()) n;
$$;
comment on function public.chat_unread_total() is 'Unread messages across the caller''s chats.';
grant execute on function public.chat_unread_total() to authenticated;

-- Unread count of each listed chat; a chat with nothing unread is not returned.
create function public.chat_unread_counts(p_chat_ids uuid[])
returns table (chat_id uuid, unread_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select n.chat_id, n.unread_count
    from kc_private.chat_unread_counts(kc_private.require_caller(), p_chat_ids) n
   where n.unread_count > 0;
$$;
comment on function public.chat_unread_counts(uuid[]) is 'Unread messages of each listed chat of the caller.';
grant execute on function public.chat_unread_counts(uuid[]) to authenticated;

-- One page of the caller's inbox, newest conversation first (FR-CHAT-001): the chat, the
-- other member's display fields, a preview of the newest message and the unread count.
-- Keyset on (last_message_at, chat_id): pass the last row's values to get the next page.
-- Left out: chats without a message, chats the caller removed from their inbox, and direct
-- chats closed by a block. The other member's fields are null when their account is gone
-- or not active — the app shows the "deleted user" placeholder — and in the member's own
-- support thread. `p_search` filters by the start of the other member's name (AC3).
-- The page is cut first and only its rows get the preview and the count.
create function public.chat_inbox_page(
  p_limit integer default 30,
  p_before_last_message_at timestamptz default null,
  p_before_chat_id uuid default null,
  p_search text default null
)
returns table (
  chat_id uuid,
  kind text,
  anchor_post_id uuid,
  last_message_at timestamptz,
  counterpart_id uuid,
  counterpart_display_name text,
  counterpart_avatar_url text,
  counterpart_share_handle text,
  -- How far the other member has read: drives the read receipt on the caller's messages.
  counterpart_last_read_at timestamptz,
  last_message_id uuid,
  last_message_kind text,
  last_message_sender_id uuid,
  last_message_preview text,
  unread_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select kc_private.require_caller() as id),
  page as (
    select c.id, c.kind, c.anchor_post_id, c.last_message_at, cm.last_read_at,
           u.id as counterpart_id, u.display_name, u.avatar_url, u.share_handle
      from me
      join public.chat_members cm on cm.user_id = me.id and cm.hidden_at is null
      join public.chats c on c.id = cm.chat_id
      left join public.users u
        on u.is_active
       and u.id <> me.id
       and u.id in (c.direct_user_a, c.direct_user_b, c.support_user_id)
     where c.last_message_at is not null
       and not (c.kind = 'direct' and kc_access.is_blocked_between(c.direct_user_a, c.direct_user_b))
       and (p_before_last_message_at is null
            or (c.last_message_at, c.id) < (p_before_last_message_at, p_before_chat_id))
       and (nullif(btrim(p_search), '') is null
            or u.display_name ilike
               replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%')
     order by c.last_message_at desc, c.id desc
     limit least(greatest(coalesce(p_limit, 30), 1), 50))
  select p.id, p.kind, p.anchor_post_id, p.last_message_at,
         p.counterpart_id, p.display_name, p.avatar_url, p.share_handle,
         (select om.last_read_at from public.chat_members om
           where om.chat_id = p.id and om.user_id = p.counterpart_id),
         lm.id, lm.kind, lm.sender_id, left(lm.body, 140),
         (select count(*) from public.messages m
           where m.chat_id = p.id and m.created_at > p.last_read_at
             and m.sender_id is distinct from (select me.id from me))
    from page p
    left join lateral (
      select m.id, m.kind, m.sender_id, m.body
        from public.messages m
       where m.chat_id = p.id
       order by m.created_at desc
       limit 1) lm on true
   order by p.last_message_at desc, p.id desc;
$$;
comment on function public.chat_inbox_page(integer, timestamptz, uuid, text) is
  'One page of the caller''s inbox: chat, other member, newest message preview, unread count.';
grant execute on function public.chat_inbox_page(integer, timestamptz, uuid, text) to authenticated;

-- Messages of a chat the caller is a member of. Without `p_after`: one page going back in
-- time, newest first, starting before `p_before` (the conversation screen). With
-- `p_after`: what arrived after that time, oldest first (catching up after a reconnect).
-- `created_at` is unique inside a chat, so it is the whole cursor.
create function public.chat_messages_page(
  p_chat_id uuid,
  p_limit integer default 50,
  p_before timestamptz default null,
  p_after timestamptz default null
)
returns setof public.messages
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit constant integer := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  perform kc_private.require_caller();
  if not kc_access.can_access_chat(p_chat_id) then
    raise exception 'chat_not_found' using errcode = 'P0001';
  end if;

  if p_after is not null then
    return query
      select m.* from public.messages m
       where m.chat_id = p_chat_id and m.created_at > p_after
       order by m.created_at
       limit v_limit;
  else
    return query
      select m.* from public.messages m
       where m.chat_id = p_chat_id and (p_before is null or m.created_at < p_before)
       order by m.created_at desc
       limit v_limit;
  end if;
end;
$$;
comment on function public.chat_messages_page(uuid, integer, timestamptz, timestamptz) is
  'A page of a chat''s messages for a member: backwards from p_before, or forwards from p_after.';
grant execute on function public.chat_messages_page(uuid, integer, timestamptz, timestamptz) to authenticated;
