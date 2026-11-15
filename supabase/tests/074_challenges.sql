-- Challenges: opening writes a post and joins the creator; joins, reports, streaks and
-- completion follow the spec; progress is private; the lifecycle moves only along its
-- machine; karma is requested through the outbox and reversed on leaving.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Runs a statement as member @x (anon when null): 'ok', a P0001 message, or the SQLSTATE.
-- `#1` / `#2` are the community / personal challenge of the fixture.
create function pg_temp.sql(p_sql text)
returns text
language sql
as $$
  select replace(replace(regexp_replace(p_sql, '@([a-e])', '''00000000-0000-4000-8000-00000000000\1''::uuid', 'g'),
    '#1', coalesce(quote_literal((select id from public.challenges where scope = 'community')), 'null') || '::uuid'),
    '#2', coalesce(quote_literal((select id from public.challenges where scope = 'personal')), 'null') || '::uuid');
$$;
create function pg_temp.act(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_role constant text := case when p_who is null then 'anon' else 'authenticated' end;
  v_sql constant text := pg_temp.sql(p_sql);
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', v_role)::text, true);
  perform set_config('role', v_role, true);
  execute v_sql;
  perform set_config('role', 'none', true);
  return 'ok';
exception when others then
  perform set_config('role', 'none', true);
  return case sqlstate when 'P0001' then sqlerrm else sqlstate end;
end;
$$;
-- One value member @x reads with a query.
create function pg_temp.get(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_sql constant text := pg_temp.sql(p_sql);
  v_value text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute v_sql into v_value;
  perform set_config('role', 'none', true);
  return v_value;
end;
$$;
-- Karma events of an event type recorded for a member.
create function pg_temp.karma_events(p_event_type text, p_who text)
returns bigint
language sql
as $$
  select count(*) from kc_private.outbox_events e
   where e.topic = 'karma' and e.payload ->> 'event_type' = p_event_type
     and e.payload ->> 'user_id' = '00000000-0000-4000-8000-00000000000' || p_who;
$$;

select plan(50);

-- Alice opens challenges. Bob and Carol join. Dan and Alice are blocked.
insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b', 'c', 'd']) x;
insert into public.blocks (blocker_id, blocked_id) values
  ('00000000-0000-4000-8000-00000000000d', '00000000-0000-4000-8000-00000000000a');
insert into public.cities (city_id, name_he, name_en, location) values ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)');
insert into public.worlds (slug, label_he, label_en, geo_mode) values ('challenges', 'challenges', 'challenges', 'remote');

-- ── Opening ──────────────────────────────────────────────────────────────────
select is(pg_temp.act('a', $$select public.create_challenge('Run daily', 'community', 'count', 'daily', p_city_id => 'c1')$$),
  'challenge_world_not_configured', 'a challenge needs a post kind of the challenges world');
insert into public.post_kinds (world_slug, slug, label_he, label_en, direction) values ('challenges', 'challenge', 'c', 'c', 'offer');
select is(pg_temp.act('a', $$select public.create_challenge('Run daily', 'community', 'count', 'daily',
    p_goal_value => 5, p_goal_direction => 'at_least', p_target_cycles => 2, p_city_id => 'c1')$$), 'ok', 'a member opens a community challenge');
select is(pg_temp.act('a', $$select public.create_challenge('Read a page', 'personal', 'yes_no', 'daily', p_city_id => 'c1')$$), 'ok',
  'and a personal one');
select is((select string_agg(p.post_type || ':' || p.visibility || ':' || p.status, ',' order by p.visibility)
             from public.posts p join public.challenges c on c.post_id = p.id),
  'challenge:OnlyMe:open,challenge:Public:open', 'each challenge owns an open post: public for a community one, private for a personal one');
select is((select count(*) from public.challenge_participations), 2::bigint, 'the creator is the first participant');
select is(pg_temp.karma_events('challenge_opened', 'a'), 2::bigint, 'opening asks for karma through the outbox');
select is(pg_temp.act('a', $$select public.create_challenge('x', 'community', 'count', 'daily', p_city_id => 'c1')$$), 'invalid_input', 'a title has at least three characters');
select is(pg_temp.act('a', $$select public.create_challenge('In the past', 'community', 'count', 'daily',
    p_ends_at => now() - interval '1 hour', p_city_id => 'c1')$$), 'invalid_input', 'a deadline lies ahead');
select is(pg_temp.act('a', $$select public.create_challenge('Yes or no', 'community', 'yes_no', 'daily',
    p_goal_value => 5, p_goal_direction => 'at_least', p_city_id => 'c1')$$), '23514', 'a yes/no challenge has no numeric goal');
select is(pg_temp.act('a', $$select public.create_challenge('No city', 'community', 'count', 'daily')$$), 'city_required',
  'a challenge needs a city, given or from the profile');
select is(pg_temp.act(null, $$select public.create_challenge('Signed out', 'community', 'count', 'daily')$$), '42501',
  'a signed-out caller cannot open a challenge');

-- ── Who reads and writes what ────────────────────────────────────────────────
select is(pg_temp.get('b', 'select count(*) from public.challenges'), '1', 'another member sees the community challenge only');
select is(pg_temp.get('d', 'select count(*) from public.challenges'), '0', 'a blocked member sees none of them');
select is(pg_temp.act(null, 'select 1 from public.challenges'), '42501', 'a signed-out caller reads nothing');
select is(pg_temp.act('b', $$update public.challenges set status = 'ended'$$), '42501', 'a challenge is not writable from a device');
select is(pg_temp.act('b', $$insert into public.challenge_participations (challenge_id, user_id) values (#1, @b)$$), '42501',
  'a participation is not inserted from a device');
select is(pg_temp.act('b', $$insert into public.posts (owner_id, world_slug, kind_id, post_type, direction, title, city_id)
    select @b, 'challenges', k.id, 'challenge', 'offer', 'bare', 'c1' from public.post_kinds k where k.world_slug = 'challenges';
    set constraints all immediate$$), 'post_details_required', 'a challenge post cannot exist without its challenge');

-- ── Joining ──────────────────────────────────────────────────────────────────
select is(pg_temp.act('b', 'select public.join_challenge(#1)'), 'ok', 'a member joins a community challenge');
select is(pg_temp.act('b', 'select public.join_challenge(#1)'), 'already_joined', 'once');
select is(pg_temp.act('b', 'select public.join_challenge(#2)'), 'challenge_not_found', 'a personal challenge cannot be joined');
select is(pg_temp.act('d', 'select public.join_challenge(#1)'), 'challenge_not_found', 'a blocked member cannot join');
select is(pg_temp.act('c', 'select public.join_challenge(#1)'), 'ok', 'Carol joins too');
select is((select participants_count from public.challenges where scope = 'community'), 3, 'the participant counter follows');

-- ── Reports, streak, completion ──────────────────────────────────────────────
select is(pg_temp.act('d', 'select public.report_challenge_progress(#1, 6)'), 'not_participant', 'only a participant reports');
select is(pg_temp.get('b', $$select r ->> 'goal_met' || '/' || (r ->> 'current_streak')
    from public.report_challenge_progress(#1, 6) r$$), 'true/1', 'a report that meets the goal starts a streak');
select is(pg_temp.get('b', $$select r ->> 'goal_met' || '/' || (r ->> 'current_streak')
    from public.report_challenge_progress(#1, 3) r$$), 'false/0', 'filing again in the same cycle overwrites the report');
select is(pg_temp.act('b', $$select public.report_challenge_progress(#1, 6, null, (now() at time zone 'Asia/Jerusalem')::date + 1)$$),
  'report_date_out_of_window', 'a report is never dated ahead');
select is(pg_temp.act('b', $$select public.report_challenge_progress(#1, 6, null, (now() at time zone 'Asia/Jerusalem')::date - 3)$$),
  'report_date_out_of_window', 'nor more than two days back');
select is(pg_temp.act('b', 'select public.report_challenge_progress(#1, -1)'), 'invalid_input', 'a value is not negative');
select is(pg_temp.act('b', $$select public.report_challenge_progress(#1, 7, 'yesterday', (now() at time zone 'Asia/Jerusalem')::date - 1)$$),
  'ok', 'yesterday can still be reported');
select is(pg_temp.get('b', $$select (r ->> 'current_streak') || '/' || (r ->> 'successful_cycles') || '/' || (r ->> 'completed')
    from public.report_challenge_progress(#1, 9) r$$), '2/2/true', 'two successful days in a row are a streak of two and complete the challenge');
select is(pg_temp.karma_events('challenge_report', 'b') || '+' || pg_temp.karma_events('challenge_completed', 'b'), '2+1',
  'karma is asked once per new cycle and once for the completion');
select is(pg_temp.get('b', 'select count(*) from public.challenge_progress_entries') || '/'
       || pg_temp.get('a', 'select count(*) from public.challenge_progress_entries'), '2/0', 'reports are readable by their author only');

-- ── Lists ────────────────────────────────────────────────────────────────────
select is(pg_temp.get('c', 'select count(*) from public.list_challenge_leaderboard(#1)'), '3', 'participants see the standing of all three');
select is(pg_temp.get('c', 'select user_id = @b from public.list_challenge_leaderboard(#1) limit 1'), 'true', 'the longest streak leads');
select is(pg_temp.get('d', 'select count(*) from public.list_challenge_leaderboard(#1)'), '0', 'a non-participant sees no standing');
select is(pg_temp.get('c', $$select count(*) from public.list_challenges('discover')$$) || '/'
       || pg_temp.get('b', $$select count(*) from public.list_challenges('joined')$$) || '/'
       || pg_temp.get('a', $$select count(*) from public.list_challenges('created')$$) || '/'
       || pg_temp.get('a', $$select count(*) from public.list_challenges('created', (select next_cursor
            from public.list_challenges('created', null, 1)), 1)$$) || '/'
       || pg_temp.get('b', 'select count(*) from public.get_challenge(#2)'), '1/1/2/1/0',
  'discover, joined and created list what the caller may see, page by keyset, and a personal challenge stays private');

-- ── Leaving ──────────────────────────────────────────────────────────────────
do $$ begin perform kc_private.karma_process(); end $$;
select is((select karma_points from public.user_stats where user_id = '00000000-0000-4000-8000-00000000000b'), 19,
  'two community reports (2 + 2) and the completion (15) were paid');
select is(pg_temp.act('a', 'select public.leave_challenge(#1)'), 'creator_cannot_leave', 'the creator ends the challenge instead of leaving');
select is(pg_temp.act('b', 'select public.leave_challenge(#1)'), 'ok', 'a participant leaves');
do $$ begin perform kc_private.karma_process(); end $$;
select is((select count(*) from public.challenge_progress_entries)::text || '/'
       || (select karma_points from public.user_stats where user_id = '00000000-0000-4000-8000-00000000000b'), '0/0',
  'their reports go with them and the karma earned in the challenge is reversed');

-- ── Lifecycle ────────────────────────────────────────────────────────────────
select throws_ok($$update public.challenges set status = 'ended' where scope = 'community'$$, 'P0001', 'forbidden_role',
  'ending needs the role of a manager');
select throws_ok($$update public.challenges set status = 'paused' where scope = 'community'$$, 'P0001', 'unknown_state',
  'a status outside the machine is refused');
select is(pg_temp.act('c', 'select public.end_challenge(#1)'), 'challenge_not_found', 'a participant cannot end the challenge');
select is(pg_temp.act('a', 'select public.end_challenge(#1)'), 'ok', 'its creator ends it');
select is((select c.status || ':' || p.status from public.challenges c join public.posts p on p.id = c.post_id
            where c.scope = 'community'), 'ended:paused', 'the challenge is ended and its post leaves the feed');
select throws_ok($$update public.challenges set status = 'active' where scope = 'community'$$, 'P0001', 'illegal_transition',
  'an ended challenge is not reopened');
select is(pg_temp.act('c', 'select public.report_challenge_progress(#1, 6)'), 'challenge_not_active', 'an ended challenge takes no reports');
select is(pg_temp.get('c', 'select status from public.get_challenge(#1)') || '/'
       || pg_temp.get('d', 'select count(*) from public.get_challenge(#1)'), 'ended/0',
  'a participant still reads an ended challenge; an outsider does not');

delete from auth.users where id = '00000000-0000-4000-8000-00000000000a';
select is((select count(*) from public.challenges) + (select count(*) from public.challenge_participations), 0::bigint,
  'removing the creator removes their challenges and every participation in them');

select * from finish();
rollback;
