-- supabase/tests/0621_g1_handoff_triggers_on_posts.sql | 0621 (G1 step 6a-3a, ADR-006, D-214): what
-- reacted to or hung off `giving_handoffs` sits on `post_handoffs`, with the same behaviour:
--   0. the moved triggers are on post_handoffs and gone from giving_handoffs (so each change fires
--      them once); the foreign keys of the ratings and the booking details reference the record;
--      housing_booking_enqueue takes the record row only;
--   1. items: a request, its approval and hand-over push the other side with the same payload
--      (listing id kept, the post route added by 0562); rating the handed-over item works and the
--      rating goes with its record; the cancel-reason default still names who cancelled;
--   2. rides: a booking request and its confirmation push the other side, same payload;
--   3. housing: a stay request (pushed by the RPC with the record row), its approval and a decline;
--   4. food: the expiry sweep cancels the open claim on the record and giving_handoffs follows;
--   5. time: an event registration fires none of the item / ride / housing pushes, keeps the
--      reason its cancel wrote, and cannot be rated as a giving handoff.
-- STABLE helpers (post_id_of_listing) are read in a statement after the one that creates the row.
-- Runs in a rolled-back transaction.

begin;

create temp table personas as
select kc_test.create_user('ht_giver')            as giver,
       kc_test.create_user('ht_taker')            as taker,
       kc_test.create_user('ht_driver')           as driver,
       kc_test.create_user('ht_rider')            as rider,
       kc_test.create_housing_member('ht_host')   as host,
       kc_test.create_housing_member('ht_guest')  as guest,
       kc_test.create_housing_member('ht_guest2') as guest2,
       kc_test.create_user('ht_organizer')        as organizer,
       kc_test.create_user('ht_attendee')         as attendee,
       gen_random_uuid()                          as org_id;

-- ── helpers ───────────────────────────────────────────────────────────────────────────────────

/** Every push queued for p_user about the handoff p_handoff (any kind). */
create function pg_temp.pushes(p_user uuid, p_handoff uuid)
returns bigint
language sql
as $$
  select count(*) from public.notifications_outbox
   where user_id = p_user and position(p_handoff::text in coalesce(dedupe_key, '')) > 0;
$$;

/**
 * The one p_kind push to p_user about p_handoff carries the payload the trigger wrote before 0621:
 * critical, the copy keys of p_copy_key, p_body_args, and the listing route with the listing id,
 * to which 0562 adds the post route and id.
 */
create function pg_temp.assert_push(
  p_user uuid, p_kind text, p_handoff uuid, p_copy_key text, p_body_args jsonb,
  p_listing uuid, p_post uuid, p_message text
)
returns void
language plpgsql
as $$
declare
  v public.notifications_outbox;
begin
  select * into v from public.notifications_outbox
   where user_id = p_user and kind = p_kind and dedupe_key like p_kind || ':' || p_handoff::text || '%';
  if not found then
    perform kc_test.fail(p_message || ': no push');
  end if;
  perform kc_test.assert_eq(v.category, 'critical', p_message || ': category');
  perform kc_test.assert_eq(v.title_key, 'notifications.' || p_copy_key || 'Title', p_message || ': title key');
  perform kc_test.assert_eq(v.body_key, 'notifications.' || p_copy_key || 'Body', p_message || ': body key');
  perform kc_test.assert_eq(v.body_args, p_body_args, p_message || ': body args');
  perform kc_test.assert_eq(v.data, jsonb_build_object(
    'route', '/post/[id]',
    'params', jsonb_build_object('listingId', p_listing::text, 'postId', p_post::text, 'id', p_post::text)),
    p_message || ': route and ids');
end $$;

/** An open item offer by p_owner through the app's RPC; returns its listing id. */
create function pg_temp.item_offer(p_owner uuid, p_title text)
returns uuid
language plpgsql
as $$
begin
  perform kc_test.act_as(p_owner);
  return public.create_marketplace_listing(
    p_kind_id => kc_test.listing_kind_id('items', 'give_item'), p_title => p_title,
    p_details => '{"item_condition":"Good","fulfillment_mode":"owner_approval"}'::jsonb,
    p_city_id => 'tel-aviv');
