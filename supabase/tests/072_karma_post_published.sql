-- Karma for publishing a post (spec 07 §7.6, FR-KARMA-005, KC#2289): a member's post pays 5
-- once it is published, whatever its type (an item, an event); at most 5 awards a day; an
-- admin's removal takes the points back and a restore returns them; a post the scheduler
-- publishes, an imported post and a challenge's post pay nothing.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Runs a statement as member @x: 'ok', a P0001 message, or the SQLSTATE. `#name` is the post
-- titled `name`, resolved as the database owner.
create function pg_temp.act(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_sql text := regexp_replace(p_sql, '@([a-e])', '''00000000-0000-4000-8000-00000000000\1''::uuid', 'g');
  v_match text[];
begin
  for v_match in select regexp_matches(v_sql, '#(\w+)', 'g') loop
    v_sql := regexp_replace(v_sql, '#' || v_match[1] || '\M', coalesce(quote_literal((
      select p.id from public.posts p where p.title = v_match[1])), 'null') || '::uuid');
  end loop;
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

-- Karma events of a kind recorded for a member (`award` or `revoke` of a published post).
create function pg_temp.events(p_kind text, p_who text)
returns bigint
language sql
as $$
  select count(*) from kc_private.outbox_events e
   where e.topic = 'karma' and e.payload ->> 'kind' = p_kind
     and e.payload ->> 'user_id' = '00000000-0000-4000-8000-00000000000' || p_who
     and coalesce(e.payload ->> 'subject', e.payload ->> 'subject_prefix') like 'post:%:published';
$$;

select plan(22);

-- Alice and Bob are members; Dan is the main admin.
insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b', 'c', 'd']) x;
insert into public.admin_role_grants (user_id, role) values ('00000000-0000-4000-8000-00000000000d', 'super_admin');
insert into public.cities (city_id, name_he, name_en, location) values ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)');
insert into public.worlds (slug, label_he, label_en) values ('items', 'items', 'items'), ('time', 'time', 'time');
insert into public.worlds (slug, label_he, label_en, geo_mode) values ('challenges', 'challenges', 'challenges', 'remote');
insert into public.post_kinds (id, world_slug, slug, label_he, label_en, direction) values
  ('20000000-0000-4000-8000-000000000001', 'items', 'item', 'item', 'item', 'either'),
  ('20000000-0000-4000-8000-000000000002', 'time', 'event', 'event', 'event', 'offer'),
  ('20000000-0000-4000-8000-000000000003', 'challenges', 'challenge', 'challenge', 'challenge', 'offer');

-- Signing up has its own award and suite (072_karma_engagement.sql); set it aside.
delete from kc_private.outbox_events where topic = 'karma';

-- ── A draft earns nothing; publishing it pays once ──────────────────────────
select is(pg_temp.act('a', $$insert into public.posts (owner_id, world_slug, kind_id, direction, status, title, city_id)
  values (@a, 'items', '20000000-0000-4000-8000-000000000001', 'request', 'draft', 'chair', 'c1')$$), 'ok', 'Alice saves a draft');
select is(pg_temp.events('award', 'a'), 0::bigint, 'a draft records no karma event');
select is(pg_temp.act('a', 'select public.publish_post(#chair)'), 'ok', 'Alice publishes it');
select is(pg_temp.events('award', 'a') || '/' || pg_temp.karma('a'), '1/0',
  'publishing records one award and writes no karma by itself');
select is(kc_private.karma_process(), 1, 'the consumer performs the award');
select is(pg_temp.karma('a'), 5, 'a published post pays 5');
select is((select event_type || ':' || points from public.karma_ledger
            where user_id = '00000000-0000-4000-8000-00000000000a'), 'post_published:5',
  'the ledger names the event');
select is(kc_private.karma_deliver((select max(id) from kc_private.outbox_events where topic = 'karma')), 0,
  'performing the same event again pays nothing');

-- Pausing and resuming is not a new publication.
do $$
declare
  v_post_id constant uuid := (select id from public.posts where title = 'chair');
begin
  perform kc_private.post_move(v_post_id, 'paused', 'owner');
  perform kc_private.post_move(v_post_id, 'open', 'owner');
end $$;
select is(pg_temp.events('award', 'a'), 1::bigint, 'a post that returns to open records no second award');

-- ── An event post pays like any other post (KC#2289) ─────────────────────────
select is(pg_temp.act('a', format('select public.create_post_with_details(%L::jsonb, %L::jsonb)',
    jsonb_build_object('world_slug', 'time', 'post_type', 'event', 'direction', 'offer', 'title', 'meetup',
      'city_id', 'c1', 'kind_id', '20000000-0000-4000-8000-000000000002'),
    jsonb_build_object('starts_at', now() + interval '1 day', 'ends_at', now() + interval '1 day 3 hours'))),
  'ok', 'Alice publishes an event');
select is(kc_private.karma_process() || '/' || pg_temp.karma('a'), '1/10', 'the event post pays 5 as well');

-- ── Removal by an admin takes the points back; a restore returns them ────────
select is(pg_temp.act('d', 'select public.admin_remove_post(#meetup)'), 'ok', 'the admin removes the event');
select is(pg_temp.events('revoke', 'a'), 1::bigint, 'the removal records a reversal');
select is(kc_private.karma_process() || '/' || pg_temp.karma('a'), '1/5', 'the points of the removed post are taken back');
select is((select count(*) from public.karma_ledger
            where user_id = '00000000-0000-4000-8000-00000000000a' and event_type = 'reversal' and points = -5),
  1::bigint, 'as a negative entry of its own');
select is(pg_temp.act('d', 'select public.admin_restore_post(#meetup)'), 'ok', 'the admin restores it');
select is(kc_private.karma_process() || '/' || pg_temp.karma('a'), '1/10', 'the restored post holds its points again');

-- ── What pays nothing ────────────────────────────────────────────────────────
-- The scheduler publishes the next date of a series in role `system`.
select set_config('kc.fsm_role', 'system', true);
insert into public.posts (owner_id, world_slug, kind_id, direction, status, title, city_id)
values ('00000000-0000-4000-8000-00000000000c', 'items', '20000000-0000-4000-8000-000000000001', 'request', 'open', 'scheduled', 'c1');
select set_config('kc.fsm_role', '', true);
insert into public.posts (owner_id, world_slug, kind_id, direction, status, title, city_id, source)
values ('00000000-0000-4000-8000-00000000000c', 'items', '20000000-0000-4000-8000-000000000001', 'request', 'open', 'imported', 'c1', 'imported');
select is(pg_temp.events('award', 'c'), 0::bigint, 'a post the scheduler publishes and an imported post record no award');
select is(pg_temp.act('c', $$select public.create_challenge('Read a page', 'personal', 'yes_no', 'daily', p_city_id => 'c1')$$), 'ok',
  'Carol opens a challenge');
select is(pg_temp.events('award', 'c') || '/' || (select count(*) from public.posts p
                                                  where p.post_type = 'challenge' and p.published_at is not null),
  '0/1', 'the published post of a challenge records no publishing award');

-- ── Daily cap ────────────────────────────────────────────────────────────────
insert into public.posts (owner_id, world_slug, kind_id, direction, status, title, city_id)
select '00000000-0000-4000-8000-00000000000b', 'items', '20000000-0000-4000-8000-000000000001', 'request', 'open', 'need ' || n, 'c1'
  from generate_series(1, 6) n;
select is(pg_temp.events('award', 'b'), 6::bigint, 'each of six published posts records an award');
do $$ begin perform kc_private.karma_process(); end $$;
select is(pg_temp.karma('b'), 25, 'the daily cap pays five of them');

select * from finish();
rollback;
