-- 0259_chat_v2_realtime_broadcast | KC#873 — chat message broadcast + typing/presence auth.

create or replace function public.is_chat_participant(p_chat_id uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.chats c
     where c.chat_id = p_chat_id
       and p_user in (c.participant_a, c.participant_b)
  );
$$;

revoke all on function public.is_chat_participant(uuid, uuid) from public;
grant execute on function public.is_chat_participant(uuid, uuid) to authenticated, anon, service_role;

create or replace function public.chat_messages_broadcast_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chat_id uuid;
  v_topic text;
begin
  v_chat_id := coalesce(new.chat_id, old.chat_id);
  v_topic := 'chat:' || v_chat_id::text || ':messages';

  perform realtime.broadcast_changes(
    v_topic,
    tg_op,
    tg_op,
    tg_table_name,
    tg_table_schema,
    new,
    old
  );
  return null;
end;
$$;

drop trigger if exists tg_messages_broadcast on public.messages;
create trigger tg_messages_broadcast
  after insert or update on public.messages
  for each row execute function public.chat_messages_broadcast_changes();

create or replace function public.message_reactions_broadcast_ping()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_chat_id uuid;
begin
  select m.chat_id into v_chat_id
    from public.messages m
   where m.message_id = coalesce(new.message_id, old.message_id);

  if v_chat_id is null then
    return coalesce(new, old);
  end if;

  perform realtime.send(
    jsonb_build_object(
      'message_id', coalesce(new.message_id, old.message_id),
      'op', tg_op
    ),
    'reaction',
    'chat:' || v_chat_id::text || ':messages',
    true
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists tg_message_reactions_broadcast on public.message_reactions;
create trigger tg_message_reactions_broadcast
  after insert or delete on public.message_reactions
  for each row execute function public.message_reactions_broadcast_ping();

-- Realtime Authorization for chat topics (messages, typing, presence share prefix).
drop policy if exists chat_realtime_broadcast_receive on realtime.messages;
create policy chat_realtime_broadcast_receive
  on realtime.messages
  for select
  to authenticated
  using (
    (select realtime.topic()) like 'chat:%:%'
    and exists (
      select 1
        from public.chats c
       where c.chat_id = nullif(split_part((select realtime.topic()), ':', 2), '')::uuid
         and public.is_chat_visible_to(c.*, (select auth.uid()))
    )
  );

comment on policy chat_realtime_broadcast_receive on realtime.messages is
  'KC#873: chat:<chat_id>:{messages,typing,presence} — participant + is_chat_visible_to.';
