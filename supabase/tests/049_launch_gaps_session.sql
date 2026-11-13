-- M06 the counterpart's contact phone · M11 world consents at session start · M24 the
-- account gate broadcast on the member's own topic.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

create function pg_temp.expand(p_sql text)
returns text language sql as $$
  select regexp_replace(p_sql, '@([a-e])', '''00000000-0000-4000-8000-00000000000\1''::uuid', 'g');
$$;

-- One value of a query run as a member (null = signed out); an error returns its SQLSTATE
-- or P0001 message. p_topic is the realtime topic the member joined.
create function pg_temp.q(p_who text, p_sql text, p_topic text default '')
returns text
language plpgsql
as $$
declare
  v_value text;
  v_sql constant text := pg_temp.expand(p_sql);
begin
  perform set_config('request.jwt.claims', case when p_who is null then '{"role":"anon"}'
    else jsonb_build_object('sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', 'authenticated')::text end, true);
  perform set_config('realtime.topic', p_topic, true);
  perform set_config('role', case when p_who is null then 'anon' else 'authenticated' end, true);
  execute v_sql into v_value;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '{}', true);
  return coalesce(v_value, '~');
exception when others then
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '{}', true);
  return case sqlstate when 'P0001' then sqlerrm else sqlstate end;
end;
$$;

select plan(21);

insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b', 'c']) x;
update public.user_private set contact_phone = '050-1234567' where user_id = '00000000-0000-4000-8000-00000000000b';
update public.user_private set contact_phone = '052-7654321' where user_id = '00000000-0000-4000-8000-00000000000a';

-- ── M06: contact phone of the chat counterpart ──────────────────────────────
select is(pg_temp.q('a', 'select public.open_direct_chat(@b)::text') is not null, true, 'a opens a chat with b');
select is(pg_temp.q('a', $$select public.chat_counterpart_contact((select id from public.chats where kind = 'direct'))$$), '050-1234567',
  'a member reads the other member''s contact phone, verbatim');
select is(pg_temp.q('b', $$select public.chat_counterpart_contact((select id from public.chats where kind = 'direct'))$$), '052-7654321',
  'and the other way round: never their own number');
select is(pg_temp.q('c', format($f$select coalesce(public.chat_counterpart_contact(%L), '~')$f$, (select id from public.chats where kind = 'direct'))), '~',
  'a member outside the chat gets nothing');
select is(pg_temp.q(null, $$select public.chat_counterpart_contact((select id from public.chats where kind = 'direct'))$$), '42501',
  'a signed-out caller has no access to the function');
select is(pg_temp.q('a', $$select coalesce(public.chat_counterpart_contact(gen_random_uuid()), '~')$$), '~', 'an unknown chat gives nothing');
select is(pg_temp.q('a', $$select user_id::text from public.user_private where user_id = @b$$), '~', 'the number is still not readable from the table');
update public.user_private set contact_phone = null where user_id = '00000000-0000-4000-8000-00000000000b';
select is(pg_temp.q('a', $$select coalesce(public.chat_counterpart_contact((select id from public.chats where kind = 'direct')), '~')$$), '~',
  'an empty field returns null');
update public.user_private set contact_phone = '050-1234567' where user_id = '00000000-0000-4000-8000-00000000000b';
select is(pg_temp.q('a', 'select public.open_support_thread()::text') is not null, true, 'a opens a support thread');
select is(pg_temp.q('a', $$select coalesce(public.chat_counterpart_contact((select id from public.chats where kind = 'support')), '~')$$), '~',
  'the support thread has no counterpart contact');
update public.user_account set status = 'suspended_admin' where user_id = '00000000-0000-4000-8000-00000000000b';
select is(pg_temp.q('a', $$select coalesce(public.chat_counterpart_contact((select id from public.chats where kind = 'direct')), '~')$$), '~',
  'a counterpart whose account is not active shows no number');
update public.user_account set status = 'active' where user_id = '00000000-0000-4000-8000-00000000000b';
insert into public.blocks (blocker_id, blocked_id) values
  ('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-00000000000a');
select is(pg_temp.q('a', $$select coalesce(public.chat_counterpart_contact((select id from public.chats where kind = 'direct')), '~')$$), '~',
  'a blocked pair loses the chat and the number');
delete from public.blocks;

-- ── M11: consents in force at session start ────────────────────────────────
select is(pg_temp.q('c', $$select (public.bootstrap_session() -> 'consents') ->> 'driver_declaration'$$), '{"version": 1, "accepted": false}',
  'session start names the driver declaration version, not yet accepted');
select is(pg_temp.q('c', $$select (public.bootstrap_session() -> 'consents' -> 'housing_conduct' ->> 'version')$$), '1', 'and the housing code of conduct version');
select is(pg_temp.q('c', $$select public.accept_world_consent('driver_declaration', (public.bootstrap_session() -> 'consents' -> 'driver_declaration' ->> 'version')::integer)::text is not null$$),
  'true', 'the version the app read is the one that is accepted');
select is(pg_temp.q('c', $$select public.bootstrap_session() -> 'consents' -> 'driver_declaration' ->> 'accepted'$$), 'true', 'afterwards it shows as accepted');
select is(pg_temp.q('b', $$select public.bootstrap_session() -> 'consents' -> 'driver_declaration' ->> 'accepted'$$), 'false', 'for that member only');

-- ── M24: the account gate on the member's own topic ─────────────────────────
delete from realtime.messages;
update public.user_account set status = 'suspended_admin', status_until = now() + interval '3 days'
 where user_id = '00000000-0000-4000-8000-00000000000a';
select is((select payload ->> 'status' from realtime.messages
            where topic = 'user:00000000-0000-4000-8000-00000000000a:account' and event = 'account_changed'),
  'suspended_admin', 'a suspension is broadcast to the member''s account topic');
update public.user_account set false_reports_count = 1 where user_id = '00000000-0000-4000-8000-00000000000a';
select is((select count(*) from realtime.messages where topic like '%:account')::text, '1', 'a change that is not part of the gate sends nothing');
select is(pg_temp.q('a', 'select count(*)::text from realtime.messages', 'user:00000000-0000-4000-8000-00000000000a:account'), '1',
  'the member can listen to their own account topic');
select is(pg_temp.q('b', 'select count(*)::text from realtime.messages', 'user:00000000-0000-4000-8000-00000000000a:account'), '0',
  'another member cannot');

select * from finish();
rollback;
