-- Messaging · system messages and the consumer of outbox topic `chat_system_message`
--
-- A system message is a line the product writes into a chat ("the post was delivered").
-- Its `system_payload` names what happened; the app renders the wording.
--
-- Contract of the topic, for every module that emits to it:
--   { "kind": "<snake_case>",            what happened; becomes system_payload.kind
--     "chat_id": "<uuid>"                 write into this one chat, or
--     "post_id": "<uuid>",                write into every chat pinned to this post
--     "data": { … } }                     optional; copied into system_payload as is
-- Exactly one of `chat_id` / `post_id` is given. Member ids never go into `data`: a
-- payload is readable by every member of the chat.
-- Kind `post_closed` (FR-CHAT-015 AC3–AC7, FR-CLOSURE-001 AC4/AC6) also carries `status`
-- and `recipient_id`: each pinned chat is told whether the post went to its own other
-- member, to somebody else, or to nobody — never who — and loses its pin
-- (FR-CHAT-014 AC6).

-- Writes one system message into a chat and returns its id.
create function kc_private.chat_post_system_message(p_chat_id uuid, p_system_payload jsonb)
returns uuid
language sql
security definer
set search_path = ''
as $$
  insert into public.messages (chat_id, kind, system_payload)
  values (p_chat_id, 'system', p_system_payload)
  returning id;
$$;
comment on function kc_private.chat_post_system_message(uuid, jsonb) is
  'Writes a system message into a chat; members are notified like for any message.';

-- Performs one `chat_system_message` event and returns the number of messages written.
-- Safe to run twice for the same event: a `post_id` event clears the pin of every chat it
-- writes to, and a `chat_id` event is recognised by the event id kept in the payload.
create function kc_private.chat_system_messages_deliver(p_event_id bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event kc_private.outbox_events;
  v_payload jsonb;
  v_chat public.chats;
  v_written integer := 0;
begin
  select e.* into v_event
    from kc_private.outbox_events e
   where e.id = p_event_id and e.topic = 'chat_system_message';
  if not found then
    raise exception 'outbox_event_not_found' using errcode = 'P0001';
  end if;
  if jsonb_typeof(v_event.payload -> 'kind') is distinct from 'string'
     or ((v_event.payload ->> 'chat_id') is null) = ((v_event.payload ->> 'post_id') is null) then
    raise exception 'invalid_chat_system_message' using errcode = 'P0001';
  end if;
  v_payload := coalesce(v_event.payload -> 'data', '{}'::jsonb)
    || jsonb_build_object('kind', v_event.payload ->> 'kind', 'event_id', p_event_id);

  for v_chat in
    select c.*
      from public.chats c
     where c.id = (v_event.payload ->> 'chat_id')::uuid
        or c.anchor_post_id = (v_event.payload ->> 'post_id')::uuid
       for update
  loop
    continue when (v_event.payload ->> 'chat_id') is not null and exists (
      select 1 from public.messages m
       where m.chat_id = v_chat.id and m.created_at >= v_event.created_at
         and m.kind = 'system' and m.system_payload -> 'event_id' = to_jsonb(p_event_id));

    perform kc_private.chat_post_system_message(v_chat.id, case v_event.payload ->> 'kind'
      when 'post_closed' then v_payload || jsonb_build_object(
        'post_id', v_event.payload -> 'post_id',
        'status', v_event.payload -> 'status',
        'delivered_to_chat_member', coalesce(
          (v_event.payload ->> 'recipient_id')::uuid in (v_chat.direct_user_a, v_chat.direct_user_b),
          false))
      else v_payload
    end);
    if (v_event.payload ->> 'kind') = 'post_closed' then
      update public.chats c set anchor_post_id = null where c.id = v_chat.id;
    end if;
    v_written := v_written + 1;
  end loop;
  return v_written;
end;
$$;
comment on function kc_private.chat_system_messages_deliver(bigint) is
  'Consumer of outbox topic chat_system_message: writes the system message of one event.';

-- Worker entry point: claims due events of the topic, performs each and confirms it. A
-- failing event is released for a retry with its error and does not stop the batch.
-- Returns the number of events performed. Needs no service outside the database, so it
-- is run by a scheduled job.
create function kc_private.chat_system_messages_process(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id bigint;
  v_done integer := 0;
begin
  for v_event_id in
    select e.id from kc_private.outbox_claim('chat_system_message', p_limit) e order by e.id
  loop
    begin
      perform kc_private.chat_system_messages_deliver(v_event_id);
      perform kc_private.outbox_complete(v_event_id);
      v_done := v_done + 1;
    exception when others then
      perform kc_private.outbox_complete(v_event_id, sqlerrm);
    end;
  end loop;
  return v_done;
end;
$$;
comment on function kc_private.chat_system_messages_process(integer) is
  'Claims and performs a batch of chat_system_message events; run by a scheduled job.';