end $$;

/** Publishes an automatic-registration event as p_owner for p_org (as the create form does). */
create function pg_temp.publish_event(p_owner uuid, p_org uuid)
returns uuid
language plpgsql
as $$
begin
  perform kc_test.act_as(p_owner);
  return public.create_marketplace_listing(
    p_kind_id => kc_test.listing_kind_id('time', 'org_event'), p_title => 'park cleanup',
    p_details => jsonb_build_object(
      'org_id', p_org::text, 'registration_policy', 'automatic', 'capacity', 10,
      'starts_at', kc_test.iso_in(interval '2 days'), 'ends_at', kc_test.iso_in(interval '2 days 3 hours'),
      'address', 'Central park'),
    p_city_id => 'tel-aviv');
end $$;

-- 0520: pg_temp helpers are owner-only by default; grant them so any caller may run them.
grant execute on function pg_temp.pushes(uuid, uuid) to public;
grant execute on function pg_temp.assert_push(uuid, text, uuid, text, jsonb, uuid, uuid, text) to public;
grant execute on function pg_temp.item_offer(uuid, text) to public;
grant execute on function pg_temp.publish_event(uuid, uuid) to public;

-- ── 0. where the triggers and the keys are ────────────────────────────────────────────────────
do $$
begin
  perform kc_test.assert_row_count(
    $q$select tgname from pg_trigger
        where tgrelid = 'public.giving_handoffs'::regclass and not tgisinternal
          and tgname not in ('giving_handoffs_rate_limit', 'giving_handoffs_post_handoffs_sync')$q$,
    0, 'giving_handoffs keeps only its write cap and its sync to the record');
  perform kc_test.assert_row_count(
    $q$select 1 from pg_trigger t
        where t.tgrelid = 'public.post_handoffs'::regclass and not t.tgisinternal and t.tgenabled = 'O'
          and (t.tgname::text, t.tgfoid) in (
            ('post_handoffs_set_cancel_reason', 'public.giving_handoffs_set_cancel_reason()'::regprocedure::oid),
            ('post_handoffs_giving_notify', 'public.giving_handoff_notify()'::regprocedure::oid),
            ('post_handoffs_ride_notify', 'public.ride_booking_notify()'::regprocedure::oid),
            ('post_handoffs_housing_notify', 'public.housing_booking_notify()'::regprocedure::oid))$q$,
    4, 'the four triggers are on the record');

  perform kc_test.assert_row_count(
    $q$select 1 from pg_constraint c
        where c.contype = 'f' and c.convalidated and c.confdeltype = 'c'
          and c.conrelid in ('public.giving_handoff_ratings'::regclass, 'public.housing_booking_details'::regclass)
          and c.confrelid = 'public.post_handoffs'::regclass
          and c.conkey = array[(select a.attnum from pg_attribute a
                                 where a.attrelid = c.conrelid and a.attname = 'handoff_id')]$q$,
    2, 'the ratings and the booking details reference the record, validated, on delete cascade');
  perform kc_test.assert_row_count(
    $q$select 1 from pg_constraint c
        where c.contype = 'f'
          and c.conrelid in ('public.giving_handoff_ratings'::regclass, 'public.housing_booking_details'::regclass)
          and c.confrelid = 'public.giving_handoffs'::regclass$q$,
    0, 'nothing references giving_handoffs any more');

  perform kc_test.assert_true(
    to_regprocedure('public.housing_booking_enqueue(public.post_handoffs, text, uuid, uuid, text)') is not null,
    'housing_booking_enqueue takes the record row');
  perform kc_test.assert_true(
    to_regprocedure('public.housing_booking_enqueue(public.giving_handoffs, text, uuid, uuid, text)') is null,
    'and no longer the giving_handoffs row');
end $$;

