-- The inbox row (chat_inbox_page) carries the other member's verification level and what
-- the newest message is when it has no text: the media type or the system payload. A member
-- outside the chat sees nothing of it; an inactive counterpart shows no identity at all.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Runs a statement as a member (anon when null) and returns its one value as text, the
-- P0001 or 42501 message, or the SQLSTATE.
create function pg_temp.as_member(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  begin
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', '00000000-0000-4000-8000-00000000000' || p_who,
      'role', case when p_who is null then 'anon' else 'authenticated' end)::text, true);
    perform set_config('role', case when p_who is null then 'anon' else 'authenticated' end, true);
    execute p_sql into v_value;
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '{}', true);
    return coalesce(v_value, 'ok');
  exception when others then
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '{}', true);
    return case when sqlstate in ('P0001', '42501') then sqlerrm else sqlstate end;
  end;
end;
$$;

-- The caller's inbox as `kind:verification:media type:system kind:preview` per chat
-- ('-' for a null).
create function pg_temp.inbox(p_who text)
returns text
language sql
as $$
  select pg_temp.as_member(p_who, $q$select coalesce(string_agg(concat_ws(':', last_message_kind,
      coalesce(counterpart_verification_level::text, '-'), coalesce(last_message_media_type, '-'),
      coalesce(last_message_system_payload ->> 'kind', '-'), coalesce(last_message_preview, '-')), ' ; '), 'empty')
      from public.chat_inbox_page()$q$);
$$;

select plan(7);

-- Alice and Bob talk; Bob has a verified identity; Carol is outside the chat.
insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b', 'c']) x;
update public.users set verification_level = 2 where id = '00000000-0000-4000-8000-00000000000b';

select is(pg_temp.as_member('a', $$select 'ok' from public.send_message(
      (public.open_direct_chat('00000000-0000-4000-8000-00000000000b')).id, 'hello')$$),
  'ok', 'Alice writes to Bob');
select is(pg_temp.inbox('a') || ' / ' || pg_temp.inbox('b'), 'user:2:-:-:hello / user:0:-:-:hello',
  'each side sees the other''s verification level and the text preview');

select is(pg_temp.as_member('b', $$select 'ok' from public.send_message(
      (select c.id from public.chats c), null, '{"type":"image","path":"b/chat/1.jpg"}')$$)
    || ' ' || pg_temp.inbox('a'), 'ok media:2:image:-:-', 'a photo is previewed by its media type');

insert into public.messages (chat_id, kind, system_payload)
select c.id, 'system', '{"kind":"post_closed","status":"closed_delivered","delivered_to_chat_member":true}' from public.chats c;
select is(pg_temp.inbox('a') || ' ' || pg_temp.as_member('a', $$select last_message_system_payload ->> 'status' from public.chat_inbox_page()$$),
  'system:2:-:post_closed:- closed_delivered', 'a system message is previewed from its payload');

select is(pg_temp.inbox('c'), 'empty', 'a member outside the chat sees nothing of it');
update public.users set is_active = false where id = '00000000-0000-4000-8000-00000000000b';
select is(pg_temp.inbox('a'), 'system:-:-:post_closed:-', 'an inactive counterpart shows no verification level');
select is(pg_temp.as_member(null, 'select count(*)::text from public.chat_inbox_page()'),
  'permission denied for function chat_inbox_page', 'a signed-out caller cannot read an inbox');

select * from finish();
rollback;
