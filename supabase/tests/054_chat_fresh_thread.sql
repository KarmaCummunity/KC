-- A chat a member removed from their inbox does not come back with its history (0028,
-- FR-CHAT-004 AC1, FR-CHAT-016): contacting the same member again, or their next message,
-- opens a clean thread for the member who removed it; the other member keeps everything.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- One value as a member: the first column of the first row, the P0001 message, or the SQLSTATE.
create function pg_temp.as_member(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  begin
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    execute p_sql into v_value;
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '{}', true);
    return coalesce(v_value, 'null');
  exception when others then
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '{}', true);
    return case sqlstate when 'P0001' then sqlerrm else sqlstate end;
  end;
end;
$$;

-- Sends a message as a member, a moment after the previous one (created_at is unique per chat).
create function pg_temp.say(p_who text, p_body text)
returns text
language sql
as $$
  select pg_temp.as_member(p_who, format(
    'select (public.send_message((select id from public.chats limit 1), %L)).id::text', p_body));
$$;

select plan(9);

insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b']) x;
update public.users set display_name = 'Member ' || right(id::text, 1);

select isnt(pg_temp.as_member('a', $$select (public.open_direct_chat('00000000-0000-4000-8000-00000000000b')).id::text$$),
  null, 'Alice opens a chat with Bob');
select pg_temp.say('a', 'old one');
select pg_temp.say('b', 'old two');
select is(pg_temp.as_member('a', 'select count(*)::text from public.messages'), '2', 'both see the conversation');

-- Alice removes the chat from her inbox.
select is(pg_temp.as_member('a', 'select public.hide_chat((select id from public.chats limit 1))::text'), '',
  'Alice removes the chat');
select is(pg_temp.as_member('a', $$select count(*)::text from public.chat_messages_page((select id from public.chats limit 1))$$)
    || '|' || pg_temp.as_member('a', 'select count(*)::text from public.messages'),
  '0|0', 'the old history is gone for her, through the page and through the table');
select is(pg_temp.as_member('b', 'select count(*)::text from public.messages'), '2', 'Bob keeps the whole conversation');

-- Contacting Bob again opens the same pair's chat, clean for her.
select is(pg_temp.as_member('a', $$select count(*)::text from public.chat_messages_page(
      (public.open_direct_chat('00000000-0000-4000-8000-00000000000b')).id)$$),
  '0', 'contacting Bob again opens a clean thread for Alice');
select is(pg_temp.as_member('a', 'select count(*)::text from public.chat_inbox_page()'), '0',
  'a reopened chat with nothing new is not listed in her inbox yet');

-- Bob writes; the chat returns to Alice's inbox with only the new message.
select pg_temp.say('b', 'new one');
select is(pg_temp.as_member('a', $$select last_message_preview || '|' || unread_count from public.chat_inbox_page()$$),
  'new one|1', 'the chat returns with only the new message, counted unread once');
select is(pg_temp.as_member('a', $$select string_agg(body, ',' order by created_at) from public.messages$$), 'new one',
  'Alice reads only what came after she removed the chat');

select * from finish();
rollback;
