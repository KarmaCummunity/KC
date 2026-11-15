-- Feed and search: what a member's feed contains (visibility, hides, mutes, blocked owners,
-- main-feed worlds), every sort and filter, keyset paging that neither repeats nor skips a
-- post when many share a timestamp, limit bounds, profile tabs, post and member search, and
-- the personalisation tables.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Runs one statement as a member ('a'…'e') or as the signed-out role ('anon'); `#a` stands
-- for that member's id. Returns the first column of the first row, or the number of rows
-- changed when the statement returns nothing.
create function pg_temp.run(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_role constant text := case p_who when 'anon' then 'anon' else 'authenticated' end;
  v_sub constant text := case p_who when 'anon' then null else '00000000-0000-4000-8000-00000000000' || p_who end;
  v_out text;
  v_rows bigint;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_sub, 'role', v_role)::text, true);
  perform set_config('role', v_role, true);
  p_sql := regexp_replace(p_sql, '#([a-e])\M', '''00000000-0000-4000-8000-00000000000\1''::uuid', 'g');
  if p_sql ~* '^\s*(select|with)|\sreturning\s' then
    execute p_sql into v_out;
  else
    execute p_sql;
  end if;
  get diagnostics v_rows = row_count;
  perform set_config('role', 'none', true);
  return coalesce(v_out, v_rows::text);
end;
$$;

-- Titles of a member's feed for the given filters, in order, read page by page with the
-- given page size until a page comes back empty.
create function pg_temp.feed(p_who text, p_filters text default '{}', p_page integer default 50)
returns text
language plpgsql
as $$
declare
  v_titles text[] := '{}';
  v_cursor jsonb;
  v_page text[];
begin
  loop
    execute format(
      'select array_agg((f.card).title order by f.n), (array_agg(f.next_cursor order by f.n desc))[1]
         from public.feed_page(%L, %s, %L) with ordinality f (card, next_cursor, distance_m, n)',
      v_cursor, p_page, p_filters) into v_page, v_cursor;
    exit when v_page is null;
    v_titles := v_titles || v_page;
  end loop;
  return array_to_string(v_titles, ',');
end;
$$;
-- The same as a member: the role is set around the whole walk.
create function pg_temp.feed_as(p_who text, p_filters text default '{}', p_page integer default 50)
returns text
language plpgsql
as $$
declare
  v_out text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  v_out := pg_temp.feed(p_who, p_filters, p_page);
  perform set_config('role', 'none', true);
  return v_out;
end;
$$;
grant execute on function pg_temp.feed(text, text, integer) to authenticated;

select plan(53);

-- Alice is the viewer. She follows Bob, is in a blocked pair with Dan and muted Eve.
insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || m)::uuid, m || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b', 'c', 'd', 'e']) m;
insert into public.follows (follower_id, followed_id) values
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b');
insert into public.blocks (blocker_id, blocked_id) values
  ('00000000-0000-4000-8000-00000000000d', '00000000-0000-4000-8000-00000000000a');
insert into public.cities (city_id, name_he, name_en, location) values
  ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)'),
  ('c2', 'c2', 'City Two', 'SRID=4326;POINT(35.21 31.77)'),
  ('c3', 'c3', 'City Three', 'SRID=4326;POINT(34.95 29.56)');
update public.users set city_id = 'c1' where id = '00000000-0000-4000-8000-00000000000a';
update public.users u set display_name = m.name from (values ('a', 'alice Viewer'), ('b', 'bob Builder'),
    ('c', 'carol Baker'), ('d', 'dan Blocked'), ('e', 'eve Muted')) m (who, name)
 where u.id = ('00000000-0000-4000-8000-00000000000' || m.who)::uuid;
insert into public.worlds (slug, label_he, label_en, shows_in_main_feed) values
  ('items', 'items', 'Items', true), ('food', 'food', 'Food', true), ('knowledge', 'knowledge', 'Knowledge', false);
insert into public.post_kinds (id, world_slug, slug, label_he, label_en, direction) values
  ('20000000-0000-4000-8000-000000000001', 'items', 'item', 'item', 'Item', 'either'),
  ('20000000-0000-4000-8000-000000000002', 'food', 'meal', 'meal', 'Meal', 'either'),
  ('20000000-0000-4000-8000-000000000003', 'knowledge', 'lesson', 'lesson', 'Lesson', 'either');
insert into public.item_subcategories (id, world_slug, slug, label_he, label_en) values
  ('30000000-0000-4000-8000-000000000001', 'food', 'cooked', 'cooked', 'Cooked');

-- Posts published at fixed offsets inside yesterday's ranking window (UTC), so the order
-- never depends on the time of day the test runs. Five "tie" posts share one timestamp.
create temp table fixture (title text, owner text, world text, city text, visibility text, hours numeric,
                           direction text default 'offer', urgency smallint, id uuid default gen_random_uuid());
insert into fixture (title, owner, world, city, visibility, hours) values
  ('b public', 'b', 'items', 'c1', 'Public', 1), ('b followers', 'b', 'items', 'c2', 'FollowersOnly', 2),
  ('c public', 'c', 'food', 'c2', 'Public', 3), ('a own', 'a', 'items', 'c1', 'Public', 4),
  ('c closed', 'c', 'food', 'c3', 'Public', 5), ('c old', 'c', 'items', 'c1', 'Public', 24 * 30),
  ('c followers', 'c', 'items', 'c1', 'FollowersOnly', 7), ('c onlyme', 'c', 'items', 'c1', 'OnlyMe', 7.1),
  ('c paused', 'c', 'items', 'c1', 'Public', 7.2), ('d public', 'd', 'items', 'c1', 'Public', 7.5),
  ('e public', 'e', 'items', 'c1', 'Public', 8), ('c hidden', 'c', 'items', 'c1', 'Public', 9),
  ('c knowledge', 'c', 'knowledge', 'c1', 'Public', 11);
insert into fixture (title, owner, world, city, visibility, hours, direction, urgency) values
  ('c request sofa', 'c', 'items', 'c3', 'Public', 6, 'request', 3);
insert into fixture (title, owner, world, city, visibility, hours, id)
select 'tie ' || n, 'c', 'items', 'c2', 'Public', 10, ('40000000-0000-4000-8000-00000000000' || n)::uuid
  from generate_series(1, 5) n;
insert into fixture (title, owner, world, city, visibility, hours)
select 'bulk ' || n, 'c', 'knowledge', 'c1', 'Public', 12 from generate_series(1, 60) n;
do $$ begin perform set_config('kc.fsm_role', 'system', true); end $$;
insert into public.posts (id, owner_id, world_slug, kind_id, direction, status, visibility, title, description,
                          city_id, urgency_level, item_subcategory_id, published_at)
select f.id, ('00000000-0000-4000-8000-00000000000' || f.owner)::uuid, f.world, k.id, f.direction, 'open',
       f.visibility, f.title, case when f.title like '%sofa' then 'an old Couch_100%' end, f.city, f.urgency,
       case f.title when 'c public' then '30000000-0000-4000-8000-000000000001'::uuid end,
       to_timestamp(floor(extract(epoch from now()) / 86400) * 86400) - make_interval(secs => f.hours * 3600)
  from fixture f join public.post_kinds k on k.world_slug = f.world;
do $$ begin perform set_config('kc.fsm_role', 'owner', true); end $$;
update public.posts set status = 'closed_delivered' where title = 'c closed';
update public.posts set status = 'paused' where title = 'c paused';
do $$ begin perform set_config('kc.fsm_role', '', true); end $$;
insert into public.feed_hides (user_id, post_id)
select '00000000-0000-4000-8000-00000000000a', id from public.posts where title = 'c hidden';
insert into public.feed_mute_filters (user_id, filter_kind, muted_user_id) values
  ('00000000-0000-4000-8000-00000000000a', 'user', '00000000-0000-4000-8000-00000000000e');

-- ── Content and sorts ───────────────────────────────────────────────────────
select is(pg_temp.feed_as('a', '{"sort":"newest"}'),
  'b public,b followers,c public,a own,c request sofa,tie 5,tie 4,tie 3,tie 2,tie 1,c old',
  'the feed holds open posts of main-feed worlds the viewer may read: no hidden, muted, blocked, paused, only-me or strangers'' followers-only posts');
select is(pg_temp.feed_as('a', '{"sort":"oldest"}'),
  'c old,tie 5,tie 4,tie 3,tie 2,tie 1,c request sofa,a own,c public,b followers,b public', 'oldest first');
select is(pg_temp.feed_as('a', '{"sort":"nearest"}'),
  'b public,a own,c old,b followers,c public,tie 5,tie 4,tie 3,tie 2,tie 1,c request sofa',
  'nearest first by the distance of the post''s city, newest first inside a city');
select is(pg_temp.feed_as('a'),
  'b public,b followers,a own,c request sofa,tie 5,tie 4,tie 3,tie 2,tie 1,c public,c old',
  'recommended is the default: newer windows first, and inside a window follow, active world, distance, urgency');
select is(pg_temp.run('a', $$select min(distance_m) || '/' || (max(distance_m) > 250000)
    from public.feed_page(null, 50, '{"sort":"nearest"}')$$), '0/true', 'the nearest sort returns the distance');
select is(pg_temp.feed_as('a', '{"sort":"newest"}', 2), pg_temp.feed_as('a', '{"sort":"newest"}'),
  'newest: pages of two return every post once, in order, across five posts sharing a timestamp');
select is(pg_temp.feed_as('a', '{"sort":"oldest"}', 3), pg_temp.feed_as('a', '{"sort":"oldest"}'), 'oldest pages the same way');
select is(pg_temp.feed_as('a', '{"sort":"nearest"}', 2), pg_temp.feed_as('a', '{"sort":"nearest"}'), 'nearest pages the same way');
select is(pg_temp.feed_as('a', '{}', 2), pg_temp.feed_as('a'), 'recommended pages the same way, across ranking windows');
insert into public.feed_ranking_config (config_key, value) values ('follow_affinity', 0), ('urgency', 5);
select is(split_part(pg_temp.feed_as('a'), ',', 1), 'c request sofa', 'the weights in feed_ranking_config steer the recommended sort');
delete from public.feed_ranking_config;

-- ── Filters ─────────────────────────────────────────────────────────────────
select is(pg_temp.feed_as('a', '{"world":"food"}'), 'c public', 'a world filter gives that world''s feed');
select is(pg_temp.run('a', $$select count(*) || '/' || max((card).title)
    from public.feed_page(null, 1000, '{"world":"knowledge","sort":"newest"}')$$), '50/c knowledge',
  'a world outside the main feed has its own feed, and a page never exceeds 50 posts');
select is(pg_temp.run('a', $$select count(*) from public.feed_page(null, 0)$$)
    || pg_temp.run('a', $$select count(*) from public.feed_page(null, -3)$$), '11', 'a page holds at least one post');
select is(pg_temp.feed_as('a', '{"direction":"request"}'), 'c request sofa', 'direction filter');
select is(pg_temp.feed_as('a', '{"status":"closed"}'), 'c closed', 'status filter: delivered posts');
select is(pg_temp.feed_as('a', '{"status":"all","sort":"newest","world":"food"}'), 'c public,c closed', 'status filter: all');
select is(pg_temp.feed_as('a', '{"audience":"following","sort":"newest"}'), 'b public,b followers', 'following-only audience (D34)');
select is(pg_temp.feed_as('a', '{"city_id":"c3","sort":"newest"}'), 'c request sofa', 'city filter');
select is(pg_temp.feed_as('a', '{"city_id":"c1","radius_km":100,"sort":"oldest"}'),
  'c old,tie 5,tie 4,tie 3,tie 2,tie 1,a own,c public,b followers,b public', 'radius filter: cities within the radius of the centre');
select is(pg_temp.feed_as('a', '{"item_subcategory_ids":["30000000-0000-4000-8000-000000000001"]}'), 'c public',
  'item subcategory filter');
select is(pg_temp.feed_as('a', '{"q":"SOFA"}') || '/' || pg_temp.feed_as('a', '{"q":"couch_100%"}')
    || '/' || pg_temp.feed_as('a', '{"q":"c_uch"}'), 'c request sofa/c request sofa/',
  'text filter: case-insensitive, over title and description, with wildcards taken literally');
select throws_ok($$select pg_temp.feed_as('a', '{"sort":"random"}')$$, 'P0001', 'invalid_input', 'an unknown sort is refused');
select throws_ok($$select pg_temp.run('anon', 'select count(*) from public.feed_page()')$$, '42501', null,
  'a signed-out caller has no feed');

-- ── Hides, mutes, other viewers ─────────────────────────────────────────────
select is(pg_temp.run('a', $$insert into public.feed_mute_filters (user_id, filter_kind, keyword) values (#a, 'keyword', 'couch')$$)
    || pg_temp.run('a', $$insert into public.feed_mute_filters (user_id, filter_kind, world_slug) values (#a, 'world', 'food')$$)
    || '/' || pg_temp.feed_as('a', '{"sort":"newest"}'), '11/b public,b followers,a own,tie 5,tie 4,tie 3,tie 2,tie 1,c old',
  'a muted keyword and a muted world leave the main feed');
select is(pg_temp.feed_as('a', '{"world":"food"}'), 'c public', 'a muted world is still shown on its own screen');
select is(pg_temp.run('a', $$delete from public.feed_mute_filters where filter_kind <> 'user'$$), '2', 'a member removes their mute filters');
select is(pg_temp.feed_as('c', '{"sort":"newest","world":"items"}'),
  'b public,a own,c request sofa,c followers,d public,e public,c hidden,tie 5,tie 4,tie 3,tie 2,tie 1,c old',
  'another viewer: their own followers-only post, no only-me post, nobody else''s hides or mutes');
select is(pg_temp.feed_as('d', '{"sort":"newest","world":"items"}') ~ 'a own', false,
  'a member in a blocked pair never gets the other side''s posts');
select throws_ok($$select pg_temp.run('a', 'insert into public.feed_hides (user_id, post_id) select #b, id from public.posts limit 1')$$,
  '42501', null, 'a member cannot hide posts for another member');
select is(pg_temp.run('b', 'select (select count(*) from public.feed_hides) + (select count(*) from public.feed_mute_filters)'),
  '0', 'hides and mute filters are private');
select throws_ok($$insert into public.feed_mute_filters (user_id, filter_kind, keyword)
    values ('00000000-0000-4000-8000-00000000000a', 'user', 'sofa')$$, '23514', null, 'a mute filter sets the column of its kind');
select throws_ok($$select pg_temp.run('a', 'insert into public.feed_ranking_config values (''distance'', 9)')$$, '42501', null,
  'ranking weights are not writable by a member');

-- ── Profile tabs ────────────────────────────────────────────────────────────
select is(pg_temp.run('a', $$with p1 as (select * from public.profile_posts_page(#c, null, 50)),
         p2 as (select p.* from (select next_cursor from p1 order by next_cursor ->> 'id' limit 1) last,
                                public.profile_posts_page(#c, last.next_cursor, 50) p)
    select (select count(*) from p1) || '/' || (select count(*) from p2) || '/'
           || (select count(distinct (card).id) from (select card from p1 union all select card from p2) x)$$), '50/20/70',
  'the open tab pages through every visible open post once, although all share a creation time');
select is(pg_temp.run('a', $$select string_agg((card).title, ',') from public.profile_posts_page(#c, null, 20, 'closed')$$),
  'c closed', 'the closed tab lists delivered posts');
select is(pg_temp.run('c', $$select string_agg((card).title, ',') from public.profile_posts_page(#c, null, 20, 'hidden')$$)
    || '/' || pg_temp.run('a', $$select count(*) from public.profile_posts_page(#c, null, 20, 'hidden')$$), 'c onlyme/0',
  'the hidden tab shows only-me posts to their owner alone');
select is(pg_temp.run('d', $$select count(*) from public.profile_posts_page(#a)$$), '0',
  'a member in a blocked pair sees nothing on the other side''s profile');
select throws_ok($$select pg_temp.run('a', 'select count(*) from public.profile_posts_page(#c, null, 20, ''drafts'')')$$,
  'P0001', 'invalid_input', 'an unknown tab is refused');

-- ── Search ──────────────────────────────────────────────────────────────────
select is(pg_temp.run('a', $$select string_agg((card).title, ',') from public.search_posts_page(' PUBLIC ')$$),
  'b public,c public,e public', 'post search: every world, newest first, ignoring the viewer''s mutes, never a blocked owner');
select is(pg_temp.run('a', $$select string_agg((card).title, ',') from public.search_posts_page('hidden')$$)
    || '/' || pg_temp.run('a', $$select string_agg((card).title, ',') from public.search_posts_page('knowledge')$$),
  'c hidden/c knowledge', 'post search finds a post hidden from the feed and a post outside the main feed');
select is(pg_temp.run('a', $$select count(*) from public.search_posts_page('followers')$$)
    || pg_temp.run('a', $$select count(*) from public.search_posts_page('paused')$$)
    || pg_temp.run('a', $$select count(*) from public.search_posts_page('b')$$), '100',
  'post search follows visibility, and a text under two characters finds nothing');
select is(pg_temp.run('a', $$select string_agg((s2.card).title, ',') from public.search_posts_page('tie', null, 3) s1,
      public.search_posts_page('tie', s1.next_cursor, 3) s2 where (s1.card).title = 'tie 3'$$), 'tie 2,tie 1',
  'post search pages by cursor');
select is(pg_temp.run('a', $$select string_agg(display_name || ':' || followers_count || ':' || viewer_follows, ',')
    from public.search_users_page('er')$$), 'bob Builder:1:true,carol Baker:0:false,alice Viewer:0:false',
  'member search: name contains the text, most followed first, with the viewer''s follow state');
select is(pg_temp.run('a', $$select count(*) from public.search_users_page('blocked')$$)
    || pg_temp.run('a', $$select count(*) from public.search_users_page('e')$$)
    || pg_temp.run('a', $$select count(*) from public.search_users_page('er', null, 20, '{"min_followers":1}')$$)
    || pg_temp.run('a', $$select count(*) from public.search_users_page('alice', null, 20, '{"city_id":"c1"}')$$), '0011',
  'member search hides blocked members, needs two characters, and filters by followers and city');
select is(pg_temp.run('a', $$select string_agg(s2.display_name, ',') from public.search_users_page('er', null, 1) s1,
      public.search_users_page('er', s1.next_cursor, 1) s2$$), 'carol Baker', 'member search pages by cursor');
select is(pg_temp.run('a', $$select jsonb_array_length(r -> 'posts') || '/' || jsonb_array_length(r -> 'users')
    from public.search_all('er') r$$), '1/3', 'search_all returns both sections in one call');
select throws_ok($$select pg_temp.run('anon', 'select public.search_all(''er'')')$$, '42501', null,
  'a signed-out caller cannot search');

-- ── Impressions ─────────────────────────────────────────────────────────────
select is(pg_temp.run('a', 'insert into public.feed_impressions (post_id) select id from public.posts limit 3'), '3',
  'a member logs impressions with post ids only');
select is((select count(*) from public.feed_impressions where user_id = '00000000-0000-4000-8000-00000000000a'), 3::bigint,
  'the rows are stamped with the member');
select throws_ok($$select pg_temp.run('a', 'insert into public.feed_impressions (user_id, post_id) select #b, id from public.posts limit 1')$$,
  '42501', null, 'a member cannot log impressions for another member');
select throws_ok($$select pg_temp.run('a', 'select 1 from public.feed_impressions')$$, '42501', null,
  'impressions are not readable by members');
do $$ begin perform kc_private.feed_impressions_ensure_partition('2031-05-17'); end $$;
insert into public.feed_impressions (user_id, post_id, seen_at)
values ('00000000-0000-4000-8000-00000000000a', gen_random_uuid(), '2031-05-31 23:59:59+00');
select is((select count(*) || '/' || bool_and(c.relrowsecurity and c.relforcerowsecurity)
             from public.feed_impressions_2031_05, pg_class c where c.oid = 'public.feed_impressions_2031_05'::regclass
            group by c.oid), '1/true', 'a monthly partition is created on demand, takes its month''s rows and forces row security');

-- ── Cascades ────────────────────────────────────────────────────────────────
delete from auth.users where id in ('00000000-0000-4000-8000-00000000000c', '00000000-0000-4000-8000-00000000000e');
select is((select count(*) from public.feed_hides) + (select count(*) from public.feed_mute_filters), 0::bigint,
  'a hide goes with its post and a mute filter with the muted member');
delete from auth.users where id = '00000000-0000-4000-8000-00000000000a';
select is((select count(*) from public.feed_impressions), 0::bigint, 'impressions go with the member');

select * from finish();
rollback;