-- ── 1. items: request, approval, hand-over, rating; who cancelled ─────────────────────────────
do $$
declare
  p personas;
  v_listing uuid;
  v_post uuid;
  h public.giving_handoffs;
  r public.giving_handoff_ratings;
  v_second uuid;
  v_third uuid;
begin
  select * into p from personas;
  v_listing := pg_temp.item_offer(p.giver, 'a reading lamp');
  v_post := public.post_id_of_listing(v_listing);
  perform kc_test.assert_true(v_post is not null, 'the item offer has its post');

  perform kc_test.act_as(p.taker);
  h := public.reserve_item_giving(v_listing, 'pickup', null, null);
  perform pg_temp.assert_push(p.giver, 'giving_handoff_requested', h.handoff_id, 'givingHandoffRequested',
    jsonb_build_object('name', 'Test ht_taker', 'listingTitle', 'a reading lamp'), v_listing, v_post,
    'items: the request reaches the giver');
  perform kc_test.assert_eq(pg_temp.pushes(p.giver, h.handoff_id), 1::bigint, 'items: once');
  perform kc_test.assert_eq(pg_temp.pushes(p.taker, h.handoff_id), 0::bigint, 'items: not the requester');

  perform kc_test.act_as(p.giver);
  h := public.confirm_item_handoff(h.handoff_id);
  perform pg_temp.assert_push(p.taker, 'giving_handoff_confirmed', h.handoff_id, 'givingHandoffConfirmed',
    jsonb_build_object('name', 'Test ht_giver', 'listingTitle', 'a reading lamp'), v_listing, v_post,
    'items: the approval reaches the requester');
  h := public.mark_giving_handed_over(h.handoff_id);
  perform pg_temp.assert_push(p.taker, 'giving_handoff_completed', h.handoff_id, 'givingHandoffCompleted',
    jsonb_build_object('name', 'Test ht_giver', 'listingTitle', 'a reading lamp'), v_listing, v_post,
    'items: the hand-over asks the requester to rate');
  perform kc_test.assert_eq(pg_temp.pushes(p.taker, h.handoff_id), 2::bigint, 'items: two pushes to the requester');
  perform kc_test.assert_eq(pg_temp.pushes(p.giver, h.handoff_id), 1::bigint,
    'items: the giver who marked it is not pushed');

  -- Rating the handed-over item, read from the record.
  perform kc_test.act_as(p.taker);
  r := public.rate_giving_handoff(h.handoff_id, 5::smallint, 'thanks');
  perform kc_test.assert_eq(r.ratee_id, p.giver, 'rating: the requester rates the giver');
  perform kc_test.assert_eq(r.rating, 5::smallint, 'rating: with the stars given');
  perform kc_test.act_as(p.giver);
  r := public.rate_giving_handoff(h.handoff_id, 4::smallint, null);
  perform kc_test.assert_eq(r.ratee_id, p.taker, 'rating: the giver rates the requester');
  perform kc_test.act_as(p.driver);
  perform kc_test.assert_raises(format('select public.rate_giving_handoff(%L, 5::smallint, null)', h.handoff_id),
    'not_participant', 'rating: a stranger may not rate');
  perform kc_test.assert_raises(format('select public.rate_giving_handoff(%L, 5::smallint, null)', gen_random_uuid()),
    'handoff_not_found', 'rating: nor rate an unknown handoff');

  -- The ratings go with their record (on delete cascade), and the sync removes the derived row.
  delete from public.post_handoffs where handoff_id = h.handoff_id;
  perform kc_test.assert_row_count(
    format('select 1 from public.giving_handoff_ratings where handoff_id = %L', h.handoff_id), 0,
    'rating: deleting the record deletes its ratings');
  perform kc_test.assert_row_count(
    format('select 1 from public.giving_handoffs where handoff_id = %L', h.handoff_id), 0,
    'rating: and the derived giving_handoffs row');

  -- Who cancelled: the giver declines, the requester cancels, a sweep (no caller) cancels.
  v_listing := pg_temp.item_offer(p.giver, 'a folding chair');
  v_post := public.post_id_of_listing(v_listing);
  perform kc_test.act_as(p.taker);
  v_second := (public.reserve_item_giving(v_listing, 'pickup', null, null)).handoff_id;
  perform kc_test.act_as(p.giver);
  perform public.cancel_giving_handoff(v_second);
  perform kc_test.assert_eq((select cancel_reason from public.post_handoffs where handoff_id = v_second),
    'driver_cancelled', 'cancel reason: the owner''s cancel is the owner''s, on the record');
  perform kc_test.assert_eq((select cancel_reason from public.giving_handoffs where handoff_id = v_second),
    'driver_cancelled', 'cancel reason: and on the derived row');
  perform pg_temp.assert_push(p.taker, 'giving_handoff_declined', v_second, 'givingHandoffDeclined',
    jsonb_build_object('name', 'Test ht_giver', 'listingTitle', 'a folding chair'), v_listing, v_post,
    'items: the giver''s decline reaches the requester');

  perform kc_test.act_as(p.taker);
  v_third := (public.reserve_item_giving(v_listing, 'pickup', null, null)).handoff_id;
  perform public.cancel_giving_handoff(v_third);
  perform kc_test.assert_eq((select cancel_reason from public.post_handoffs where handoff_id = v_third),
    'passenger_cancelled', 'cancel reason: the requester''s cancel is the requester''s');
  perform pg_temp.assert_push(p.giver, 'giving_handoff_cancelled', v_third, 'givingHandoffCancelled',
    jsonb_build_object('name', 'Test ht_taker', 'listingTitle', 'a folding chair'), v_listing, v_post,
    'items: the requester''s cancel reaches the giver');
  perform kc_test.assert_eq(pg_temp.pushes(p.taker, v_third), 0::bigint, 'items: not the requester who cancelled');

  v_third := (public.reserve_item_giving(v_listing, 'pickup', null, null)).handoff_id;
  perform set_config('request.jwt.claims', '', true);
  update public.post_handoffs set status = 'cancelled', cancelled_at = now() where handoff_id = v_third;
  perform kc_test.assert_eq((select cancel_reason from public.post_handoffs where handoff_id = v_third),
    'system', 'cancel reason: a write with no caller is the system''s');
  perform kc_test.assert_eq((select cancel_reason from public.giving_handoffs where handoff_id = v_third),
    'system', 'cancel reason: and the derived row follows');
  perform kc_test.assert_eq(pg_temp.pushes(p.giver, v_third) + pg_temp.pushes(p.taker, v_third), 3::bigint,
    'items: a system cancel reaches both sides once (plus the giver''s request push)');
