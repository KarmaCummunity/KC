-- Messaging: one direct chat per pair; only members read a chat and nobody writes its tables
-- directly; a block closes the chat to both; unread counts follow the read marker; a new
-- message brings a hidden chat back; changes are broadcast to the right topics and recorded
-- in the outbox; system messages are written by the topic's consumer; a removed account
-- leaves its messages to the other member.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Test shorthand inside SQL text: @a … @f are the members, #ab the direct chat of a and b,
-- #sa the support thread of a. With p_raw the bare ids are inserted (for topic names).
create function pg_temp.expand(p_sql text, p_raw boolean default false)
returns text
language plpgsql
as $$
declare
  v_sql text := p_sql;
  v_match text[];
begin
  for v_match in select regexp_matches(p_sql, '#([a-fs])([a-f])', 'g') loop
    v_sql := replace(v_sql, '#' || v_match[1] || v_match[2], coalesce((
      select case when p_raw then c.id::text else quote_literal(c.id) || '::uuid' end from public.chats c
       where case v_match[1]
               when 's' then c.support_user_id = ('00000000-0000-4000-8000-00000000000' || v_match[2])::uuid
               else c.direct_user_a = ('00000000-0000-4000-8000-00000000000' || v_match[1])::uuid
                and c.direct_user_b = ('00000000-0000-4000-8000-00000000000' || v_match[2])::uuid
             end), 'null'));
  end loop;
  return regexp_replace(v_sql, '@([a-f])',
    case when p_raw then '00000000-0000-4000-8000-00000000000\1'
         else '''00000000-0000-4000-8000-00000000000\1''::uuid' end, 'g');
end;
$$;

-- Runs a statement as a signed-in member (or as `anon` when p_who is null). Returns 'ok',
-- the message of a P0001 error, or the SQLSTATE of any other error.
create function pg_temp.act(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_sql constant text := pg_temp.expand(p_sql);
begin
  begin
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', '00000000-0000-4000-8000-00000000000' || p_who,
      'role', case when p_who is null then 'anon' else 'authenticated' end)::text, true);
    perform set_config('role', case when p_who is null then 'anon' else 'authenticated' end, true);
    execute v_sql;
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '{}', true);
    return 'ok';
  exception when others then
    return case sqlstate when 'P0001' then sqlerrm else sqlstate end;
  end;
end;
$$;

-- Rows a member can read with the given query; p_topic is the realtime topic they joined.
create function pg_temp.seen(p_who text, p_sql text, p_topic text default '')
returns bigint
language plpgsql
as $$
declare
  v_sql constant text := pg_temp.expand(p_sql);
  v_rows bigint;
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', 'authenticated')::text, true);
  perform set_config('realtime.topic', pg_temp.expand(p_topic, true), true);
  perform set_config('role', 'authenticated', true);
  execute 'select count(*) from (' || v_sql || ') q' into v_rows;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '{}', true);
  return v_rows;
end;
$$;

-- One value read as the database owner.
create function pg_temp.val(p_sql text)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  execute pg_temp.expand(p_sql) into v_value;
  return v_value;
end;
$$;

-- One value read as a signed-in member.
create function pg_temp.val_as(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_sql constant text := pg_temp.expand(p_sql);
  v_value text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute v_sql into v_value;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '{}', true);
  return v_value;
end;
$$;

-- Pending `notification` events of a kind addressed to a member.
create function pg_temp.events(p_kind text, p_who text)
returns bigint
language sql
as $$
  select count(*) from kc_private.outbox_events e
   where e.topic = 'notification' and e.payload ->> 'kind' = p_kind
     and e.payload ->> 'recipient_id' = '00000000-0000-4000-8000-00000000000' || p_who;
$$;

-- Broadcast events of a name on a topic.
create function pg_temp.sent(p_topic text, p_event text)
returns bigint
language sql
as $$
  select count(*) from realtime.messages m
   where m.topic = pg_temp.expand(p_topic, true) and m.event = p_event;
$$;

select plan(102);

-- Alice, Bob, Carol, Dan and Eve are active; Fay has not confirmed her email.
insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test',
       case when x = 'f' then '{}' else '{"provider":"google"}' end::jsonb
  from unnest(array['a', 'b', 'c', 'd', 'e', 'f']) x;
update public.users set display_name = 'Member ' || right(id::text, 1);
insert into public.blocks (blocker_id, blocked_id) values
  ('00000000-0000-4000-8000-00000000000d', '00000000-0000-4000-8000-00000000000a');
insert into public.cities (city_id, name_he, name_en, location) values
  ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)');
insert into public.worlds (slug, label_he, label_en) values ('items', 'items', 'items');
insert into public.post_kinds (id, world_slug, slug, label_he, label_en, direction) values
  ('20000000-0000-4000-8000-000000000001', 'items', 'items_kind', 'items', 'items', 'either');
-- Post 1 is Bob's, post 2 is Eve's.
insert into public.posts (id, owner_id, world_slug, kind_id, direction, status, title, city_id)
select ('10000000-0000-4000-8000-00000000000' || n)::uuid, ('00000000-0000-4000-8000-00000000000' || o)::uuid,
       'items', '20000000-0000-4000-8000-000000000001', 'offer', 'open', 'post ' || n, 'c1'
  from (values (1, 'b'), (2, 'e')) p (n, o);

-- ── Opening a direct chat ───────────────────────────────────────────────────
select is(pg_temp.act('a', 'select public.open_direct_chat(@b)'), 'ok', 'a member opens a chat with another member');
select is(pg_temp.act('b', 'select public.open_direct_chat(@a)'), 'ok', 'the other member opens the same pair');
select is(pg_temp.val('select count(*) from public.chats'), '1', 'both openings return one chat for the pair');
select is(pg_temp.val('select count(*) from public.chat_members where chat_id = #ab'), '2', 'a direct chat has exactly its two members');
select throws_ok(
  $$insert into public.chats (kind, direct_user_a, direct_user_b)
    values ('direct', '00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b')$$,
  '23505', null, 'a second chat for the same pair is refused by the unique index');
select throws_ok(
  $$insert into public.chats (kind, direct_user_a, direct_user_b)
    values ('direct', '00000000-0000-4000-8000-00000000000c', '00000000-0000-4000-8000-00000000000a')$$,
  '23514', null, 'the pair of a direct chat is stored ordered');
select is(pg_temp.act('a', 'insert into public.chat_members (chat_id, user_id) values (#ab, @c)'), '42501',
  'membership is not writable from a device');
select throws_ok(pg_temp.expand('insert into public.chat_members (chat_id, user_id) values (#ab, @c)'),
  'P0001', 'chat_member_not_allowed', 'a direct chat admits no third member');
select is(pg_temp.act('a', 'select public.open_direct_chat(@a)'), 'cannot_chat_self', 'a member cannot open a chat with themselves');
select is(pg_temp.act('a', 'select public.open_direct_chat(@f)'), 'user_unavailable', 'a chat with an inactive member is refused');
select is(pg_temp.act('f', 'select public.open_direct_chat(@a)'), 'account_not_active', 'an inactive member cannot open a chat');
select is(pg_temp.act('a', 'select public.open_direct_chat(@d)'), 'blocked_relationship', 'a blocked pair cannot open a chat');
select is(pg_temp.act('d', 'select public.open_direct_chat(@a)'), 'blocked_relationship', '… in either direction');
select is(pg_temp.act(null, 'select public.open_direct_chat(@a)'), '42501', 'a signed-out caller cannot open a chat');

-- Pin to a post (FR-CHAT-014 AC6).
select is(pg_temp.act('a', 'select public.open_direct_chat(@b, ''10000000-0000-4000-8000-000000000001'')'), 'ok',
  'entering from a post of the other member pins the chat');
select is(pg_temp.act('a', 'select public.open_direct_chat(@b)'), 'ok', 'entering without a post');
select is(pg_temp.val('select anchor_post_id from public.chats where id = #ab'), '10000000-0000-4000-8000-000000000001',
  '… keeps the pin');
select is(pg_temp.act('a', 'select public.open_direct_chat(@b, ''10000000-0000-4000-8000-000000000002'')'), 'post_unavailable',
  'a chat cannot be pinned to a post of a third member');

-- ── Who reads what ──────────────────────────────────────────────────────────
select is(pg_temp.act('a', $$select public.send_message(#ab, ' hello bob ')$$), 'ok', 'a member sends a message');
select is(pg_temp.act('a', $$select public.send_message(#ab, 'second')$$), 'ok', 'and another');
select is(pg_temp.val('select body from public.messages where chat_id = #ab order by created_at limit 1'), 'hello bob',
  'the body is stored trimmed');
select is(pg_temp.seen('a', 'select 1 from public.chats'), 1::bigint, 'a member sees the chat');
select is(pg_temp.seen('b', 'select 1 from public.messages'), 2::bigint, 'the other member reads the messages');
select is(pg_temp.seen('b', 'select 1 from public.chat_members'), 2::bigint, 'members see who is in the chat');
select is(pg_temp.seen('c', 'select 1 from public.chats'), 0::bigint, 'a non-member sees no chat');
select is(pg_temp.seen('c', 'select 1 from public.messages'), 0::bigint, 'a non-member reads no message');
select is(pg_temp.seen('c', 'select 1 from public.chat_members'), 0::bigint, 'a non-member sees no membership');
select is(pg_temp.act(null, 'select 1 from public.messages'), '42501', 'a signed-out caller cannot read messages');
select is(pg_temp.act(null, 'select 1 from public.chats'), '42501', 'a signed-out caller cannot read chats');
select is(pg_temp.act('b', 'select hidden_at from public.chat_members'), '42501', 'the inbox-hide marker is not readable');
select is(pg_temp.act('a', $$insert into public.messages (chat_id, sender_id, body) values (#ab, @a, 'x')$$), '42501',
  'a message cannot be inserted directly');
select is(pg_temp.act('a', $$update public.messages set body = 'edited'$$), '42501', 'a message cannot be edited');
select is(pg_temp.act('a', 'delete from public.messages'), '42501', 'a message cannot be deleted');
select is(pg_temp.act('c', $$select public.send_message(#ab, 'intruder')$$), 'chat_not_found', 'a non-member cannot send');
select is(pg_temp.act('c', 'select public.chat_messages_page(#ab)'), 'chat_not_found', 'a non-member cannot page the messages');
select is(pg_temp.seen('b', 'select * from public.chat_messages_page(#ab)'), 2::bigint, 'a member pages the messages');
select is(pg_temp.seen('b', 'select * from public.chat_messages_page(#ab, 50, null,
    (select min(created_at) from public.messages))'), 1::bigint, 'paging forward returns what came after the cursor');

-- ── Message rules ───────────────────────────────────────────────────────────
select is(pg_temp.act('a', $$select public.send_message(#ab, '   ')$$), 'message_body_invalid', 'an empty message is refused');
select is(pg_temp.act('a', $$select public.send_message(#ab, repeat('x', 2001))$$), 'message_body_invalid', 'a message over 2,000 characters is refused');
select is(pg_temp.act('a', $$select public.send_message(#ab, null, '{"type":"gif"}')$$), 'invalid_media_payload', 'an unknown media type is refused');
select is(pg_temp.act('a', $$select public.send_message(#ab, null, '{"type":"image","path":"a/1.jpg"}', '30000000-0000-4000-8000-000000000001')$$),
  'ok', 'a media message is sent');
select is(pg_temp.act('a', $$select public.send_message(#ab, null, '{"type":"image","path":"a/1.jpg"}', '30000000-0000-4000-8000-000000000001')$$),
  'ok', 'sending the same message id again succeeds');
select is(pg_temp.val($$select count(*) || '/' || min(kind) from public.messages where id = '30000000-0000-4000-8000-000000000001'$$),
  '1/media', '… and stores it once');
select throws_ok(pg_temp.expand($$insert into public.messages (chat_id, sender_id, kind) values (#ab, @a, 'user')$$),
  '23514', null, 'a user message needs a body');
select throws_ok(pg_temp.expand($$insert into public.messages (chat_id, sender_id, kind, system_payload) values (#ab, @a, 'system', '{"kind":"x"}')$$),
  '23514', null, 'a system message has no sender');
select throws_ok(pg_temp.expand($$insert into public.messages (chat_id, kind, body) values (#ab, 'note', 'x')$$),
  '23514', null, 'an unknown message kind is refused');
select is(pg_temp.val('select count(distinct created_at) = count(*) and max(created_at) = (select last_message_at from public.chats where id = #ab)
    from public.messages where chat_id = #ab'), 'true', 'message times are unique in a chat and the chat carries the newest');

-- ── Unread counts and the read marker ───────────────────────────────────────
select is(pg_temp.val_as('b', 'select public.chat_unread_total()'), '3', 'the recipient has three unread messages');
select is(pg_temp.val_as('a', 'select public.chat_unread_total()'), '0', 'a member''s own messages are not unread');
select is(pg_temp.val_as('b', 'select unread_count from public.chat_unread_counts(array[#ab])'), '3', 'the per-chat count agrees');
select is(pg_temp.val_as('b', $$select public.bootstrap_session() -> 'unread' ->> 'chats'$$), '3', 'session start carries the chat badge');
select is(pg_temp.act('c', 'select public.mark_chat_read(#ab)'), 'chat_not_found', 'a non-member cannot mark a chat read');
select is(pg_temp.act('b', 'select public.mark_chat_read(#ab)'), 'ok', 'the recipient marks the chat read');
select is(pg_temp.val_as('b', 'select public.chat_unread_total()'), '0', '… and nothing is unread');
select is(pg_temp.act('a', $$select public.send_message(#ab, 'third')$$), 'ok', 'a later message');
select is(pg_temp.val_as('b', 'select public.chat_unread_total()'), '1', '… is unread again');

-- ── Inbox page ──────────────────────────────────────────────────────────────
select is(pg_temp.act('c', 'select public.open_direct_chat(@a)'), 'ok', 'a second chat of Alice, with Carol');
select is(pg_temp.seen('a', 'select * from public.chat_inbox_page()'), 1::bigint, 'a chat without a message is not in the inbox');
select is(pg_temp.act('c', $$select public.send_message(#ac, 'hi from carol')$$), 'ok', 'Carol writes');
select is(pg_temp.val_as('a', $$select string_agg(counterpart_display_name || ':' || last_message_preview || ':' || unread_count, ' | ')
    from public.chat_inbox_page()$$), 'Member c:hi from carol:1 | Member b:third:0',
  'the inbox lists chats newest first with the other member, the preview and the unread count');
select is(pg_temp.val_as('a', $$select string_agg(counterpart_display_name, ',') from public.chat_inbox_page(1,
    (select last_message_at from public.chats where id = #ac), #ac)$$), 'Member b', 'the keyset cursor returns the next page');
select is(pg_temp.seen('a', $$select * from public.chat_inbox_page(30, null, null, 'member C')$$), 1::bigint, 'the inbox filters by the start of the name');

-- ── Hiding a chat (FR-CHAT-016) ─────────────────────────────────────────────
select is(pg_temp.act('b', 'select public.hide_chat(#ab)'), 'ok', 'a member hides a chat from their inbox');
select is(pg_temp.seen('b', 'select * from public.chat_inbox_page()'), 0::bigint, 'the hidden chat leaves the inbox');
select is(pg_temp.val_as('b', 'select public.chat_unread_total()'), '0', 'a hidden chat counts nothing unread');
select is(pg_temp.seen('a', 'select * from public.chat_inbox_page()'), 2::bigint, 'the other member still has it');
select is(pg_temp.act('a', $$select public.send_message(#ab, 'are you there?')$$), 'ok', 'a new message');
select is(pg_temp.seen('b', 'select * from public.chat_inbox_page()'), 1::bigint, '… brings the chat back');
select is(pg_temp.val_as('b', 'select public.chat_unread_total()'), '1',
  '… with only the new message: the history before the hide is gone for the member who hid it (FR-CHAT-016)');

-- ── A block closes the chat to both (D105) ──────────────────────────────────
insert into public.blocks (blocker_id, blocked_id) values
  ('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-00000000000a');
select is(pg_temp.seen('a', 'select 1 from public.messages where chat_id = #ab') + pg_temp.seen('b', 'select 1 from public.messages where chat_id = #ab'),
  0::bigint, 'neither member of a blocked pair reads the messages');
select is(pg_temp.act('a', $$select public.send_message(#ab, 'still there?')$$), 'blocked_relationship', 'the blocked member cannot send');
select is(pg_temp.act('b', $$select public.send_message(#ab, 'no')$$), 'blocked_relationship', 'nor can the blocker');
select is(pg_temp.val_as('b', 'select public.chat_unread_total()') || '/' || pg_temp.seen('b', 'select * from public.chat_inbox_page()'),
  '0/0', 'the chat leaves the badge and the inbox');
delete from public.blocks where blocker_id = '00000000-0000-4000-8000-00000000000b';
select is(pg_temp.seen('b', 'select 1 from public.messages where chat_id = #ab') || '/' || pg_temp.seen('a', 'select 1 from public.messages where chat_id = #ab'),
  '1/5', 'lifting the block brings the thread back: Bob from his hide on, Alice all of it');

-- ── Reactions ───────────────────────────────────────────────────────────────
select is(pg_temp.act('b', $$select public.set_message_reaction('30000000-0000-4000-8000-000000000001', 'love')$$), 'ok', 'a member reacts to a message');
select is(pg_temp.seen('a', 'select 1 from public.message_reactions'), 1::bigint, 'the other member sees the reaction');
select is(pg_temp.act('c', $$select public.set_message_reaction('30000000-0000-4000-8000-000000000001', 'like')$$), 'message_not_found', 'a non-member cannot react');
select is(pg_temp.act('b', $$select public.set_message_reaction('30000000-0000-4000-8000-000000000001', 'wow')$$), 'invalid_reaction_type', 'an unknown reaction is refused');
select is(pg_temp.act('b', $$select public.set_message_reaction('30000000-0000-4000-8000-000000000001', null)$$), 'ok', 'a null type clears the reaction');

-- ── Broadcast ───────────────────────────────────────────────────────────────
select is(pg_temp.sent('chat:#ab:messages', 'INSERT'), 5::bigint, 'each message is broadcast to the chat topic');
select is(pg_temp.sent('user:@b:chats', 'chat_updated') > 0
    and not exists (select 1 from realtime.messages m where m.topic like 'user:%' and m.payload::text ~ 'hello|record'),
  true, 'member topics get the change without any message content');
select is(pg_temp.sent('chat:#ab:messages', 'read'), 1::bigint, 'marking read broadcasts a read receipt');
select is(pg_temp.sent('chat:#ab:messages', 'reaction'), 2::bigint, 'setting and clearing a reaction are broadcast');
select is(pg_temp.seen('b', 'select 1 from realtime.messages', 'chat:#ab:messages') > 0
    and pg_temp.seen('c', 'select 1 from realtime.messages', 'chat:#ab:messages') = 0,
  true, 'only members may listen to a chat topic');
select is(pg_temp.seen('b', 'select 1 from realtime.messages', 'user:@b:chats') > 0
    and pg_temp.seen('c', 'select 1 from realtime.messages', 'user:@b:chats') = 0,
  true, 'only the member may listen to their own topic');

-- ── Outbox and the support thread ───────────────────────────────────────────
select is(pg_temp.events('chat_message', 'b') || '/' || pg_temp.events('chat_message', 'a'), '5/1',
  'each message enqueues one notification for the other member and none for the sender');
select is(pg_temp.act('a', 'select public.hide_chat(#ab)'), 'ok', 'Alice hides the chat');
update public.user_account set status = 'suspended_admin' where user_id = '00000000-0000-4000-8000-00000000000a';
select is(pg_temp.act('a', $$select public.send_message(#ab, 'x')$$), 'account_not_active', 'a suspended member cannot send in a direct chat');
select is(pg_temp.act('a', 'select public.open_support_thread()') || '/' || pg_temp.act('a', 'select public.open_support_thread()')
    || '/' || pg_temp.val('select count(*) from public.chats where kind = ''support'''), 'ok/ok/1',
  'a suspended member opens their one support thread');
