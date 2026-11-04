-- supabase/tests/0522_feed_mirror_every_world.sql | 0522 (FR-FEED-020 AC1, D-206): a
-- published open listing of rides, housing or time reaches the main feed as a mirror post
-- like items and food do, and every mirror records its giving world for the feed card;
-- the signed-in feed view returns every posts column; launch flags never gate the feed.

begin;

create temp table personas as
select kc_test.create_user('every_world_giver')  as giver,
       kc_test.create_user('every_world_viewer') as viewer;

-- Housing publishes only for a verified identity (worlds.requires_verification) who accepted
-- the housing code of conduct (0600).
update public.users set verified_at = now() where user_id = (select giver from personas);
insert into public.housing_conduct_acceptances (user_id, version)
select giver, public.housing_conduct_version() from personas;

/** The mirror post of a listing, or null. */
create function pg_temp.mirror_of(p_listing uuid)
returns public.posts
language sql
as $$ select p from public.posts p where p.listing_id = p_listing $$;

/** Whether the ranked main feed, as seen by p_viewer, lists p_post (MV refreshed first). */
create function pg_temp.in_feed(p_viewer uuid, p_post uuid)
returns boolean
language plpgsql
as $$
begin
  perform public.refresh_feed_open_posts_mv(false);
  return exists (
    select 1 from public.feed_ranked_ids(p_viewer, p_page_limit => 100) f where f.post_id = p_post
  );
end $$;

/** The signed-in "newest" feed source row of p_post as p_viewer sees it (0417 view), or null. */
create function pg_temp.visible_row(p_viewer uuid, p_post uuid)
returns jsonb
language plpgsql
as $$
declare
  v_row jsonb;
begin
  perform kc_test.act_as(p_viewer);
  select to_jsonb(v) into v_row from public.feed_visible_posts v where v.post_id = p_post;
  return v_row;
end $$;

-- 1) Every create category mirrors into the feed (animals since 0612, knowledge since 0613); the other worlds do not (yet).
do $$
begin
  perform kc_test.assert_eq(
    (select array_agg(slug order by slug) from public.worlds where feed_mirror),
    array['animals', 'food', 'housing', 'items', 'knowledge', 'rides', 'time']::text[],
    'exactly the seven mirrored worlds reach the main feed');
end $$;

-- 2) A ride offer and a ride request reach the main feed with their world, direction and
--    title; opening the card resolves to the listing (posts.listing_id).
do $$
declare
  p personas;
  v_offer uuid;
  v_request uuid;
  v_mirror public.posts;
begin
  select * into p from personas;
  v_offer := kc_test.create_ride_offer(p.giver, p_seats => 2, p_departs_in => interval '3 hours');
  v_mirror := pg_temp.mirror_of(v_offer);

  perform kc_test.assert_true(v_mirror.post_id is not null, 'a published ride offer gets a mirror post');
  perform kc_test.assert_eq(v_mirror.listing_world_slug, 'rides', 'the mirror records the rides world');
  perform kc_test.assert_eq(v_mirror.type, 'Give', 'a ride offer is a Give post');
  perform kc_test.assert_eq(v_mirror.status, 'open', 'an open ride is an open post');
  perform kc_test.assert_eq(v_mirror.title, 'Tel Aviv to Jerusalem', 'the mirror carries the ride title');
  perform kc_test.assert_eq(v_mirror.category, 'Other', 'rides have no legacy post category');
  perform kc_test.assert_true(pg_temp.in_feed(p.viewer, v_mirror.post_id), 'another member sees the ride in the main feed');

  v_request := kc_test.create_listing(
    p.giver, 'rides', 'ride_request', 'request', 'Need a ride to Jerusalem',
    kc_test.ride_route_tlv_jlm() || jsonb_build_object('departs_at', kc_test.iso_in(interval '5 hours'), 'passengers', 1));
  v_mirror := pg_temp.mirror_of(v_request);
  perform kc_test.assert_eq(v_mirror.type, 'Request', 'a ride request is a Request post');
  perform kc_test.assert_eq(v_mirror.listing_world_slug, 'rides', 'a ride request mirror records the rides world');
  perform kc_test.assert_true(pg_temp.in_feed(p.viewer, v_mirror.post_id), 'the ride request is in the main feed');