end $$;

-- ── 2. rides: a booking request and its confirmation ──────────────────────────────────────────
do $$
declare
  p personas;
  v_ride uuid;
  v_post uuid;
  v_title text;
  h uuid;
begin
  select * into p from personas;
  v_ride := kc_test.create_ride_offer(p.driver, p_seats => 3);
  v_post := public.post_id_of_listing(v_ride);
  v_title := (select title from public.listings where listing_id = v_ride);
  perform kc_test.assert_true(v_post is not null, 'the ride offer has its post');

  h := kc_test.book_ride(p.rider, v_ride, 2);
  perform pg_temp.assert_push(p.driver, 'ride_booking_requested', h, 'rideBookingRequested',
    jsonb_build_object('name', 'Test ht_rider', 'rideTitle', v_title, 'seats', 2), v_ride, v_post,
    'rides: the booking request reaches the driver');
  perform kc_test.assert_eq(pg_temp.pushes(p.driver, h), 1::bigint, 'rides: once');
  perform kc_test.assert_eq(pg_temp.pushes(p.rider, h), 0::bigint, 'rides: not the passenger');

  perform kc_test.act_as(p.driver);
  perform public.confirm_ride_booking(h);
  perform pg_temp.assert_push(p.rider, 'ride_booking_confirmed', h, 'rideBookingConfirmed',
    jsonb_build_object('name', 'Test ht_driver', 'rideTitle', v_title, 'seats', 2), v_ride, v_post,
    'rides: the confirmation reaches the passenger');
  perform kc_test.assert_eq(pg_temp.pushes(p.rider, h), 1::bigint, 'rides: once');
  perform kc_test.assert_row_count(
    format('select 1 from public.notifications_outbox where kind like ''giving_handoff_%%'' and dedupe_key like ''%%%s%%''', h),
    0, 'rides: no item / food push for a ride booking');
