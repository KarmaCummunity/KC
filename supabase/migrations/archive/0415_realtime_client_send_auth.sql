-- 0415_realtime_client_send_auth | Realtime polish: let chat participants send typing / track
-- presence on their private chat topics, and add a global online-presence topic.
--
-- 0259 only granted SELECT on realtime.messages, so client sends on private channels
-- (typing broadcast, presence track) were rejected by Realtime Authorization.

begin;

-- Parses `<prefix>:<uuid>:<suffix>` topics; returns null (never raises) on malformed input.
create or replace function public.realtime_topic_uuid(p_topic text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(p_topic, ':', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then split_part(p_topic, ':', 2)::uuid
  end;
$$;

revoke all on function public.realtime_topic_uuid(text) from public;
grant execute on function public.realtime_topic_uuid(text) to authenticated, service_role;

-- Typing (broadcast) and per-chat presence (track): visible participants only.
drop policy if exists chat_realtime_client_send on realtime.messages;
create policy chat_realtime_client_send
  on realtime.messages
  for insert
  to authenticated
  with check (
    (
      ((select realtime.topic()) like 'chat:%:typing' and realtime.messages.extension = 'broadcast')
      or ((select realtime.topic()) like 'chat:%:presence' and realtime.messages.extension = 'presence')
    )
    and exists (
      select 1
        from public.chats c
       where c.chat_id = public.realtime_topic_uuid((select realtime.topic()))
         and public.is_chat_visible_to(c.*, (select auth.uid()))
    )
  );

comment on policy chat_realtime_client_send on realtime.messages is
  'Realtime polish: chat:<chat_id>:typing broadcast + chat:<chat_id>:presence track — visible participants only.';

-- Global online presence (online dot). Presence state only (no broadcast payloads).
drop policy if exists online_presence_receive on realtime.messages;
create policy online_presence_receive
  on realtime.messages
  for select
  to authenticated
  using (
    (select realtime.topic()) = 'presence:online'
    and realtime.messages.extension = 'presence'
  );

drop policy if exists online_presence_track on realtime.messages;
create policy online_presence_track
  on realtime.messages
  for insert
  to authenticated
  with check (
    (select realtime.topic()) = 'presence:online'
    and realtime.messages.extension = 'presence'
    and public.is_active_member((select auth.uid()))
  );

comment on policy online_presence_track on realtime.messages is
  'Realtime polish: presence:online — active members track themselves (key = user id).';

commit;
