-- supabase/tests/0554_posts_own_listing_worlds.sql | 0554 (G1 step 2, ADR-006): the create,
-- edit and owner RPCs of the listing worlds write the post; the listing is derived from it
-- with every listing-side rule still enforced; what the listing side computes or changes
-- flows back to the post; items and directly inserted listings keep their old paths.

begin;

create temp table personas as
select kc_test.create_user('own_driver')   as driver,
       kc_test.create_user('own_cook')     as cook,
       kc_test.create_user('own_viewer')   as viewer;

/** The post a listing is derived from (fails when the listing has none). */
create function pg_temp.post_of(p_listing uuid)
returns public.posts
language plpgsql
as $$
declare
  v public.posts;
begin
  select p.* into v
    from public.posts p
    join public.listings l on l.legacy_post_id = p.post_id
   where l.listing_id = p_listing;
  if not found then
    perform kc_test.fail('listing is not derived from a post');
  end if;
  return v;
end $$;

create function pg_temp.listing(p_listing uuid)
returns public.listings
language sql
as $$ select l from public.listings l where l.listing_id = p_listing $$;

/** A ride offer published through the create RPC, as the app does. */
create function pg_temp.create_ride(p_owner uuid, p_title text, p_extra jsonb default '{}'::jsonb)
returns uuid
language plpgsql
as $$
begin
  perform kc_test.act_as(p_owner);
  return public.create_marketplace_listing(
    p_kind_id   => kc_test.listing_kind_id('rides', 'ride_offer'),
    p_title     => p_title,
    p_summary   => 'leaving from the central station',
    p_details   => kc_test.ride_route_tlv_jlm()
                   || jsonb_build_object('departs_at', kc_test.iso_in(interval '3 hours'), 'seats_available', 3)
                   || p_extra,
    p_city_id   => 'tel-aviv');
end $$;

-- ── T1 create: the post is the record, the listing is derived and enriched ──────────
do $$
declare
  p personas;
  v_listing uuid;
  l public.listings;
  po public.posts;
  d public.ride_post_details;
  r jsonb;
begin
  select * into p from personas;
  v_listing := pg_temp.create_ride(p.driver, 'Tel Aviv to Jerusalem');
  l := pg_temp.listing(v_listing);
  po := pg_temp.post_of(v_listing);

  perform kc_test.assert_eq(l.origin, 'native', 'the derived listing is a native listing (every rule runs on it)');
  perform kc_test.assert_eq(po.listing_id, v_listing, 'the post points back at its listing');
  perform kc_test.assert_eq(po.world_slug, 'rides', 'the post lives in the rides world');
  perform kc_test.assert_eq(po.direction, 'offer', 'a give kind is an offer');
  perform kc_test.assert_eq(po.post_type, 'ride', 'a rides post carries the ride extension');
  perform kc_test.assert_eq(po.title, 'Tel Aviv to Jerusalem', 'the title is the post''s');
  perform kc_test.assert_eq(l.title, po.title, 'the listing follows the post title');
  perform kc_test.assert_eq(l.summary, po.description, 'the listing summary is the post description');
  perform kc_test.assert_true(l.expires_at is not null, 'the ride schedule rule set the listing expiry');
  perform kc_test.assert_eq(po.expires_at, l.expires_at, 'the computed expiry flows back to the post');
  perform kc_test.assert_eq(po.details, l.details, 'the canonical details flow back to the post');
  perform kc_test.assert_true(l.details -> 'origin_lat' is not null, 'official places were resolved on the way');

  select * into d from public.ride_post_details where post_id = po.post_id;
  perform kc_test.assert_eq(d.seats_available, 3, 'the ride extension is filled');

  r := public.post_unification_report();
  perform kc_test.assert_eq((r ->> 'mirror_field_mismatches')::int, 0, 'post and listing agree');
end $$;

-- ── T2 edit: the owner RPC edits the post; the listing follows ─────────────────────
do $$
declare
  p personas;
  v_listing uuid;