end $$;

-- ── 3. housing: a request, its approval, a decline ────────────────────────────────────────────
do $$
declare
  p personas;
  v_offer uuid;
  v_post uuid;
  v_check_in text := to_char(public.housing_today() + 3, 'DD/MM');
  h1 uuid;
  h2 uuid;
begin
  select * into p from personas;
  v_offer := kc_test.create_housing_offer(p.host);
  v_post := public.post_id_of_listing(v_offer);
  perform kc_test.assert_true(v_post is not null, 'the stay offer has its post');

  h1 := kc_test.request_stay(p.guest, v_offer, 3, 2);
  perform pg_temp.assert_push(p.host, 'housing_booking_requested', h1, 'housingBookingRequested',
    jsonb_build_object('name', 'Test ht_guest', 'listingTitle', 'Room for travellers', 'guests', 1,
                       'checkIn', v_check_in), v_offer, v_post,
    'housing: the request reaches the host, with the dates');
  perform kc_test.assert_eq(pg_temp.pushes(p.host, h1), 1::bigint, 'housing: once');
  perform kc_test.assert_eq(pg_temp.pushes(p.guest, h1), 0::bigint, 'housing: not the guest');

  perform kc_test.approve_stay(p.host, h1);
  perform pg_temp.assert_push(p.guest, 'housing_booking_confirmed', h1, 'housingBookingConfirmed',
    jsonb_build_object('name', 'Test ht_host', 'listingTitle', 'Room for travellers', 'guests', 1,
                       'checkIn', v_check_in), v_offer, v_post,
    'housing: the approval reaches the guest');
  perform kc_test.assert_eq(pg_temp.pushes(p.guest, h1), 1::bigint, 'housing: once');
  perform kc_test.assert_eq(pg_temp.pushes(p.host, h1), 1::bigint, 'housing: the host only had the request');

  h2 := kc_test.request_stay(p.guest2, v_offer, 3, 1);
  perform kc_test.act_as(p.host);
  perform public.decide_housing_booking(h2, false, 'fully booked');
  perform kc_test.assert_eq((select cancel_reason from public.post_handoffs where handoff_id = h2), 'declined',
    'housing: the decline keeps its own reason');
  perform pg_temp.assert_push(p.guest2, 'housing_booking_declined', h2, 'housingBookingDeclined',
    jsonb_build_object('name', 'Test ht_host', 'listingTitle', 'Room for travellers', 'guests', 1,
                       'checkIn', v_check_in), v_offer, v_post,
    'housing: the decline reaches the guest');
  perform kc_test.assert_eq(pg_temp.pushes(p.guest2, h2), 1::bigint, 'housing: once');
end $$;

-- ── 4. food: the expiry sweep cancels the open claim on the record ────────────────────────────
do $$
declare
  p personas;
  v_listing uuid;
  v_handoff uuid;
