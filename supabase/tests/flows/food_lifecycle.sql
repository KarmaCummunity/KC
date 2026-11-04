-- flows/food_lifecycle.sql | Food world lifecycle (G38; docs/spec/05_giving_worlds.md §5.1):
-- publish with the giver's expiry → quick claim (confirmed at once) → hand over → karma →
-- rating, plus the expiry rules. Food expiry: 0266 / 0459 / 0539 (offers only, D21 / D28);
-- quick claim: 0383; hand over and rating: 0384 / 0453 / 0510; expiry sweep: 0467.

begin;

create temp table personas as
select kc_test.create_user('food_giver') as giver,
       kc_test.create_user('food_receiver') as receiver,
       kc_test.create_user('food_latecomer') as latecomer,
       kc_test.create_user('food_outsider') as outsider;

-- A food offer as the native create form stores it (give_food detail schema, 0241): the
-- giver's expiry lives in details.expires_at and is copied to listings.expires_at (0459).
create function pg_temp.create_food_offer(
  p_giver uuid, p_expires_in interval default interval '2 days', p_title text default 'Fresh cookies to share')
returns uuid language sql as $$
  select kc_test.create_listing(p_giver, 'food', 'give_food', 'give', p_title,
    jsonb_build_object('food_type', 'cooked', 'expires_at', kc_test.iso_in(p_expires_in),
                       'allergens', jsonb_build_array('gluten')),
    p_expires_at => null)
$$;

-- Quick-claims an offer as p_recipient (0383) and returns the handoff id.
create function pg_temp.claim_food(p_recipient uuid, p_listing uuid)
returns uuid language plpgsql as $$
begin
  perform kc_test.act_as(p_recipient);
  return (public.claim_food_giving(p_listing)).handoff_id;
end $$;

-- The listing's feed mirror (D-206), or null when the listing has none.
create function pg_temp.mirror_status(p_listing uuid)
returns text language sql as $$
  select status::text from public.posts where listing_id = p_listing
$$;

-- 1) Publishing: an offer carries the giver's expiry (D28); a request has none (D21).
do $$
declare
  p personas;
  v_offer uuid;
  v_request uuid;
  v_expired uuid;
begin
  select * into p from personas;
  v_offer := pg_temp.create_food_offer(p.giver, interval '2 days');
  perform kc_test.assert_eq(kc_test.listing_status(v_offer), 'open', 'food offer is published open');
  perform kc_test.assert_eq(
    (select expires_at from public.listings where listing_id = v_offer),
    (select (details->>'expires_at')::timestamptz from public.listings where listing_id = v_offer),
    'offer expires when the giver said, not after the world TTL (0459)');
  perform kc_test.assert_eq((select urgency_level from public.listings where listing_id = v_offer),
    3::smallint, 'food expiring within 72 h is urgent (0459)');
  perform kc_test.assert_eq(pg_temp.mirror_status(v_offer), 'open', 'offer reaches the feed');

  -- Regression (0539): the 168 h world TTL used to fill a missing expiry first.
  perform kc_test.act_as(p.giver);
  perform kc_test.assert_raises(format(
    'select kc_test.create_listing(%L, %L, %L, %L, %L, %L::jsonb, p_expires_at => null)',
    p.giver, 'food', 'give_food', 'give', 'Soup without a date', '{"food_type":"cooked"}'),
    'food_expiry_required', 'an offer without the giver''s expiry is rejected');

  -- Regression (0539): requests used to get the TTL and be closed by the sweep a week later.
  v_request := kc_test.create_listing(p.receiver, 'food', 'request_food', 'request',
    'Family of four needs groceries', '{"household_size":4}'::jsonb, p_expires_at => null);
  perform kc_test.assert_eq(kc_test.listing_status(v_request), 'open', 'food request is published open');
  perform kc_test.assert_true(
    (select expires_at is null from public.listings where listing_id = v_request),
    'a food request has no expiry');

  v_expired := pg_temp.create_food_offer(p.giver, interval '-1 hour', 'Yesterday''s bread');
  perform kc_test.assert_eq(kc_test.listing_status(v_expired), 'expired',
    'an offer already past its expiry is stored expired (0266)');
end $$;

-- 2) Quick claim: confirmed at once for the first member; the owner and later members are refused.
do $$
declare
  p personas;
  v_listing uuid;
  v_handoff uuid;
begin
  select * into p from personas;
  v_listing := pg_temp.create_food_offer(p.giver);

  perform kc_test.act_as(p.giver);
  perform kc_test.assert_raises(format('select public.claim_food_giving(%L)', v_listing),
    'own_listing', 'the giver cannot claim their own offer');

  v_handoff := pg_temp.claim_food(p.receiver, v_listing);
  perform kc_test.assert_eq(kc_test.handoff_status(v_handoff), 'confirmed',
    'a quick claim is confirmed without owner approval (0383)');
  perform kc_test.assert_eq((select availability_status from public.listings where listing_id = v_listing),
    'scheduled', 'the claimed offer is scheduled for pickup');
  perform kc_test.assert_eq(kc_test.listing_status(v_listing), 'open', 'the claimed offer stays open until handed over');

  -- The record's one-live-claim index (post_handoffs_active_post_uidx, 0555) surfaces as the
  -- code the app already shows for it.
  perform kc_test.act_as(p.latecomer);
  perform kc_test.assert_raises(format('select public.claim_food_giving(%L)', v_listing),
    'listing_not_available', 'a second member cannot claim an offer with a live claim');