select is(pg_temp.act('a', $$select public.send_message(#sa, 'help')$$), 'ok', '… and writes to support (D33)');
select is(pg_temp.act('a', 'select public.hide_chat(#sa)'), 'support_thread_not_hideable', 'the support thread cannot be hidden');
insert into public.chat_members (chat_id, user_id, role)
select c.id, '00000000-0000-4000-8000-00000000000e', 'support_agent' from public.chats c where c.kind = 'support';
select is(pg_temp.act('e', $$select public.send_message(#sa, 'we are on it')$$) || '/' || pg_temp.events('support_message', 'a'),
  'ok/1', 'an answer from support notifies the member as a support message');

-- ── System messages (consumer of topic chat_system_message) ─────────────────
select is(pg_temp.act('c', 'select public.open_direct_chat(@b, ''10000000-0000-4000-8000-000000000001'')'), 'ok', 'a second chat pinned to post 1');
do $$
begin
  perform kc_private.outbox_enqueue('chat_system_message', jsonb_build_object(
    'kind', 'post_closed', 'post_id', '10000000-0000-4000-8000-000000000001', 'status', 'closed_delivered',
    'owner_id', '00000000-0000-4000-8000-00000000000b', 'recipient_id', '00000000-0000-4000-8000-00000000000a'));
end $$;
select is(kc_private.chat_system_messages_process(), 1, 'the worker performs the event');
select is(pg_temp.val($$select string_agg((m.system_payload ->> 'delivered_to_chat_member') || ':' || (m.sender_id is null), ',' order by m.system_payload ->> 'delivered_to_chat_member')
    from public.messages m where m.kind = 'system' and m.system_payload ->> 'kind' = 'post_closed'$$), 'false:true,true:true',
  'every chat pinned to the post gets the closing line, told only whether its own member received it');
select is(pg_temp.val('select count(*) from public.chats where anchor_post_id is not null') || '/'
    || pg_temp.val($$select count(*) from public.messages where system_payload::text ~ '0000000a|recipient_id'$$)
    || '/' || pg_temp.events('system_message', 'c') || '/' || pg_temp.val('select hidden_at is null from public.chat_members where chat_id = #ab and user_id = @a'),
  '0/0/1/true', 'the pin is cleared, no member id is copied, members are notified and the hidden chat returns');
select is((select kc_private.chat_system_messages_deliver(max(e.id)) from kc_private.outbox_events e where e.topic = 'chat_system_message'),
  0, 'performing the same event again writes nothing');

-- ── Shared-chat predicate for the handoffs module ───────────────────────────
select is(kc_private.members_share_chat('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-00000000000a')
    and not kc_private.members_share_chat('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000d'),
  true, 'two members share a chat once they have exchanged a message');

-- ── Account removal (FR-CHAT-013, design §4.1) ──────────────────────────────
select is(pg_temp.act('b', $$select public.send_message(#ab, 'bye')$$), 'ok', 'Bob answers');
delete from auth.users where id = '00000000-0000-4000-8000-00000000000a';
select is(pg_temp.val($$select count(*) || '/' || count(sender_id) from public.messages m
    join public.chats c on c.id = m.chat_id where c.direct_user_b = @b and c.direct_user_a is null and m.kind <> 'system'$$),
  '6/1', 'the other member keeps the thread; the removed member''s messages have no sender');
select is(pg_temp.val_as('b', $$select string_agg(coalesce(counterpart_display_name, 'deleted'), ',') from public.chat_inbox_page()$$),
  'deleted,Member c', 'the inbox shows the removed member as a placeholder');
delete from auth.users where id = '00000000-0000-4000-8000-00000000000b';
select is(pg_temp.val($$select count(*) filter (where direct_user_a is null and direct_user_b is null) || '/' || count(*)
    from public.chats where kind = 'direct'$$), '0/2', 'a chat with no member left is removed; chats with a member left stay');

select * from finish();
rollback;