begin
  select * into p from personas;
  v_listing := kc_test.create_listing(p.giver, 'food', 'give_food', 'give', 'ht soup',
    jsonb_build_object('food_type', 'cooked', 'expires_at', now() + interval '1 day'));
  perform kc_test.act_as(p.taker);
  v_handoff := (public.claim_food_giving(v_listing)).handoff_id;

  -- The expiry block trigger is paused so the offer can pass its expiry inside this transaction (0467).
  alter table public.listings disable trigger listings_food_expiry_block;
  update public.listings set expires_at = now() - interval '1 minute' where listing_id = v_listing;
  alter table public.listings enable trigger listings_food_expiry_block;

  perform set_config('request.jwt.claims', '', true);
  perform kc_test.assert_true(public.food_expired_listings_sweep() >= 1, 'food: the sweep expires the offer');
  perform kc_test.assert_eq(kc_test.listing_status(v_listing), 'expired', 'food: the offer is expired');
  perform kc_test.assert_eq((select status from public.post_handoffs where handoff_id = v_handoff), 'cancelled',
    'food: the open claim is cancelled on the record');
  perform kc_test.assert_eq(kc_test.handoff_status(v_handoff), 'cancelled', 'food: and giving_handoffs follows');
  perform kc_test.assert_eq((select cancel_reason from public.giving_handoffs where handoff_id = v_handoff), 'system',
    'food: as a system cancel');
  perform kc_test.assert_eq(
    (select count(*) from public.notifications_outbox
      where kind = 'giving_handoff_cancelled' and dedupe_key like 'giving_handoff_cancelled:' || v_handoff::text || ':%'),
    2::bigint, 'food: both sides hear of the system cancel, once each');
end $$;

-- ── 5. time: an event registration fires none of it ───────────────────────────────────────────
insert into public.organizations (org_id, name, slug)
select org_id, 'Handoff triggers org', 'handoff-triggers-org' from personas;
insert into public.org_memberships (org_id, user_id, role)
select org_id, organizer, 'org_volunteer' from personas;

do $$
declare
  p personas;
  v_event uuid;
  v_post uuid;
  v_reg public.post_handoffs;
begin
  select * into p from personas;
  v_event := pg_temp.publish_event(p.organizer, p.org_id);
  v_post := public.post_id_of_listing(v_event);
  perform kc_test.assert_true(v_post is not null, 'the event has its post');

  -- An automatic registration is inserted confirmed: an item or food claim would push the owner.
  perform kc_test.act_as(p.attendee);
  v_reg := public.register_for_event(v_post);
  perform kc_test.assert_eq(v_reg.status, 'confirmed', 'time: the registration is confirmed');
  perform kc_test.assert_eq(pg_temp.pushes(p.organizer, v_reg.handoff_id) + pg_temp.pushes(p.attendee, v_reg.handoff_id),
    0::bigint, 'time: a registration pushes nobody');

  -- The attendee's own cancel writes no reason; the default stays off the time world.
  v_reg := public.cancel_event_registration(v_reg.handoff_id);
  perform kc_test.assert_true(
    (select cancel_reason from public.post_handoffs where handoff_id = v_reg.handoff_id) is null,
    'time: the attendee''s cancel keeps no reason');
  perform kc_test.assert_eq(pg_temp.pushes(p.organizer, v_reg.handoff_id) + pg_temp.pushes(p.attendee, v_reg.handoff_id),
    0::bigint, 'time: a cancelled registration pushes nobody');

  -- Attended (as mark_event_attendance writes it, before the event's start): no push, no rating.
  v_reg := public.register_for_event(v_post);
  update public.post_handoffs set status = 'handed_over', handed_over_at = now()
   where handoff_id = v_reg.handoff_id;
  perform kc_test.assert_eq(pg_temp.pushes(p.organizer, v_reg.handoff_id) + pg_temp.pushes(p.attendee, v_reg.handoff_id),
    0::bigint, 'time: an attended registration pushes nobody');
  perform kc_test.assert_raises(format('select public.rate_giving_handoff(%L, 5::smallint, null)', v_reg.handoff_id),
    'handoff_not_found', 'time: an event registration is not rated as a giving handoff');
  perform kc_test.assert_row_count(
    format('select 1 from public.giving_handoffs where handoff_id = %L', v_reg.handoff_id), 0,
    'time: and it has no giving_handoffs row');
end $$;

rollback;

\echo '✓ 0621_g1_handoff_triggers_on_posts passed'