end $$;

-- 3) Hand over and rate: the listing closes, karma follows §7.6, each side rates once.
do $$
declare
  p personas;
  v_listing uuid;
  v_handoff uuid;
begin
  select * into p from personas;
  v_listing := pg_temp.create_food_offer(p.giver);
  v_handoff := pg_temp.claim_food(p.receiver, v_listing);

  perform kc_test.act_as(p.outsider);
  perform kc_test.assert_raises(format('select public.mark_giving_handed_over(%L)', v_handoff),
    'handoff_not_confirmed', 'a non-participant cannot mark the handoff');

  perform kc_test.act_as(p.giver);
  perform public.mark_giving_handed_over(v_handoff);
  perform kc_test.assert_eq(kc_test.handoff_status(v_handoff), 'handed_over', 'giver marks the food handed over');
  perform kc_test.assert_eq(kc_test.listing_status(v_listing), 'closed', 'a handed-over offer closes');
  perform kc_test.assert_eq(pg_temp.mirror_status(v_listing), 'closed_delivered', 'the feed shows it delivered');
  perform kc_test.assert_eq((select points_delta from public.karma_ledger where user_id = p.giver
      and event_type = 'giving_handoff_giver' and ref_id = v_handoff::text), 20, 'food giver earns 20 (spec 07 §7.6)');
  perform kc_test.assert_eq((select points_delta from public.karma_ledger where user_id = p.receiver
      and event_type = 'giving_handoff_receiver' and ref_id = v_handoff::text), 10, 'food receiver earns 10 (spec 07 §7.6)');

  perform kc_test.act_as(p.receiver);
  perform kc_test.assert_raises(format('select public.rate_giving_handoff(%L, 6::smallint)', v_handoff),
    'invalid_rating', 'a rating is 1–5 stars');
  perform public.rate_giving_handoff(v_handoff, 5::smallint, 'Delicious, thank you');
  perform kc_test.assert_row_count(format(
    'select 1 from public.giving_handoff_ratings where handoff_id = %L and rater_id = %L and rating = 5',
    v_handoff, p.receiver), 1, 'the receiver''s rating is stored');
  perform kc_test.assert_row_count(format(
    'select 1 from public.karma_ledger where user_id = %L and event_type = %L',
    p.receiver, 'rating_given'), 1, 'rating earns the rater 2 karma once (0510)');

  perform kc_test.act_as(p.outsider);
  perform kc_test.assert_raises(format('select public.rate_giving_handoff(%L, 4::smallint)', v_handoff),
    'not_participant', 'only the two sides of the handoff may rate it');
end $$;

-- 4) Expiry sweep (S4, 0467): unclaimed and claimed offers past expiry become `expired`, a
--    live claim is cancelled, the feed never shows them delivered; requests are not swept.
do $$
declare
  p personas;
  v_unclaimed uuid;
  v_claimed uuid;
  v_handoff uuid;
  v_request uuid;
begin
  select * into p from personas;
  v_unclaimed := pg_temp.create_food_offer(p.giver, interval '1 hour', 'Salad for tonight');
  v_claimed := pg_temp.create_food_offer(p.giver, interval '1 hour', 'Pasta for tonight');
  v_handoff := pg_temp.claim_food(p.receiver, v_claimed);
  v_request := kc_test.create_listing(p.receiver, 'food', 'request_food', 'request',
    'Looking for fresh vegetables', '{"household_size":2}'::jsonb, p_expires_at => null);

  -- Simulate the hour passing: writing a past expiry would fire the write-time block (0266)
  -- instead of leaving the rows for the hourly sweep, so that trigger is off for the backdate.
  alter table public.listings disable trigger listings_food_expiry_block;
  update public.listings set expires_at = now() - interval '1 minute'
   where listing_id in (v_unclaimed, v_claimed);
  alter table public.listings enable trigger listings_food_expiry_block;

  perform kc_test.assert_eq(public.food_expired_listings_sweep(), 2, 'the sweep expires both offers');
  perform kc_test.assert_eq(kc_test.listing_status(v_unclaimed), 'expired', 'unclaimed offer is expired, not closed');
  perform kc_test.assert_eq(kc_test.listing_status(v_claimed), 'expired', 'claimed offer past expiry is expired');
  perform kc_test.assert_eq(kc_test.handoff_status(v_handoff), 'cancelled', 'the live claim is cancelled');
  perform kc_test.assert_eq(pg_temp.mirror_status(v_unclaimed), 'expired', 'the feed shows it expired, not delivered');
  perform kc_test.assert_row_count(format(
    'select 1 from public.notifications_outbox where dedupe_key = %L', 'food_expired:' || v_unclaimed),
    1, 'the giver is told the offer expired');
  perform kc_test.assert_eq(kc_test.listing_status(v_request), 'open', 'a food request is never swept');
end $$;

rollback;

\echo '✓ flows/food_lifecycle.sql passed'
