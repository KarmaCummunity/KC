-- Messaging · inbox rows carry the counterpart verification and message previews
-- (FR-CHAT-001, FR-CHAT-015, FR-VERIFY-001)
--
-- chat_inbox_page also returns the other member's verification level (the inbox badge),
-- the media type of the newest message and the payload of a system message, so the app
-- words a captionless media message or a post_closed notice in the preview. The result row
-- type changes, so the baseline function is dropped and created again with its grant.
drop function public.chat_inbox_page(integer, timestamptz, uuid, text);

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
  -- The other member's identity verification level (FR-VERIFY), for the inbox badge.
  counterpart_verification_level smallint,
  -- How far the other member has read: drives the read receipt on the caller's messages.
  counterpart_last_read_at timestamptz,
  last_message_id uuid,
  last_message_kind text,
  last_message_sender_id uuid,
  last_message_preview text,
  -- What a media message carries ('image', 'video', 'voice', 'location', 'post_share'), and
  -- the payload of a system message (its `kind` and the facts the wording needs, readable by
  -- every member of the chat): the app words the preview from them.
  last_message_media_type text,
  last_message_system_payload jsonb,
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
           u.id as counterpart_id, u.display_name, u.avatar_url, u.share_handle, u.verification_level
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
         p.counterpart_id, p.display_name, p.avatar_url, p.share_handle, p.verification_level,
         (select om.last_read_at from public.chat_members om
           where om.chat_id = p.id and om.user_id = p.counterpart_id),
         lm.id, lm.kind, lm.sender_id, left(lm.body, 140),
         lm.media_payload ->> 'type', lm.system_payload,
         (select count(*) from public.messages m
           where m.chat_id = p.id and m.created_at > p.last_read_at
             and m.sender_id is distinct from (select me.id from me))
    from page p
    left join lateral (
      select m.id, m.kind, m.sender_id, m.body, m.media_payload, m.system_payload
        from public.messages m
       where m.chat_id = p.id
       order by m.created_at desc
       limit 1) lm on true
   order by p.last_message_at desc, p.id desc;
$$;
comment on function public.chat_inbox_page(integer, timestamptz, uuid, text) is
  'One page of the caller''s inbox: chat, other member and their verification, newest message preview, unread count.';
grant execute on function public.chat_inbox_page(integer, timestamptz, uuid, text) to authenticated;