begin
  select * into p from personas;
  v_listing := pg_temp.create_ride(p.driver, 'Haifa to Tel Aviv');
  perform kc_test.act_as(p.driver);
  perform public.update_my_listing(v_listing, p_title => 'Haifa to Tel Aviv, two seats', p_summary => 'one stop');
  perform kc_test.assert_eq((pg_temp.post_of(v_listing)).title, 'Haifa to Tel Aviv, two seats', 'the post title changed');
  perform kc_test.assert_eq((pg_temp.listing(v_listing)).title, 'Haifa to Tel Aviv, two seats', 'the listing title followed');
  perform kc_test.assert_eq((pg_temp.listing(v_listing)).summary, 'one stop', 'the listing summary followed');
  perform kc_test.assert_raises(
    format('select public.update_my_listing(%L, p_title => %L)', v_listing, repeat('x', 81)),
    'title_too_long', 'a post title is at most 80 characters (07 §7.2)');
end $$;

-- ── T3 owner management (D104) on the post: pause, resume, mark delivered, delete ──
do $$
declare
  p personas;
  v_listing uuid;
  v_post uuid;
begin
  select * into p from personas;
  v_listing := pg_temp.create_ride(p.driver, 'Beer Sheva to Eilat');
  v_post := (pg_temp.post_of(v_listing)).post_id;
  perform kc_test.act_as(p.driver);

  perform public.pause_my_listing(v_listing);
  perform kc_test.assert_eq((pg_temp.post_of(v_listing)).status, 'paused', 'pause pauses the post');
  perform kc_test.assert_eq(kc_test.listing_status(v_listing), 'cancelled', 'the listing follows as cancelled');
  perform kc_test.assert_true(not public.is_post_visible_to(pg_temp.post_of(v_listing), p.viewer), 'a paused post is the owner''s alone');

  perform public.resume_my_listing(v_listing);
  perform kc_test.assert_eq((pg_temp.post_of(v_listing)).status, 'open', 'resume reopens the post');
  perform kc_test.assert_eq(kc_test.listing_status(v_listing), 'open', 'the listing follows as open');

  perform public.fulfill_my_listing(v_listing);
  perform kc_test.assert_eq((pg_temp.post_of(v_listing)).status, 'closed_delivered', 'mark delivered closes the post');
  perform kc_test.assert_eq(kc_test.listing_status(v_listing), 'closed', 'the listing follows as closed');

  perform public.delete_my_listing(v_listing);
  perform kc_test.assert_row_count(format('select 1 from public.posts where post_id = %L', v_post), 0, 'delete removes the post');
  perform kc_test.assert_row_count(format('select 1 from public.listings where listing_id = %L', v_listing), 0, 'and its listing with it');
end $$;

-- ── T4 a listing-side status change (a sweep, a handoff, moderation) reaches the post ─
do $$
declare
  p personas;
  v_listing uuid;
begin
  select * into p from personas;
  v_listing := pg_temp.create_ride(p.driver, 'Netanya to Haifa');
  update public.listings set status = 'expired' where listing_id = v_listing;
  perform kc_test.assert_eq((pg_temp.post_of(v_listing)).status, 'expired', 'an expiry set on the listing flows back');
end $$;

-- ── T4b an expiry set on the listing survives an unrelated post edit (0459 regression) ──
-- A ride recomputes its expiry from its schedule on every details write (0514), so the case
-- is a food offer: its expiry follows the details only when that detail changes (0459).
do $$
declare
  p personas;
  v_listing uuid;
  v_expires timestamptz := date_trunc('second', now() + interval '1 hour');
begin
  select * into p from personas;
  perform kc_test.act_as(p.cook);
  v_listing := public.create_marketplace_listing(
    p_kind_id => kc_test.listing_kind_id('food', 'give_food'), p_title => 'rice',
    p_details => jsonb_build_object('food_type', 'cooked', 'expires_at', kc_test.iso_in(interval '6 hours')),
    p_city_id => 'tel-aviv');
  update public.listings set expires_at = v_expires where listing_id = v_listing;
  perform kc_test.assert_eq((pg_temp.post_of(v_listing)).expires_at, v_expires, 'the expiry set on the listing reaches the post');
  perform kc_test.act_as(p.cook);
  perform public.update_my_listing(v_listing, p_title => 'rice, two portions');
  perform kc_test.assert_eq((pg_temp.listing(v_listing)).expires_at, v_expires,
    'an unrelated edit through the post does not recompute the listing expiry');
  perform kc_test.assert_eq((pg_temp.listing(v_listing)).title, 'rice, two portions', 'while the edit itself lands');
