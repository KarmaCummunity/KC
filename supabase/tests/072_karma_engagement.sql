-- Karma for engagement (spec 07 §7.6, FR-KARMA-002, FR-KARMA-006, KC#2391): signing up pays 1
-- once; a new follower pays 1 to the followed member and an unfollow takes it back; the first
-- message about another member's post pays 1 to the sender, once per post and at most 10 a day.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Runs a statement as member @x: 'ok', a P0001 message, or the SQLSTATE. Shorthand, resolved
-- as the database owner before the statement runs: `#name` the post titled `name`, `~xy` the
-- direct chat of members x and y.
create function pg_temp.act(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_sql text := p_sql;
  v_match text[];
begin
  for v_match in select regexp_matches(p_sql, '~([a-e])([a-e])', 'g') loop
    v_sql := replace(v_sql, '~' || v_match[1] || v_match[2], coalesce(quote_literal((
      select c.id from public.chats c
       where c.kind = 'direct'
         and ('00000000-0000-4000-8000-00000000000' || v_match[1])::uuid in (c.direct_user_a, c.direct_user_b)
         and ('00000000-0000-4000-8000-00000000000' || v_match[2])::uuid in (c.direct_user_a, c.direct_user_b))),
      'null') || '::uuid');
  end loop;
  for v_match in select regexp_matches(v_sql, '#(\w+)', 'g') loop
    v_sql := regexp_replace(v_sql, '#' || v_match[1] || '\M', coalesce(quote_literal((
      select p.id from public.posts p where p.title = v_match[1])), 'null') || '::uuid');
  end loop;
  v_sql := regexp_replace(v_sql, '@([a-e])', '''00000000-0000-4000-8000-00000000000\1''::uuid', 'g');
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute v_sql;
  perform set_config('role', 'none', true);
  return 'ok';
exception when others then
  perform set_config('role', 'none', true);
  return case sqlstate when 'P0001' then sqlerrm else sqlstate end;
end;
$$;

-- A member's karma total.
create function pg_temp.karma(p_who text)
returns integer
language sql
as $$
  select karma_points from public.user_stats
   where user_id = ('00000000-0000-4000-8000-00000000000' || p_who)::uuid;
$$;

-- Award events of a type recorded for a member.
create function pg_temp.awards(p_event_type text, p_who text)
returns bigint
language sql
as $$
  select count(*) from kc_private.outbox_events e
   where e.topic = 'karma' and e.payload ->> 'kind' = 'award' and e.payload ->> 'event_type' = p_event_type
     and e.payload ->> 'user_id' = '00000000-0000-4000-8000-00000000000' || p_who;
$$;

select plan(17);

-- ── Sign-up ──────────────────────────────────────────────────────────────────
insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b', 'c']) x;
select is(pg_temp.awards('registration', 'a') || '/' || pg_temp.karma('a'), '1/0',
  'signing up records one award and writes no karma by itself');
select is(kc_private.karma_process(), 3, 'the consumer performs the three sign-ups');
select is(pg_temp.karma('a') || '/' || pg_temp.karma('b') || '/' || pg_temp.karma('c'), '1/1/1', 'each new member holds 1 point');
select is(kc_private.karma_deliver((select min(id) from kc_private.outbox_events where topic = 'karma')), 0,
  'performing a sign-up again pays nothing');

-- ── Followers ────────────────────────────────────────────────────────────────
select is(pg_temp.act('b', 'select public.follow_user(@a)'), 'ok', 'Bob follows Alice');
do $$ begin perform kc_private.karma_process(); end $$;
select is(pg_temp.karma('a') || '/' || pg_temp.karma('b'), '2/1', 'the followed member earns 1; the follower earns nothing');
select is((select count(*) from public.karma_ledger
            where user_id = '00000000-0000-4000-8000-00000000000a' and event_type = 'follower_gained' and points = 1),
  1::bigint, 'the ledger names the event');
select is(pg_temp.act('b', 'delete from public.follows where follower_id = @b and followed_id = @a'), 'ok', 'Bob unfollows');
do $$ begin perform kc_private.karma_process(); end $$;
select is(pg_temp.karma('a'), 1, 'the point of the lost follower is taken back');
select is(pg_temp.act('c', 'select public.follow_user(@a)'), 'ok', 'Carol follows Alice');
do $$ begin perform kc_private.karma_process(); end $$;
select is(pg_temp.karma('a'), 2, 'another follower pays again');

-- ── First contact on a post ──────────────────────────────────────────────────
insert into public.cities (city_id, name_he, name_en, location) values ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)');
insert into public.worlds (slug, label_he, label_en) values ('items', 'items', 'items');
insert into public.post_kinds (id, world_slug, slug, label_he, label_en, direction)
values ('20000000-0000-4000-8000-000000000001', 'items', 'item', 'item', 'item', 'either');
-- Alice asks for twelve things: `chair`, then `need1` … `need11`.
insert into public.posts (owner_id, world_slug, kind_id, direction, status, title, city_id)
select '00000000-0000-4000-8000-00000000000a', 'items', '20000000-0000-4000-8000-000000000001', 'request', 'open',
       case n when 0 then 'chair' else 'need' || n end, 'c1'
  from generate_series(0, 11) n;
-- Publishing has its own award and suite (072_karma_post_published.sql); set it aside.
delete from kc_private.outbox_events where topic = 'karma' and payload ->> 'event_type' = 'post_published';

select is(pg_temp.act('b', 'select public.open_direct_chat(@a, #chair)')
    || pg_temp.act('b', $$select public.send_message(~ab, 'I have one')$$), 'okok', 'Bob writes to Alice about her post');
do $$ begin perform kc_private.karma_process(); end $$;
select is(pg_temp.karma('b'), 2, 'the first contact on a post pays the sender 1');
select is(pg_temp.act('b', $$select public.send_message(~ab, 'still there?')$$)
    || pg_temp.act('a', $$select public.send_message(~ab, 'yes')$$), 'okok', 'the conversation goes on');
select is(pg_temp.awards('outreach', 'b') || '/' || pg_temp.awards('outreach', 'a'), '1/0',
  'a second message records nothing, and neither does the owner''s reply');
select is(pg_temp.act('c', 'select public.open_direct_chat(@b)')
    || pg_temp.act('c', $$select public.send_message(~cb, 'hello')$$) || pg_temp.awards('outreach', 'c'), 'okok0',
  'a chat that is not about a post records nothing');

-- Bob writes about eleven more posts on the same day: the cap of 10 awards a day holds.
do $$
begin
  for n in 1..11 loop
    -- The whole suite runs in one instant, so the chat rate limit (10 messages a second)
    -- would stop the loop; its counters are cleared between messages.
    delete from kc_private.rate_limit_counters;
    perform pg_temp.act('b', format('select public.open_direct_chat(@a, #need%s)', n))
         || pg_temp.act('b', format('select public.send_message(~ab, %L)', 'about ' || n));
  end loop;
  perform kc_private.karma_process();
end $$;
select is(pg_temp.awards('outreach', 'b') || '/' || pg_temp.karma('b'), '12/11',
  'twelve contacts are recorded and ten are paid (1 for signing up + 10)');

select * from finish();
rollback;
