-- Messaging · a chat removed from the inbox does not come back with its history
-- (FR-CHAT-004 AC1, FR-CHAT-016; PM decision of 2026-11-11, docs/spec/90_decisions_log.md)
--
-- One direct chat per pair stays the rule. What a member removed from their own inbox is now
-- gone for them: removing the chat also moves the member's history start to that moment, and
-- every read of the chat's messages, previews and unread counts starts there for that member.
-- Contacting the same member again (or a new message from them) therefore opens a clean
-- thread for the member who removed it, while the other member keeps the whole conversation.

alter table public.chat_members add column history_from timestamptz;
comment on column public.chat_members.history_from is
  'The member sees only messages created after this time; set when they remove the chat from their inbox (FR-CHAT-016). Null = all.';

-- The caller's history start in a chat; -infinity when they never removed it.
create function kc_access.chat_history_from(p_chat_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select cm.history_from from public.chat_members cm
                    where cm.chat_id = p_chat_id and cm.user_id = (select auth.uid())), '-infinity');
$$;
comment on function kc_access.chat_history_from(uuid) is
  'Policy helper: messages of the chat older than this are hidden from the caller.';
grant execute on function kc_access.chat_history_from(uuid) to authenticated;

-- Members read the messages of their chats from their history start on.
drop policy messages_select_member on public.messages;
create policy messages_select_member on public.messages
  for select to authenticated
  using (kc_access.can_access_chat(chat_id) and created_at > kc_access.chat_history_from(chat_id));

-- Removing a chat from the inbox also clears its history for the caller.
create or replace function public.hide_chat(p_chat_id uuid)
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
     set hidden_at = now(), history_from = clock_timestamp()
   where cm.chat_id = p_chat_id and cm.user_id = v_user_id and cm.hidden_at is null;
end;
$$;
comment on function public.hide_chat(uuid) is
  'Hides a chat from the caller''s inbox and clears its history for them; the next message or contact starts a clean thread.';

-- Unread counts start at the later of the read marker and the history start.
create or replace function kc_private.chat_unread_counts(p_user_id uuid, p_chat_ids uuid[] default null)
returns table (chat_id uuid, unread_count bigint)
language sql
stable
set search_path = ''
as $$
  select cm.chat_id,
         (select count(*) from public.messages m
           where m.chat_id = cm.chat_id
             and m.created_at > greatest(cm.last_read_at, coalesce(cm.history_from, '-infinity'))
             and m.sender_id is distinct from p_user_id)
    from public.chat_members cm
    join public.chats c on c.id = cm.chat_id
   where cm.user_id = p_user_id
     and cm.hidden_at is null
     and (p_chat_ids is null or cm.chat_id = any (p_chat_ids))
     and c.last_message_at > greatest(cm.last_read_at, coalesce(cm.history_from, '-infinity'))
     and not (c.kind = 'direct' and kc_access.is_blocked_between(c.direct_user_a, c.direct_user_b));
$$;

-- The conversation screen reads from the caller's history start on.
create or replace function public.chat_messages_page(
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
  v_from timestamptz;
begin
  perform kc_private.require_caller();
  if not kc_access.can_access_chat(p_chat_id) then
    raise exception 'chat_not_found' using errcode = 'P0001';
  end if;
  v_from := greatest(kc_access.chat_history_from(p_chat_id), coalesce(p_after, '-infinity'));

  if p_after is not null then
    return query
      select m.* from public.messages m
       where m.chat_id = p_chat_id and m.created_at > v_from
       order by m.created_at
       limit v_limit;
  else
    return query
      select m.* from public.messages m
       where m.chat_id = p_chat_id and m.created_at > v_from
         and (p_before is null or m.created_at < p_before)
       order by m.created_at desc
       limit v_limit;
  end if;
end;
$$;

-- The inbox: the preview and unread count start at the caller's history start. A chat the
-- caller reopened after removing it is listed at once (its hide is cleared by the reopen), as a
-- clean thread with no preview until its next message.
create or replace function public.chat_inbox_page(
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
  counterpart_verification_level smallint,
  counterpart_last_read_at timestamptz,
  last_message_id uuid,
  last_message_kind text,
  last_message_sender_id uuid,
  last_message_preview text,
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
           coalesce(cm.history_from, '-infinity') as history_from,
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
           where m.chat_id = p.id and m.created_at > greatest(p.last_read_at, p.history_from)
             and m.sender_id is distinct from (select me.id from me))
    from page p
    left join lateral (
      select m.id, m.kind, m.sender_id, m.body, m.media_payload, m.system_payload
        from public.messages m
       where m.chat_id = p.id and m.created_at > p.history_from
       order by m.created_at desc
       limit 1) lm on true
   order by p.last_message_at desc, p.id desc;
$$;