end $$;

-- ── T5 the listing-side rules still refuse through the post path ────────────────────
do $$
declare
  p personas;
begin
  select * into p from personas;
  perform kc_test.act_as(p.driver);
  perform kc_test.assert_raises(
    format($q$select pg_temp.create_ride(%L, 'too expensive', '{"reward_model":"expense_share","cost_share_ils":500}'::jsonb)$q$, p.driver),
    'ride_cost_share_cap_exceeded', 'the cost cap (D70) still applies');

  perform kc_test.act_as(p.cook);
  perform kc_test.assert_raises(
    format($q$select public.create_marketplace_listing(
        p_kind_id => kc_test.listing_kind_id('food', 'give_food'), p_title => 'soup',
        p_details => '{"food_type":"cooked"}'::jsonb, p_city_id => 'tel-aviv')$q$),
    'food_expiry_required', 'the food world rule (D21, 0539) still refuses an offer without an expiry through the post path');
  perform kc_test.assert_row_count(
    format('select 1 from public.posts where owner_id = %L and title = ''soup''', p.cook), 0,
    'a refused create leaves no post behind');
end $$;

-- ── T6 a food offer: the world TTL and urgency computed on the listing reach the post ─
do $$
declare
  p personas;
  v_listing uuid;
  l public.listings;
  po public.posts;
begin
  select * into p from personas;
  perform kc_test.act_as(p.cook);
  v_listing := public.create_marketplace_listing(
    p_kind_id => kc_test.listing_kind_id('food', 'give_food'), p_title => 'lentil soup',
    p_details => jsonb_build_object('food_type', 'cooked', 'expires_at', kc_test.iso_in(interval '6 hours')),
    p_city_id => 'tel-aviv');
  l := pg_temp.listing(v_listing);
  po := pg_temp.post_of(v_listing);
  perform kc_test.assert_eq(po.world_slug, 'food', 'the post lives in the food world');
  perform kc_test.assert_eq(po.expires_at, l.expires_at, 'the food expiry is on both sides');
  perform kc_test.assert_eq(po.urgency_level, l.urgency_level, 'the urgency computed from the expiry reached the post');
  perform kc_test.assert_true(po.listing_id = v_listing, 'the post points at its listing');
end $$;

-- ── T7 items and direct inserts keep their paths ────────────────────────────────────
do $$
declare
  p personas;
  v_listing uuid;
  l public.listings;
begin
  select * into p from personas;
  perform kc_test.act_as(p.cook);
  v_listing := public.create_marketplace_listing(
    p_kind_id => kc_test.listing_kind_id('items', 'give_item'), p_title => 'a chair',
    p_details => '{"item_condition":"Good"}'::jsonb, p_city_id => 'tel-aviv');
  l := pg_temp.listing(v_listing);
  perform kc_test.assert_true(l.legacy_post_id is null, 'an items listing created through the RPC stays listing-sourced');
  perform kc_test.assert_row_count(format('select 1 from public.posts where listing_id = %L', v_listing), 1,
    'and keeps its mirror post');

  v_listing := kc_test.create_listing(p.cook, 'food', 'give_food', 'give', 'bread',
    jsonb_build_object('food_type', 'packaged', 'expires_at', kc_test.iso_in(interval '2 days')), null);
  l := pg_temp.listing(v_listing);
  perform kc_test.assert_true(l.legacy_post_id is null, 'a directly inserted listing stays listing-sourced');
  perform kc_test.assert_row_count(format('select 1 from public.posts where listing_id = %L', v_listing), 1,
    'and gets its mirror post as before');
end $$;

-- ── T8 the report agrees on both sides ─────────────────────────────────────────────
do $$
declare
  r jsonb := public.post_unification_report();
begin
  perform kc_test.assert_eq((r ->> 'mirror_field_mismatches')::int, 0, 'every post agrees with its listing');
  perform kc_test.assert_eq((r ->> 'ride_field_mismatches')::int, 0, 'every ride extension agrees with its listing');
  perform kc_test.assert_eq((r ->> 'ride_details_missing')::int, 0, 'every ride post has its extension');
end $$;

rollback;
\echo '✓ 0554_posts_own_listing_worlds.sql passed'