end $$;

-- 3) Housing and time listings, both directions, reach the feed with their world, even
--    with their launch flags off (flags pick active vs portal, D60; they never hide
--    listings from the main feed). Published publicly, every member sees them.
do $$
declare
  p personas;
  r record;
  v_listing uuid;
  v_mirror public.posts;
begin
  select * into p from personas;
  -- Both worlds as portals inside this rolled-back block, whatever the current configuration.
  update public.app_flags set enabled = false where key in ('world_housing_enabled', 'world_time_enabled');

  for r in
    select * from (values
      -- Housing stay kinds carry binding schemas since 0600.
      ('housing', 'host_offer',      'give',    'Guest room for a night', 'Give', kc_test.housing_offer_details()),
      ('housing', 'stay_request',    'request', 'Bed for two hikers',     'Request', jsonb_build_object(
        'stay_purpose', 'trail_walk', 'adults', 2, 'minors', 0,
        'check_in_date', (public.housing_today() + 3)::text, 'check_out_date', (public.housing_today() + 4)::text)),
      ('time',    'volunteer_shift', 'give',    'Two hours of tutoring',  'Give', '{}'::jsonb),
      ('time',    'support_request', 'request', 'Company for a walk',     'Request', '{}'::jsonb)
    ) as t(world, kind, direction, title, post_type, details)
  loop
    v_listing := kc_test.create_listing(p.giver, r.world, r.kind, r.direction, r.title, r.details);
    update public.listings set anonymity_level = 3 where listing_id = v_listing;
    v_mirror := pg_temp.mirror_of(v_listing);
    perform kc_test.assert_true(v_mirror.post_id is not null, format('a %s %s listing gets a mirror', r.world, r.kind));
    perform kc_test.assert_eq(v_mirror.listing_world_slug, r.world, format('the %s mirror records its world', r.kind));
    perform kc_test.assert_eq(v_mirror.type, r.post_type, format('the %s mirror has the listing direction', r.kind));
    perform kc_test.assert_eq(v_mirror.visibility, 'Public', format('a public %s listing has a public mirror', r.kind));
    perform kc_test.assert_true(pg_temp.in_feed(p.viewer, v_mirror.post_id), format('the %s listing is in the main feed', r.kind));
  end loop;
end $$;

-- 3b) Time defaults to followers-only (worlds.default_anonymity_level = 2): the mirror keeps
--     that privacy, so a follower sees it in the feed and a stranger does not. Housing is
--     public by default since 0600 (FR-HOUSING-004 AC4).
do $$
declare
  p personas;
  v_follower uuid := kc_test.create_user('every_world_follower');
  v_listing uuid;
  v_mirror public.posts;
begin
  select * into p from personas;
  insert into public.follow_edges (follower_id, followed_id) values (v_follower, p.giver);

  v_listing := kc_test.create_listing(p.giver, 'housing', 'host_offer', 'give', 'Sofa for a night',
                                      kc_test.housing_offer_details());
  perform kc_test.assert_eq((pg_temp.mirror_of(v_listing)).visibility, 'Public',
                            'a default housing listing mirrors as public (FR-HOUSING-004 AC4)');

  v_listing := kc_test.create_listing(p.giver, 'time', 'volunteer_shift', 'give', 'An hour of company', '{}'::jsonb);
  v_mirror := pg_temp.mirror_of(v_listing);
  perform kc_test.assert_eq(v_mirror.visibility, 'FollowersOnly', 'a default time listing mirrors as followers-only');
  perform kc_test.assert_true(pg_temp.in_feed(v_follower, v_mirror.post_id), 'a follower sees the followers-only listing');
  perform kc_test.assert_true(not pg_temp.in_feed(p.viewer, v_mirror.post_id), 'a stranger does not see it');
end $$;

-- 4) A ride that ends leaves the feed: the expiry sweep (0514) expires the listing and the
--    mirror follows it out of the feed.
do $$
declare
  p personas;
  v_offer uuid;
  v_mirror public.posts;
