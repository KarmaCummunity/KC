-- supabase/tests/0631_g1_map_rides_feed_on_posts.sql | 0631 (G1 step 6a-5f, issue #1671): the map
-- pins and the rides feed read the post of a post-owned listing and return exactly what they
-- returned when they read the listing.
--
-- The oracles are the pre-0631 bodies (map_listing_pins 0438, list_rides_feed 0623), copied
-- verbatim as pg_temp functions. Shapes, stages and viewers as in the 0630 test; the RPC's rows
-- equal the oracle's as ordered JSON text.
-- map_listing_clusters (#1911) had no working body, so it is tested on its behaviour: cells,
-- counts, a representative listing of each cell, the world filter, and a blocked member.
-- Runs in a rolled-back transaction.

begin;

create temp table personas as
select kc_test.create_user('bm_owner')    as owner,
       kc_test.create_user('bm_viewer')   as viewer,
       kc_test.create_user('bm_follower') as follower,
       kc_test.create_user('bm_blocked')  as blocked,
       kc_test.create_user('bm_mentor')   as mentor;

insert into public.blocks (blocker_id, blocked_id) select owner, blocked from personas;
select kc_test.act_as((select follower from personas));
insert into public.follow_edges (follower_id, followed_id) select follower, owner from personas;
-- Knowledge publishes only for a verified identity (worlds.requires_verification).
update public.users set verified_at = now() where user_id = (select mentor from personas);

/** A map position. */
create function pg_temp.point(p_lat double precision, p_lng double precision)
returns extensions.geography
language sql
immutable
as $$ select extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography $$;
grant execute on function pg_temp.point(double precision, double precision) to public;

/** The listings of every shape, by name. */
create temp table shapes (name text primary key, listing_id uuid);
grant all on shapes to public;

-- ── Fixture: one listing of every shape ─────────────────────────────────────────────────────
do $$
declare
  p personas;
  v uuid;
begin
  select * into p from personas;
  perform kc_test.act_as(p.owner);
  -- Post-owned (0554): a ride offer and an urgent food request with a position, from the create RPC.
  insert into shapes values ('owned_ride', public.create_marketplace_listing(
    p_kind_id => kc_test.listing_kind_id('rides', 'ride_offer'), p_title => 'Tel Aviv to Jerusalem',
    p_summary => 'from the central station',
    p_details => kc_test.ride_route_tlv_jlm()
                 || jsonb_build_object('departs_at', kc_test.iso_in(interval '3 hours'), 'seats_available', 3),
    p_city_id => 'tel-aviv', p_availability_status => 'scheduled'));
  insert into shapes values ('owned_food', public.create_marketplace_listing(
    p_kind_id => kc_test.listing_kind_id('food', 'request_food'), p_title => 'soup for two',
    p_urgency_level => 3::smallint, p_lat => 32.08, p_lng => 34.78));

  -- Listing-sourced with a mirror post: a ride whose title its post cannot carry whole.
  v := kc_test.create_listing(p.owner, 'rides', 'ride_offer', 'give', 'a very long ride title ' || repeat('x', 80),
    kc_test.ride_route_tlv_jlm() || jsonb_build_object('departs_at', kc_test.iso_in(interval '5 hours'), 'seats_available', 2));
  update public.listings set geo = pg_temp.point(32.79, 34.99) where listing_id = v;
  insert into shapes values ('mirror_ride', v);

  -- Post-owned by the 0554 backfill: the mirror post kept its cut title and its owner's city (the
  -- listing has none); legacy_post_id alone was set on the listing, which fires no sync.
  v := kc_test.create_listing(p.owner, 'time', 'support_request', 'request', 'help moving ' || repeat('y', 90),
    '{}'::jsonb);
  update public.listings set geo = pg_temp.point(32.07, 34.79) where listing_id = v;
  update public.listings set legacy_post_id = public.post_id_of_listing(v) where listing_id = v;
  insert into shapes values ('backfilled', v);

  -- Followers only (anonymity 2), listing-sourced.
  v := kc_test.create_listing(p.owner, 'time', 'support_request', 'request', 'followers only', '{}'::jsonb);
  update public.listings set anonymity_level = 2, geo = pg_temp.point(32.10, 34.80) where listing_id = v;
  insert into shapes values ('followers_only', v);

  -- Items: a post (its listing keeps origin 'post') and a directly inserted listing.
  perform kc_test.act_as(p.owner);
  insert into public.posts (owner_id, type, title, description, category, city, street, street_number, item_condition)
  values (p.owner, 'Give', 'a bookshelf', 'solid oak', 'Furniture', 'tel-aviv', 'Herzl', '1', 'Good')
  returning post_id into v;
  insert into shapes select 'items_post', listing_id from public.listings where legacy_post_id = v;
  insert into shapes values ('items_direct', kc_test.create_listing(p.owner, 'items', 'give_item', 'give', 'a lamp',
    '{"item_condition":"Good","image_url":"https://example.test/i.jpg"}'::jsonb, now() + interval '30 days'));

  -- Knowledge awaiting moderation: no post yet.
  insert into shapes values ('knowledge', kc_test.create_listing(p.mentor, 'knowledge', 'course', 'give', 'intro to sql',
    jsonb_build_object('topic', 'SQL', 'level', 'beginner', 'modality', 'video', 'slots_available', 2,
      'slot_starts_at', kc_test.iso_in(interval '10 minutes'), 'slot_ends_at', kc_test.iso_in(interval '2 hours'))));

  -- The post-owned ride gets a position on its post; the listing follows (0554).
  update public.posts set geo = pg_temp.point(32.06, 34.77)
   where post_id = public.post_id_of_listing((select listing_id from shapes where name = 'owned_ride'));
  update public.listings set geo = pg_temp.point(32.05, 34.76)
   where listing_id = (select listing_id from shapes where name = 'items_direct');

  -- One transaction ties every now(): give each listing its own creation time so every order is defined.
  update public.listings l set created_at = now() - r.n * interval '1 minute'
    from (select listing_id, row_number() over (order by listing_id) as n from shapes) r
   where l.listing_id = r.listing_id;
end $$;

-- ── Oracles: the pre-0631 bodies ────────────────────────────────────────────────────────────────

create function pg_temp.old_pins(
  p_sw_lat double precision,
  p_sw_lng double precision,
  p_ne_lat double precision,
  p_ne_lng double precision,
  p_world_slug text default null,
  p_limit int default 300
)
returns table (
  listing_id uuid,
  world_slug text,
  kind_slug text,
  direction text,
  title text,
  summary text,
  lat double precision,
  lng double precision,
  origin_lat double precision,
  origin_lng double precision,
  dest_lat double precision,
  dest_lng double precision,
  origin_label text,
  dest_label text,
  departs_at text,
  seats int
)
language sql
stable
set search_path = public, extensions
as $$
  select
    l.listing_id,
    l.world_slug,
    lk.slug,
    l.direction,
    l.title,
    l.summary,
    round(extensions.st_y(l.geo::geometry)::numeric, 3)::double precision,
    round(extensions.st_x(l.geo::geometry)::numeric, 3)::double precision,
    case when l.world_slug = 'rides' and l.details ? 'origin_lat'
      then round((l.details->>'origin_lat')::numeric, 3)::double precision end,
    case when l.world_slug = 'rides' and l.details ? 'origin_lng'
      then round((l.details->>'origin_lng')::numeric, 3)::double precision end,
    case when l.world_slug = 'rides' and l.details ? 'dest_lat'
      then round((l.details->>'dest_lat')::numeric, 3)::double precision end,
    case when l.world_slug = 'rides' and l.details ? 'dest_lng'
      then round((l.details->>'dest_lng')::numeric, 3)::double precision end,
    case when l.world_slug = 'rides' then nullif(trim(l.details->>'origin_label'), '') end,
    case when l.world_slug = 'rides' then nullif(trim(l.details->>'dest_label'), '') end,
    case when l.world_slug = 'rides' then l.details->>'departs_at' end,
    case when l.world_slug = 'rides' then
      coalesce(
        case when jsonb_typeof(l.details->'seats_available') = 'number' then (l.details->>'seats_available')::int end,
        case when jsonb_typeof(l.details->'passengers') = 'number' then (l.details->>'passengers')::int end
      ) end
  from public.listings l
  join public.listing_kinds lk on lk.kind_id = l.kind_id
  where l.status = 'open'
    and l.moderation_status = 'published'
    and l.geo is not null
    and l.world_slug <> 'romantic_matchmaking'
    and public.is_listing_visible_to(l, auth.uid())
    and (p_world_slug is null or l.world_slug = p_world_slug)
    and extensions.st_within(
      l.geo::geometry,
      extensions.st_makeenvelope(p_sw_lng, p_sw_lat, p_ne_lng, p_ne_lat, 4326)
    )
  order by l.urgency_level desc, l.listing_id
  limit least(greatest(coalesce(p_limit, 300), 1), 500);
$$;

create function pg_temp.old_rides_feed(p_limit int default 100)
returns table (
  listing_id     uuid,
  direction      text,
  title          text,
  departs_at     timestamptz,
  origin_label   text,
  dest_label     text,
  meeting_points int,
  seats_left     int,
  passengers     int,
  recurrence     jsonb,
  series_more    int
)
language sql
stable
set search_path = public
as $$
  with upcoming as (
    select l.listing_id, l.direction, l.title,       -- 0623: the listing keeps its id, direction and title
           p.post_id,                                -- 0623: the ride's post
           p.details -> 'ride_series' as recurrence, -- 0623: the post's copy of the series marker
           r.origin_label, r.dest_label, r.meeting_points, r.seats_available, r.passengers, -- 0623
           r.departs_at as departs,                  -- 0623: the ride's schedule
           r.series_id::text as series_id            -- 0623: the series of the occurrence
      from public.listings l
      join public.posts p on p.listing_id = l.listing_id        -- 0623
      join public.ride_post_details r on r.post_id = p.post_id  -- 0623
     where l.world_slug = 'rides'
       and p.status = 'open' -- 0623: open and published (listing_feed_mirror_status, 0551)
       and r.departs_at > now() -- 0623: a typed departure
       and public.is_listing_visible_to(l, auth.uid())
  ), horizon as (
    -- Midnight starting the day after tomorrow, Israel time.
    select (((now() at time zone 'Asia/Jerusalem')::date + 2)::timestamp) at time zone 'Asia/Jerusalem' as at
  ), keyed as (
    select u.*,
           case when u.series_id is not null and u.departs >= h.at
                then 'series:' || u.series_id else 'listing:' || u.listing_id::text end as fold_key
      from upcoming u, horizon h
  ), folded as (
    select distinct on (k.fold_key)
           k.*, (count(*) over (partition by k.fold_key) - 1)::int as later_count
      from keyed k
     order by k.fold_key, k.departs, k.listing_id
  )
  select f.listing_id,
         f.direction,
         f.title,
         f.departs,
         f.origin_label,                          -- 0623
         f.dest_label,                            -- 0623
         jsonb_array_length(f.meeting_points),    -- 0623: always an array (ride_post_details check)
         case when f.direction = 'give' then greatest(0,
           coalesce(f.seats_available, 1)         -- 0623
           - coalesce((select sum(h.seats)::int from public.post_handoffs h -- 0623: the record
                        where h.post_id = f.post_id                         -- 0623
                          and h.status in ('reserved', 'confirmed', 'handed_over')), 0))
         end,
         case when f.direction = 'request' then f.passengers end, -- 0623
         f.recurrence,                                            -- 0623
         f.later_count
    from folded f
   order by f.departs, f.listing_id
   limit greatest(1, least(coalesce(p_limit, 100), 200));
$$;

/** Compares two set-returning calls, row for row and byte for byte (as ordered JSON text). */
create function pg_temp.same(p_new text, p_old text, p_what text)
returns void
language plpgsql
as $$
declare
  v_new text;
  v_old text;
begin
  execute format('select coalesce(jsonb_agg(to_jsonb(x) order by x.ordinality), ''[]'')::text from %s with ordinality x', p_new) into v_new;
  execute format('select coalesce(jsonb_agg(to_jsonb(x) order by x.ordinality), ''[]'')::text from %s with ordinality x', p_old) into v_old;
  perform kc_test.assert_eq(v_new, v_old, p_what);
end $$;
grant execute on function pg_temp.same(text, text, text) to public;

/** p_viewer's session: a member, or a guest when null. */
create function pg_temp.session(p_viewer uuid)
returns void
language plpgsql
as $$
begin
  if p_viewer is null then perform kc_test.act_as_anon(); else perform kc_test.act_as(p_viewer); end if;
end $$;
grant execute on function pg_temp.session(uuid) to public;

/** The pins of a few windows and the rides feed agree with their oracles for every viewer. */
create function pg_temp.assert_same(p_stage text)
returns void
language plpgsql
as $$
declare
  p personas;
  v_viewer uuid;
  v_args text;
begin
  select * into p from personas;
  foreach v_viewer in array array[p.owner, p.viewer, p.follower, p.blocked, p.mentor, null] loop
    perform pg_temp.session(v_viewer);
    foreach v_args in array array[
      '29.0, 34.0, 34.0, 36.0',
      '29.0, 34.0, 34.0, 36.0, ''rides''',
      '29.0, 34.0, 34.0, 36.0, null, 2',
      '32.0, 34.7, 32.2, 34.9'
    ] loop
      perform pg_temp.same(format('public.map_listing_pins(%s)', v_args), format('pg_temp.old_pins(%s)', v_args),
        format('%s: pins(%s) for %s', p_stage, v_args, coalesce(v_viewer::text, 'a guest')));
    end loop;
    perform pg_temp.same('public.list_rides_feed(100)', 'pg_temp.old_rides_feed(100)',
      format('%s: rides feed for %s', p_stage, coalesce(v_viewer::text, 'a guest')));
  end loop;
end $$;
grant execute on function pg_temp.assert_same(text) to public;

-- ── #1911 the clusters plan and count what a viewer sees ────────────────────────────────────
-- The pre-0631 body never planned (min(uuid)), so the clusters are tested on their behaviour, in a
-- window far from the fixture: two visible items listings and a paused one in one 0.01° cell, a
-- post-owned food request (positioned on its post) and a listing-sourced items listing in another.
do $$
declare
  p personas;
  v_a uuid;
  v_b uuid;
  v_paused uuid;
  v_owned uuid;
  v_c uuid;
  v_item jsonb := '{"item_condition":"Good","image_url":"https://example.test/i.jpg"}';
  r record;
  v_n int := 0;
begin
  select * into p from personas;
  v_a := kc_test.create_listing(p.owner, 'items', 'give_item', 'give', 'cell one a', v_item);
  v_b := kc_test.create_listing(p.owner, 'items', 'give_item', 'give', 'cell one b', v_item);
  v_paused := kc_test.create_listing(p.owner, 'items', 'give_item', 'give', 'cell one paused', v_item);
  v_c := kc_test.create_listing(p.owner, 'items', 'give_item', 'give', 'cell two direct', v_item);
  update public.listings set geo = pg_temp.point(29.551, 34.951) where listing_id = v_a;
  update public.listings set geo = pg_temp.point(29.552, 34.952) where listing_id = v_b;
  update public.listings set geo = pg_temp.point(29.553, 34.953), status = 'cancelled' where listing_id = v_paused;
  update public.listings set geo = pg_temp.point(29.601, 34.981) where listing_id = v_c;
  perform kc_test.act_as(p.owner);
  v_owned := public.create_marketplace_listing(
    p_kind_id => kc_test.listing_kind_id('food', 'request_food'), p_title => 'cell two owned',
    p_lat => 29.602, p_lng => 34.982);

  perform kc_test.act_as(p.viewer);
  for r in select * from public.map_listing_clusters(29.5, 34.9, 29.7, 35.0, null, p.viewer) loop
    v_n := v_n + 1;
    if r.cluster_key = '29.55,34.95' then
      perform kc_test.assert_eq(r.listing_count, 2, 'the paused listing is not counted in its cell');
      perform kc_test.assert_true(r.sample_listing_id in (v_a, v_b), 'the cell''s representative is one of its listings');
      perform kc_test.assert_true(abs(r.center_lat - 29.5515) < 1e-6, 'the cell is centred on its listings');
    elsif r.cluster_key = '29.60,34.98' then
      perform kc_test.assert_eq(r.listing_count, 2, 'a post-owned and a listing-sourced listing share a cell');
      perform kc_test.assert_true(r.sample_listing_id in (v_owned, v_c), 'the cell''s representative is one of its listings');
    else
      perform kc_test.fail(format('unexpected cell %s', r.cluster_key));
    end if;
  end loop;
  perform kc_test.assert_eq(v_n, 2, 'two cells in the window');

  perform kc_test.assert_row_count(
    'select 1 from public.map_listing_clusters(29.5, 34.9, 29.7, 35.0, ''food'', null)', 1,
    'the world filter keeps one cell; a guest sees it');
  delete from public.blocks where blocker_id = p.owner;
  insert into public.blocks (blocker_id, blocked_id) values (p.owner, p.blocked);
  perform kc_test.assert_row_count(
    format('select 1 from public.map_listing_clusters(29.5, 34.9, 29.7, 35.0, null, %L)', p.blocked), 0,
    'a blocked member sees no cell');
end $$;

-- ── Every stage of the listings' life, compared for every viewer ─────────────────────────────
do $$
declare
  p personas;
begin
  select * into p from personas;
  perform pg_temp.assert_same('created');

  perform kc_test.act_as(p.owner);
  perform public.pause_my_listing((select listing_id from shapes where name = 'owned_ride'));
  perform pg_temp.assert_same('a post-owned ride paused');

  update public.listings set moderation_status = 'pending_review'
   where listing_id = (select listing_id from shapes where name = 'owned_food');
  perform pg_temp.assert_same('a post-owned request held');

  perform kc_test.act_as(p.owner);
  perform public.resume_my_listing((select listing_id from shapes where name = 'owned_ride'));
  update public.listings set moderation_status = 'published'
   where listing_id in (select listing_id from shapes where name in ('owned_food', 'knowledge'));
  perform pg_temp.assert_same('published again, the knowledge listing with its post');

  perform kc_test.act_as(p.owner);
  perform public.update_my_listing((select listing_id from shapes where name = 'owned_ride'),
    p_title => 'Tel Aviv to Jerusalem, edited', p_availability_status => 'immediate', p_urgency_level => 3::smallint);
  perform pg_temp.assert_same('edited');
end $$;

rollback;
\echo '✓ 0631_g1_map_rides_feed_on_posts.sql passed'
