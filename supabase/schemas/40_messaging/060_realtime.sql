-- Messaging · realtime (docs/db/target-design.md §5 "Realtime", ADR-003)
--
-- Broadcast only: triggers send small events to private topics, and row level security on
-- `realtime.messages` decides who may listen. No table is in a replication publication.
-- All of the module's realtime wiring is in this file. The `realtime` schema belongs to the
-- platform; where it is absent the baseline still applies and the triggers send nothing.
--
-- Topics (registry: docs/SSOT/social_realtime_conventions.md):
--   chat:<chat_id>:messages   INSERT (the message row) · read · reaction · chat_updated
--   chat:<chat_id>:typing     sent by clients (members of the chat)
--   chat:<chat_id>:presence   sent by clients (members of the chat)
--   user:<user_id>:chats      chat_updated — ids only: the member's inbox or badge changed
-- A message body goes only to the chat's own topic, which only members who can read the
-- message under RLS may join.

-- Sends one event to a private topic. Does nothing where the platform function is absent.
create function kc_private.broadcast(p_topic text, p_event text, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if to_regproc('realtime.send') is not null then
    perform realtime.send(p_payload, p_event, p_topic, true);
  end if;
end;
$$;
comment on function kc_private.broadcast(text, text, jsonb) is
  'Broadcasts an event to a private realtime topic; a no-op without the realtime schema.';

-- The uuid in the second segment of a topic (`chat:<uuid>:…`, `user:<uuid>:…`); null when
-- the topic has none, so a malformed topic matches no policy instead of raising.
create function kc_access.realtime_topic_uuid(p_topic text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(p_topic, ':', 2) ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$'
      then split_part(p_topic, ':', 2)::uuid
  end;
$$;
comment on function kc_access.realtime_topic_uuid(text) is 'Policy helper: the uuid segment of a realtime topic.';
grant execute on function kc_access.realtime_topic_uuid(text) to authenticated;

-- One trigger function for the four tables whose changes members see live.
create function kc_private.chat_broadcast_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chat_id uuid;
  v_user_id uuid;
begin
  if tg_table_name = 'messages' then
    perform kc_private.broadcast(
      'chat:' || new.chat_id || ':messages', 'INSERT', jsonb_build_object('record', to_jsonb(new)));
    -- Every member's inbox row and badge changed; the event carries no content.
    for v_user_id in select cm.user_id from public.chat_members cm where cm.chat_id = new.chat_id loop
      perform kc_private.broadcast('user:' || v_user_id || ':chats', 'chat_updated',
        jsonb_build_object('chat_id', new.chat_id, 'last_message_at', new.created_at));
    end loop;

  elsif tg_table_name = 'chat_members' then
    -- The other members see the read receipt; the member's other devices see the badge
    -- and the inbox change. Hiding a chat is told to the member alone.
    if new.last_read_at is distinct from old.last_read_at then
      perform kc_private.broadcast('chat:' || new.chat_id || ':messages', 'read',
        jsonb_build_object('user_id', new.user_id, 'last_read_at', new.last_read_at));
    end if;
    perform kc_private.broadcast('user:' || new.user_id || ':chats', 'chat_updated',
      jsonb_build_object('chat_id', new.chat_id));

  elsif tg_table_name = 'message_reactions' then
    select m.chat_id into v_chat_id
      from public.messages m where m.id = coalesce(new.message_id, old.message_id);
    perform kc_private.broadcast('chat:' || v_chat_id || ':messages', 'reaction', jsonb_build_object(
      'message_id', coalesce(new.message_id, old.message_id),
      'user_id', coalesce(new.user_id, old.user_id),
      'reaction_type', case when tg_op <> 'DELETE' then new.reaction_type end));

  else
    -- chats: the pinned post changed (FR-CHAT-014 AC6).
    perform kc_private.broadcast('chat:' || new.id || ':messages', 'chat_updated',
      jsonb_build_object('chat_id', new.id, 'anchor_post_id', new.anchor_post_id));
  end if;
  return null;
end;
$$;
comment on function kc_private.chat_broadcast_changes() is
  'AFTER trigger on messages, chat_members, message_reactions and chats: broadcasts the change.';

create trigger messages_broadcast
  after insert on public.messages
  for each row execute function kc_private.chat_broadcast_changes();

create trigger chat_members_broadcast
  after update of last_read_at, hidden_at on public.chat_members
  for each row
  when (new.last_read_at is distinct from old.last_read_at or new.hidden_at is distinct from old.hidden_at)
  execute function kc_private.chat_broadcast_changes();

create trigger message_reactions_broadcast
  after insert or update or delete on public.message_reactions
  for each row execute function kc_private.chat_broadcast_changes();

create trigger chats_broadcast
  after update of anchor_post_id on public.chats
  for each row
  when (new.anchor_post_id is distinct from old.anchor_post_id)
  execute function kc_private.chat_broadcast_changes();

-- Who may listen and who may send. The policies exist only where the platform table does.
do $$
begin
  if to_regclass('realtime.messages') is null then
    return;
  end if;

  -- Every topic of a chat is open to the members who can currently use that chat.
  execute $policy$
    create policy kc_chat_topics_receive on realtime.messages
      for select to authenticated
      using ((select realtime.topic()) like 'chat:%'
             and kc_access.can_access_chat(kc_access.realtime_topic_uuid((select realtime.topic()))))
  $policy$;

  -- A member's own topics (`user:<their id>:…`): inbox changes here, the notification
  -- badge in the notifications module.
  execute $policy$
    create policy kc_user_topics_receive on realtime.messages
      for select to authenticated
      using ((select realtime.topic()) like 'user:%'
             and kc_access.realtime_topic_uuid((select realtime.topic())) = (select auth.uid()))
  $policy$;

  -- Clients send only typing and presence, and only into chats they can use. Everything
  -- else on a chat topic comes from the triggers above.
  execute $policy$
    create policy kc_chat_topics_send on realtime.messages
      for insert to authenticated
      with check (((select realtime.topic()) like 'chat:%:typing'
                   or (select realtime.topic()) like 'chat:%:presence')
                  and kc_access.can_access_chat(kc_access.realtime_topic_uuid((select realtime.topic()))))
  $policy$;
end $$;