begin
  select * into p from personas;
  v_offer := kc_test.create_ride_offer(p.giver, p_departs_in => interval '2 hours');
  v_mirror := pg_temp.mirror_of(v_offer);
  perform kc_test.assert_true(pg_temp.in_feed(p.viewer, v_mirror.post_id), 'precondition: the ride is in the feed');

  update public.listings set expires_at = now() - interval '1 minute' where listing_id = v_offer;
  perform public.rides_expired_listings_sweep();

  v_mirror := pg_temp.mirror_of(v_offer);
  perform kc_test.assert_eq(v_mirror.status, 'expired', 'an expired ride expires its mirror');
  perform kc_test.assert_true(not pg_temp.in_feed(p.viewer, v_mirror.post_id), 'an expired ride is not in the feed');
end $$;

-- 5) Items and food mirrors record their world too; a listing of a world without
--    feed_mirror (time is switched off inside this rolled-back block) is still shareable by
--    hand, and the share records its world.
do $$
declare
  p personas;
  v_food uuid;
  v_shift uuid;
begin
  select * into p from personas;
  v_food := kc_test.create_listing(
    p.giver, 'food', 'give_food', 'give', 'Fresh challah',
    jsonb_build_object('food_type', 'fresh', 'expires_at', kc_test.iso_in(interval '1 day')));
  perform kc_test.assert_eq((pg_temp.mirror_of(v_food)).listing_world_slug, 'food', 'a food mirror records the food world');

  update public.worlds set feed_mirror = false where slug = 'time';
  v_shift := kc_test.create_listing(p.giver, 'time', 'volunteer_shift', 'give', 'Kitchen shift', '{}'::jsonb);
  -- Since 0557 the listing has its post at once, kept out of the main feed until shared.
  perform kc_test.assert_true((pg_temp.mirror_of(v_shift)).feed_hidden, 'a world without feed_mirror gets a post hidden from the feed');

  perform kc_test.act_as(p.giver);
  perform public.share_listing_to_feed(v_shift);
  perform kc_test.assert_eq(
    (pg_temp.mirror_of(v_shift)).listing_world_slug, 'time', 'a manual share records the listing world');
  perform kc_test.assert_true(not (pg_temp.mirror_of(v_shift)).feed_hidden, 'and exposes the post in the feed');
  update public.worlds set feed_mirror = true where slug = 'time';
end $$;

-- 6) An ordinary post has no world, and only a mirror may carry one.
do $$
declare
  p personas;
  v_post uuid;
begin
  select * into p from personas;
  insert into public.posts (owner_id, type, title, category, city, street, street_number)
  values (p.giver, 'Give', 'Plain feed post', 'Books', 'tel-aviv', 'Herzl', '1')
  returning post_id into v_post;
  perform kc_test.assert_true(
    (select listing_world_slug from public.posts where post_id = v_post) is null, 'an ordinary post has no listing world');

  perform kc_test.assert_raises(
    format('update public.posts set listing_world_slug = %L where post_id = %L', 'rides', v_post),
    'new row for relation "posts" violates check constraint "posts_listing_world_slug_chk"',
    'a world on a post without a listing is rejected');
end $$;

-- 7) The signed-in feed source (feed_visible_posts) returns every posts column, including
--    the mirror link and world the card needs.
do $$
declare
  p personas;
  v_offer uuid;
  v_row jsonb;
begin
  select * into p from personas;
  perform kc_test.assert_row_count(
    $q$ select column_name from information_schema.columns
         where table_schema = 'public' and table_name = 'posts'
        except
        select column_name from information_schema.columns
         where table_schema = 'public' and table_name = 'feed_visible_posts' $q$,
    0, 'feed_visible_posts exposes every posts column');

  v_offer := kc_test.create_ride_offer(p.giver);
  v_row := pg_temp.visible_row(p.viewer, (pg_temp.mirror_of(v_offer)).post_id);
  perform kc_test.assert_eq((v_row ->> 'listing_id')::uuid, v_offer, 'the signed-in feed row links to its listing');
  perform kc_test.assert_eq(v_row ->> 'listing_world_slug', 'rides', 'the signed-in feed row names its world');
end $$;

rollback;

\echo '✓ supabase/tests/0522_feed_mirror_every_world.sql passed'
