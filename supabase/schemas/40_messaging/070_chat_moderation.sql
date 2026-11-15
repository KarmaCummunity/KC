-- Messaging · moderation hooks
--
-- The moderation module decides; this file performs. A chat that reached the report
-- threshold is hidden from its members until a moderator reviews it, and a moderator may
-- delete a single message. Both leave an audit trail (written by the moderation module).

-- Set while the chat is hidden pending review (D33, FR-MOD); null otherwise.
alter table public.chats add column moderation_hidden_at timestamptz;
comment on column public.chats.moderation_hidden_at is 'Hidden from its members while a moderator reviews a report; null = visible.';

-- The access predicate learns about the hidden state: a hidden chat is unreadable and
-- unwritable for its members, so every policy and RPC that goes through it follows.
create or replace function kc_access.can_access_chat(p_chat_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.chat_members cm
      join public.chats c on c.id = cm.chat_id
     where cm.chat_id = p_chat_id
       and cm.user_id = (select auth.uid())
       and c.moderation_hidden_at is null
       and not (c.kind = 'direct' and kc_access.is_blocked_between(c.direct_user_a, c.direct_user_b)))
$$;

-- Performs one `moderation_target` event for a chat (payload: kind hide | restore,
-- target_type 'chat', target_id). Other target types are the moderation module's own and
-- are left alone: the event is completed without effect.
create function kc_private.chat_moderation_deliver(p_event_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb;
begin
  select e.payload into v_payload
    from kc_private.outbox_events e
   where e.id = p_event_id and e.topic = 'moderation_target';
  if not found then
    raise exception 'outbox_event_not_found' using errcode = 'P0001';
  end if;
  if v_payload ->> 'target_type' is distinct from 'chat' then
    return;
  end if;
  update public.chats c
     set moderation_hidden_at = case v_payload ->> 'kind' when 'hide' then coalesce(c.moderation_hidden_at, now()) end
   where c.id = (v_payload ->> 'target_id')::uuid
     and v_payload ->> 'kind' in ('hide', 'restore');
end;
$$;

-- Claims and performs a batch; run by a scheduled job.
create function kc_private.chat_moderation_process(p_limit integer default 100)
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
    select e.id from kc_private.outbox_claim('moderation_target', p_limit) e order by e.id
  loop
    begin
      perform kc_private.chat_moderation_deliver(v_event_id);
      perform kc_private.outbox_complete(v_event_id);
      v_done := v_done + 1;
    exception when others then
      perform kc_private.outbox_complete(v_event_id, sqlerrm);
    end;
  end loop;
  return v_done;
end;
$$;
comment on function kc_private.chat_moderation_process(integer) is
  'Claims and performs a batch of moderation_target events for chats; run by a scheduled job.';

-- A moderator deletes one message (FR-ADMIN). The role check and the audit row belong to the
-- moderation module's hook; the row is removed together with its reactions. Returns nothing:
-- a message that does not exist is an error, not a silent success.
create function public.admin_delete_message(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chat_id uuid;
begin
  select m.chat_id into v_chat_id from public.messages m where m.id = p_message_id;
  if not found then
    raise exception 'message_not_found' using errcode = 'P0001';
  end if;
  perform kc_private.moderation_authorize_message_delete(p_message_id, v_chat_id);
  delete from public.messages m where m.id = p_message_id;
end;
$$;
comment on function public.admin_delete_message(uuid) is
  'Moderator deletes a chat message; audited. Errors: 42501 forbidden, P0001 message_not_found.';
grant execute on function public.admin_delete_message(uuid) to authenticated;
