-- Blocked users list (FR-MOD-004 AC1) and the staff support inbox (FR-MOD-002, FR-CHAT-007,
-- FR-ADMIN-013 AC2): a member lists only their own blocks, keyset paged; a support issue is a
-- `support_issue` system message with a stable id and a server-side length check; staff read
-- support threads, list them and join them, members never do.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
set local kc.rate_limit_exempt = 'on';

-- Runs a statement as a member (@x = member with hex digit x; anon when null) and returns its
-- one value as text, 'ok' for no value, the P0001 / 42501 message, or the SQLSTATE.
create function pg_temp.as_member(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  p_sql := regexp_replace(p_sql, '@([0-9a-f])', '''00000000-0000-4000-8000-00000000000\1''::uuid', 'g');
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

select plan(24);

-- Ann, Ben, Cat, Dan are members; Eve is support staff, Fay a moderator.
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}',
       jsonb_build_object('full_name', n, 'avatar_url', 'https://img.test/' || x)
  from (values ('a', 'Ann'), ('b', 'Ben'), ('c', 'Cat'), ('d', 'Dan'), ('e', 'Eve'), ('f', 'Fay')) v (x, n);
insert into public.admin_role_grants (user_id, role) values
  ('00000000-0000-4000-8000-00000000000e', 'support'),
  ('00000000-0000-4000-8000-00000000000f', 'moderator');

-- ── Blocked users ───────────────────────────────────────────────────────────
insert into public.blocks (blocker_id, blocked_id, created_at) values
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b', now() - interval '3 days'),
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000c', now() - interval '2 days'),
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000d', now() - interval '1 day'),
  ('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-00000000000a', now());

select is(pg_temp.as_member('a', $$select count(*) from public.users where id in (@b, @c, @d)$$), '0',
  'the blocked members'' profiles are hidden from the blocker');
select is(pg_temp.as_member('a', $$select string_agg(display_name || '|' || avatar_url, ',')
    from public.list_my_blocked_users()$$),
  'Dan|https://img.test/d,Cat|https://img.test/c,Ben|https://img.test/b',
  'the blocker lists every block with name and avatar, newest first');
select is(pg_temp.as_member('a', $$select string_agg(l.display_name, ',') from public.list_my_blocked_users(
    (select created_at from public.blocks where blocker_id = @a and blocked_id = @c), @c, 5) l$$),
  'Ben', 'the next page starts after the cursor');
select is(pg_temp.as_member('a', $$select string_agg(display_name, ',') from public.list_my_blocked_users(null, null, 1)$$),
  'Dan', 'the page size is honoured');
select is(pg_temp.as_member('b', $$select string_agg(display_name, ',') from public.list_my_blocked_users()$$),
  'Ann', 'a member sees only the blocks they made, never who blocked them');
select is(pg_temp.as_member('a', $$delete from public.blocks where blocker_id = @a and blocked_id = @c returning 'ok'$$)
    || ' ' || pg_temp.as_member('a', $$select string_agg(display_name, ',') from public.list_my_blocked_users()$$),
  'ok Dan,Ben', 'an unblocked member leaves the list');
select is(pg_temp.as_member('a', $$select count(*) from public.users where id = @c$$), '1',
  'and is visible again (D-11)');
select is(pg_temp.as_member(null, $$select count(*) from public.list_my_blocked_users()$$),
  'permission denied for function list_my_blocked_users', 'a signed-out caller cannot call it');

-- ── Support issues ──────────────────────────────────────────────────────────
select is(pg_temp.as_member('c', $$select kind from public.submit_support_issue('Bug', '   too short  ')$$),
  'description_too_short', 'a description under ten characters is refused');
select is(pg_temp.as_member('c', format($$select kind from public.submit_support_issue('Bug', %L)$$, repeat('x', 501))),
  'description_too_long', 'a description over 500 characters is refused by the server (AC6)');
select is(pg_temp.as_member('c', $$select kind from public.submit_support_issue('Billing', 'the app crashes on start')$$),
  'invalid_support_category', 'an unknown category is refused');
select is(pg_temp.as_member('c', $$select kind from public.submit_support_issue('Bug',
    '  the app crashes on start  ', '20000000-0000-4000-8000-000000000001')$$)
    || ' ' || pg_temp.as_member('c', $$select kind from public.submit_support_issue('Bug',
    'the app crashes on start', '20000000-0000-4000-8000-000000000001')$$),
  'support support', 'an issue opens the member''s support thread; the same issue id files it once');
select is((select count(*) || ' ' || max(m.system_payload ->> 'issue_id') || ' ' || max(m.system_payload ->> 'category')
               || ' ' || max(m.system_payload ->> 'description')
             from public.messages m
             join public.chats c on c.id = m.chat_id and c.support_user_id = '00000000-0000-4000-8000-00000000000c'
            where m.kind = 'system' and m.system_payload ->> 'kind' = 'support_issue'),
  '1 20000000-0000-4000-8000-000000000001 Bug the app crashes on start',
  'one system message carries the stable id, the category and the trimmed description');
select is((select string_agg(e.payload ->> 'recipient_id', ',' order by e.payload ->> 'recipient_id')
             from kc_private.outbox_events e
            where e.topic = 'notification' and e.payload ->> 'kind' = 'support_issue_received'),
  '00000000-0000-4000-8000-00000000000e,00000000-0000-4000-8000-00000000000f',
  'every staff member is told once about the new issue');
select is((select count(*) from public.reports), 0::bigint, 'a support issue writes no report (AC5)');

-- ── Staff and support threads ───────────────────────────────────────────────
select is(pg_temp.as_member('d', $$select count(*) from public.messages m join public.chats c on c.id = m.chat_id
    where c.kind = 'support'$$), '0', 'a member reads no other member''s support thread');
select is(pg_temp.as_member('e', $$select count(*) from public.messages m join public.chats c on c.id = m.chat_id
    where c.support_user_id = @c$$), '1', 'support staff read a support thread without joining it');
select is(pg_temp.as_member('e', $$select string_agg(member_display_name || '|' || joined, ',')
    from public.admin_list_support_threads()$$), 'Cat|false',
  'staff list the support threads that have messages, with the member and their own membership');
select is(pg_temp.as_member('d', $$select count(*) from public.admin_list_support_threads()$$), 'forbidden',
  'a member cannot list support threads');
select is(pg_temp.as_member('e', $$select kind from public.admin_join_support_thread(
      (select id from public.chats where support_user_id = @c))$$)
    || ' ' || pg_temp.as_member('e', $$select kind from public.admin_join_support_thread(
      (select id from public.chats where support_user_id = @c))$$)
    || ' ' || pg_temp.as_member('e', $$select 'sent' from public.send_message(
      (select id from public.chats where support_user_id = @c), 'we are on it')$$)
  ,
  'support support sent', 'staff join a thread as its support agent and answer it');
-- A scalar subquery runs before the calls of its statement, so the effects are read apart.
select is((select count(*) from audit.events e where e.action = 'join_support_thread'), 1::bigint,
  'a second join changes nothing and is audited once');
select is(pg_temp.as_member('f', $$select support_user_id = @d from public.admin_open_member_support_thread(@d)$$),
  'true', 'staff open a member''s support thread from a case');
select is((select string_agg(cm.role, ',' order by cm.role) from public.chat_members cm
                join public.chats c on c.id = cm.chat_id and c.support_user_id = '00000000-0000-4000-8000-00000000000d'),
  'member,support_agent', 'the thread is created for the member and joined by the staff member');
select is(pg_temp.as_member('d', $$select kind from public.admin_join_support_thread(
      (select id from public.chats where support_user_id = @d))$$),
  'forbidden', 'a member cannot join as staff, not even their own thread');

select * from finish();
rollback;
