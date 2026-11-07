-- supabase/tests/0666_g1_drop_sync_triggers.sql | G1 step 6c (ADR-006, D-214, issue #1671):
-- drops the 7 sync triggers between posts and listings, and between post_handoffs and giving_handoffs.
-- posts and post_handoffs are the single records of truth.

begin;

create temp table personas as
select kc_test.create_user('st_driver') as driver,
       kc_test.create_user('st_rider') as rider,
       kc_test.create_user('st_giver') as giver,
       kc_test.create_user('st_taker') as taker,
       kc_test.create_user('st_host') as host,
       kc_test.create_user('st_guest') as guest;

-- ── T1 Assert that the 7 sync triggers are dropped ─────────────────────────────────────────────
do $$
declare
  v_count int;
begin
  select count(*) into v_count
    from pg_trigger
   where tgname in (
     'posts_sync_listing',
     'listings_feed_mirror_sync',
     'listing_media_feed_mirror_sync',
     'post_handoffs_giving_sync',
     'giving_handoffs_post_handoffs_sync',
     'ride_listings_sync_listing',
     'listings_sync_event_post_details'
   );
  perform kc_test.assert_eq(v_count, 0, 'all 7 sync triggers are dropped');
end $$;

-- ── T2 create_marketplace_listing writes directly to public.posts with no mirror listing ───────
do $$
declare
  p personas;
  v_post_id uuid;
  v_post public.posts;
  v_ride public.ride_post_details;
begin
  select * into p from personas;
  perform kc_test.act_as(p.driver);

  v_post_id := public.create_marketplace_listing(
    p_kind_id => kc_test.listing_kind_id('rides', 'ride_offer'),
    p_title   => 'Haifa to TLV direct',
    p_summary => 'fast highway ride',
    p_details => kc_test.ride_route_tlv_jlm()
                 || jsonb_build_object('departs_at', kc_test.iso_in(interval '2 hours'), 'seats_available', 2),
    p_city_id => 'tel-aviv'
  );

  select * into v_post from public.posts where post_id = v_post_id;
  perform kc_test.assert_eq(v_post.title, 'Haifa to TLV direct', 'post title is saved');
  perform kc_test.assert_eq(v_post.world_slug, 'rides', 'post is in rides world');
  perform kc_test.assert_eq(v_post.direction, 'offer', 'post direction is offer');
  perform kc_test.assert_eq(v_post.status, 'open', 'post is open');

  -- No row in public.listings
  perform kc_test.assert_row_count(
    format('select 1 from public.listings where legacy_post_id = %L or listing_id = %L', v_post_id, v_post_id),
    0, 'no mirror listing was created in public.listings');

  -- 1:1 ride_post_details extension was populated by posts_sync_post_details trigger
  select * into v_ride from public.ride_post_details where post_id = v_post_id;
  perform kc_test.assert_eq(v_ride.seats_available, 2, 'ride_post_details populated directly from post');
end $$;

-- ── T3 reserve_item_giving creates post_handoffs with no giving_handoffs row ───────────────────
do $$
declare
  p personas;
  v_item_id uuid;
  h public.giving_handoffs;
  r public.post_handoffs;
begin
  select * into p from personas;
  perform kc_test.act_as(p.giver);

  v_item_id := public.create_marketplace_listing(
    p_kind_id => kc_test.listing_kind_id('items', 'give_item'),
    p_title   => 'Desk lamp',
    p_details => '{"item_condition":"Good","fulfillment_mode":"owner_approval"}'::jsonb,
    p_city_id => 'tel-aviv'
  );

  perform kc_test.act_as(p.taker);
  h := public.reserve_item_giving(v_item_id, 'pickup', null, null);
  perform kc_test.assert_true(h.handoff_id is not null, 'reserve returns handoff');
  perform kc_test.assert_eq(h.status, 'reserved', 'status is reserved');
  perform kc_test.assert_eq(h.listing_id, v_item_id, 'listing_id resolves to the post');

  select * into r from public.post_handoffs where handoff_id = h.handoff_id;
  perform kc_test.assert_eq(r.post_id, v_item_id, 'post_handoffs points to post');
  perform kc_test.assert_eq(r.recipient_id, p.taker, 'recipient is taker');

  -- No row in giving_handoffs
  perform kc_test.assert_row_count(
    format('select 1 from public.giving_handoffs where handoff_id = %L', h.handoff_id),
    0, 'no legacy giving_handoffs row was created');

  -- Post availability is scheduled
  perform kc_test.assert_eq(
    (select availability_status from public.posts where post_id = v_item_id),
    'scheduled', 'post availability_status became scheduled');

  -- Cancel restores availability
  perform public.cancel_giving_handoff(h.handoff_id);
  perform kc_test.assert_eq(
    (select availability_status from public.posts where post_id = v_item_id),
    'immediate', 'post availability_status restored to immediate after cancel');
end $$;

-- ── T4 book_ride_seat and complete_ride_trip on posts ──────────────────────────────────────────
do $$
declare
  p personas;
  v_ride_id uuid;
  h public.giving_handoffs;
begin
  select * into p from personas;
  perform kc_test.act_as(p.driver);

  v_ride_id := public.create_marketplace_listing(
    p_kind_id => kc_test.listing_kind_id('rides', 'ride_offer'),
    p_title   => 'Jerusalem to Dead Sea',
    p_details => kc_test.ride_route_tlv_jlm()
                 || jsonb_build_object('departs_at', kc_test.iso_in(interval '1 hour'), 'seats_available', 1),
    p_city_id => 'tel-aviv'
  );

  perform kc_test.act_as(p.rider);
  h := public.book_ride_seat(v_ride_id, 1, null);
  perform kc_test.assert_true(h.handoff_id is not null, 'ride seat booked on post');

  perform kc_test.act_as(p.driver);
  perform public.confirm_ride_booking(h.handoff_id);

  -- Complete trip closes the post to closed_delivered
  h := public.complete_ride_trip(h.handoff_id);
  perform kc_test.assert_eq(h.status, 'handed_over', 'ride handoff handed over');
  perform kc_test.assert_eq(
    (select status from public.posts where post_id = v_ride_id),
    'closed_delivered', 'ride post closed to closed_delivered');
end $$;

-- ── T5 owner management RPCs work directly on posts ────────────────────────────────────────────
do $$
declare
  p personas;
  v_post_id uuid;
begin
  select * into p from personas;
  perform kc_test.act_as(p.giver);

  v_post_id := public.create_marketplace_listing(
    p_kind_id => kc_test.listing_kind_id('items', 'give_item'),
    p_title   => 'Wooden chair',
    p_details => '{"item_condition":"Good"}'::jsonb,
    p_city_id => 'tel-aviv'
  );

  perform public.pause_my_listing(v_post_id);
  perform kc_test.assert_eq((select status from public.posts where post_id = v_post_id), 'paused', 'pause sets paused');

  perform public.resume_my_listing(v_post_id);
  perform kc_test.assert_eq((select status from public.posts where post_id = v_post_id), 'open', 'resume sets open');

  perform public.fulfill_my_listing(v_post_id);
  perform kc_test.assert_eq((select status from public.posts where post_id = v_post_id), 'closed_delivered', 'fulfill sets closed_delivered');

  perform public.delete_my_listing(v_post_id);
  perform kc_test.assert_row_count(format('select 1 from public.posts where post_id = %L', v_post_id), 0, 'delete removes post');
end $$;

rollback;
\echo '✓ 0666_g1_drop_sync_triggers.sql passed'
