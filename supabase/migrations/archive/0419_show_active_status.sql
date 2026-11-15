-- 0419_show_active_status | Privacy: "Show my active status" (default ON), reciprocal.
--
-- When OFF the user neither broadcasts presence nor receives anyone's presence, like common
-- messengers. Enforced server-side in Realtime Authorization: presence track + receive on
-- `presence:online` (0415) and per-chat presence on `chat:<id>:presence` require the flag.
-- The flag is private to its owner (read/write via RPCs; not part of the public user columns).

begin;

alter table public.users
  add column if not exists show_active_status boolean not null default true;

comment on column public.users.show_active_status is
  'Privacy: when false the user does not broadcast or receive online presence (0419). Owner-only via RPCs.';

-- Policy helper: false for unknown users (fail closed); callers pass auth.uid().
create or replace function public.shows_active_status(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select u.show_active_status from public.users u where u.user_id = p_user),
    false
  );
$$;

revoke all on function public.shows_active_status(uuid) from public;
grant execute on function public.shows_active_status(uuid) to authenticated, service_role;

create or replace function public.rpc_get_show_active_status()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select u.show_active_status from public.users u where u.user_id = (select auth.uid())),
    true
  );
$$;

revoke all on function public.rpc_get_show_active_status() from public;
grant execute on function public.rpc_get_show_active_status() to authenticated;

create or replace function public.rpc_set_show_active_status(p_enabled boolean)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_enabled is null then
    raise exception 'p_enabled must not be null' using errcode = '22004';
  end if;
  update public.users set show_active_status = p_enabled where user_id = v_uid;
  return p_enabled;
end;
$$;

revoke all on function public.rpc_set_show_active_status(boolean) from public;
grant execute on function public.rpc_set_show_active_status(boolean) to authenticated;

-- Global online presence: both directions require the flag.
drop policy if exists online_presence_receive on realtime.messages;
create policy online_presence_receive
  on realtime.messages
  for select
  to authenticated
  using (
    (select realtime.topic()) = 'presence:online'
    and realtime.messages.extension = 'presence'
    and public.shows_active_status((select auth.uid()))
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
    and public.shows_active_status((select auth.uid()))
  );

-- Per-chat presence follows the same rule (typing is unaffected).
drop policy if exists chat_realtime_client_send on realtime.messages;
create policy chat_realtime_client_send
  on realtime.messages
  for insert
  to authenticated
  with check (
    (
      ((select realtime.topic()) like 'chat:%:typing' and realtime.messages.extension = 'broadcast')
      or (
        (select realtime.topic()) like 'chat:%:presence'
        and realtime.messages.extension = 'presence'
        and public.shows_active_status((select auth.uid()))
      )
    )
    and exists (
      select 1
        from public.chats c
       where c.chat_id = public.realtime_topic_uuid((select realtime.topic()))
         and public.is_chat_visible_to(c.*, (select auth.uid()))
    )
  );

drop policy if exists chat_realtime_broadcast_receive on realtime.messages;
create policy chat_realtime_broadcast_receive
  on realtime.messages
  for select
  to authenticated
  using (
    (select realtime.topic()) like 'chat:%:%'
    and (
      realtime.messages.extension <> 'presence'
      or public.shows_active_status((select auth.uid()))
    )
    and exists (
      select 1
        from public.chats c
       where c.chat_id = public.realtime_topic_uuid((select realtime.topic()))
         and public.is_chat_visible_to(c.*, (select auth.uid()))
    )
  );

comment on policy chat_realtime_broadcast_receive on realtime.messages is
  'KC#873 + 0419: chat:<chat_id>:{messages,typing,presence} — participant + is_chat_visible_to; presence needs show_active_status.';

commit;
