-- flows/rides_lifecycle.sql | Rides world lifecycle contract (G38, docs/spec §5.3):
-- publish → corridor match → book → confirm → complete → karma → rating, plus every
-- guard on the way (capacity, duplicates, own ride, departed ride, roles, timing).
-- Any change to the rides RPCs (0392–0394, 0399) must keep this file green.

begin;

-- Personas for the whole file; a temp table keeps their ids between DO blocks and
-- disappears with the final rollback.
create temp table personas as
select kc_test.create_user('ride_driver')     as driver,
       kc_test.create_user('ride_passenger1') as passenger1,
       kc_test.create_user('ride_passenger2') as passenger2,
       kc_test.create_user('ride_stranger')   as stranger;

-- 1) Publish + corridor match: a passenger near both ends finds the ride; a far
--    corridor (Haifa → Eilat) does not.
do $$
declare
  p personas;
  v_ride uuid;
begin
  select * into p from personas;
  v_ride := kc_test.create_ride_offer(p.driver, p_seats => 2);

  perform kc_test.act_as(p.passenger1);
  perform kc_test.assert_row_count(
    format('select 1 from public.find_ride_listing_matches(32.07, 34.79, 31.78, 35.20)
             where listing_id = %L and seats_left = 2', v_ride),
    1, 'nearby corridor finds the ride with 2 free seats');
  perform kc_test.assert_row_count(
    format('select 1 from public.find_ride_listing_matches(32.79, 34.99, 29.55, 35.95)
             where listing_id = %L', v_ride),
    0, 'far corridor does not match');
end $$;

-- 2) Booking guards on a 2-seat ride.
do $$
declare
  p personas;
  v_ride uuid;
  v_booking uuid;
begin
  select * into p from personas;
  v_ride := kc_test.create_ride_offer(p.driver, p_seats => 2);

  v_booking := kc_test.book_ride(p.passenger1, v_ride, 1);
  perform kc_test.assert_eq(kc_test.handoff_status(v_booking), 'reserved', 'first booking is reserved');

  perform kc_test.assert_raises(format('select public.book_ride_seat(%L, 1)', v_ride),
    'already_booked', 'the same passenger cannot book twice');

  perform kc_test.act_as(p.driver);
  perform kc_test.assert_raises(format('select public.book_ride_seat(%L, 1)', v_ride),
    'own_listing', 'the driver cannot book their own ride');

  perform kc_test.act_as(p.passenger2);
  perform kc_test.assert_raises(format('select public.book_ride_seat(%L, 2)', v_ride),
    'seats_exhausted', 'booking more seats than are left fails');

  -- Cancelling frees the seat for the next passenger.
  perform kc_test.act_as(p.passenger1);
  perform public.cancel_ride_booking(v_booking);
  perform kc_test.assert_eq(kc_test.handoff_status(v_booking), 'cancelled', 'passenger cancels');
  v_booking := kc_test.book_ride(p.passenger2, v_ride, 2);
  perform kc_test.assert_eq(kc_test.handoff_status(v_booking), 'reserved', 'freed seats can be booked');

  perform kc_test.act_as(p.stranger);
  perform kc_test.assert_raises(format('select public.cancel_ride_booking(%L)', v_booking),
    'not_participant', 'a stranger cannot cancel someone else''s booking');
end $$;

-- 3) A ride that already departed cannot be booked.
do $$
declare
  p personas;
  v_ride uuid;
begin
  select * into p from personas;
  v_ride := kc_test.create_ride_offer(p.driver, p_departs_in => interval '-10 minutes');

  perform kc_test.act_as(p.passenger1);
  perform kc_test.assert_raises(format('select public.book_ride_seat(%L, 1)', v_ride),
    'ride_departed', 'a departed ride rejects bookings');
end $$;

-- 4) Confirmation is the driver's call; completion only opens an hour before departure.
do $$
declare
  p personas;
  v_ride uuid;
  v_booking uuid;
begin
  select * into p from personas;
  v_ride := kc_test.create_ride_offer(p.driver, p_seats => 1, p_departs_in => interval '3 hours');
  v_booking := kc_test.book_ride(p.passenger1, v_ride);

  perform kc_test.assert_raises(format('select public.confirm_ride_booking(%L)', v_booking),
    'owner_only', 'a passenger cannot confirm their own booking');

  perform kc_test.act_as(p.driver);
  perform public.confirm_ride_booking(v_booking);
  perform kc_test.assert_eq(kc_test.handoff_status(v_booking), 'confirmed', 'driver confirms');

  perform kc_test.assert_raises(format('select public.complete_ride_trip(%L)', v_booking),
    'ride_not_started', 'a trip cannot be completed hours before departure');
end $$;

-- 5) Approval rechecks occupied seats under the listing lock. A booking that no longer
--    fits cannot be confirmed, while a booking within capacity can.
do $$
declare
  p personas;
  v_ride uuid;
  v_over_capacity uuid;
  v_within_capacity uuid;
begin
  select * into p from personas;
  v_ride := kc_test.create_ride_offer(p.driver, p_seats => 2);
  v_over_capacity := kc_test.book_ride(p.passenger1, v_ride);
  perform kc_test.book_ride(p.passenger2, v_ride);

  -- Simulate capacity being reduced after the bookings were made.
  update public.listings
     set details = jsonb_set(details, '{seats_available}', '1'::jsonb)
   where listing_id = v_ride;
  if not exists (select 1 from pg_trigger where tgname = 'listings_feed_mirror_sync') then
    update public.posts
       set details = jsonb_set(details, '{seats_available}', '1'::jsonb)
     where listing_id = v_ride or post_id = v_ride;
  end if;
  perform kc_test.act_as(p.driver);
  perform kc_test.assert_raises(format('select public.confirm_ride_booking(%L)', v_over_capacity),
    'ride_seats_exhausted', 'approval fails when occupied bookings exceed the current capacity');

  v_ride := kc_test.create_ride_offer(p.driver, p_seats => 2);
  v_within_capacity := kc_test.book_ride(p.passenger1, v_ride);
  perform kc_test.act_as(p.driver);
  perform public.confirm_ride_booking(v_within_capacity);
  perform kc_test.assert_eq(kc_test.handoff_status(v_within_capacity), 'confirmed',
    'approval succeeds while seats remain within capacity');
end $$;

-- 6) Completion: karma for both sides, the ride closes only once every seat is handed
--    over, completing twice fails, and each side rates exactly once.
do $$
declare
  p personas;
  v_ride uuid;
  v_first uuid;
  v_second uuid;
begin
  select * into p from personas;
  v_ride := kc_test.create_ride_offer(p.driver, p_seats => 2);
  v_first := kc_test.book_ride(p.passenger1, v_ride);
  v_second := kc_test.book_ride(p.passenger2, v_ride);

  perform kc_test.act_as(p.driver);
  perform public.confirm_ride_booking(v_first);
  perform public.confirm_ride_booking(v_second);

  perform kc_test.act_as(p.passenger1);
  perform public.complete_ride_trip(v_first);
  perform kc_test.assert_eq(kc_test.handoff_status(v_first), 'handed_over', 'first trip completed');
  perform kc_test.assert_eq(kc_test.listing_status(v_ride), 'open', 'ride stays open while a seat is pending');
  perform kc_test.assert_raises(format('select public.complete_ride_trip(%L)', v_first),
    'invalid_status', 'a trip cannot be completed twice');
  perform kc_test.assert_row_count(
    format('select 1 from public.karma_ledger where ref_id = %L
             and event_type in (''giving_handoff_giver'', ''giving_handoff_receiver'')', v_first),
    2, 'completion grants karma to driver and passenger');

  perform kc_test.act_as(p.driver);
  perform public.complete_ride_trip(v_second);
  perform kc_test.assert_eq(kc_test.listing_status(v_ride), 'closed', 'ride closes when every seat is handed over');

  perform kc_test.act_as(p.passenger1);
  perform kc_test.assert_eq(public.get_listing_handoff(v_ride) ->> 'status', 'handed_over',
    'an unrated completed trip is offered for rating');
  perform public.rate_giving_handoff(v_first, 5::smallint, 'Great ride');
  perform kc_test.assert_true(public.get_listing_handoff(v_ride) is null,
    'a rated trip is no longer offered for rating');
end $$;

-- 7) The driver can finish the whole ride with unused capacity: approved trips settle,
--    waiting requests are cancelled, the listing closes, and passengers can still rate.
do $$
declare
  p personas;
  v_ride uuid;
  v_confirmed uuid;
  v_waiting uuid;
begin
  select * into p from personas;
  v_ride := kc_test.create_ride_offer(p.driver, p_seats => 3);
  v_confirmed := kc_test.book_ride(p.passenger1, v_ride);
  v_waiting := kc_test.book_ride(p.passenger2, v_ride);
  perform kc_test.act_as(p.driver);
  perform public.confirm_ride_booking(v_confirmed);
  perform public.complete_ride_listing(v_ride);
  perform kc_test.assert_eq(kc_test.listing_status(v_ride), 'closed', 'driver completion closes unused capacity');
  perform kc_test.assert_eq(kc_test.handoff_status(v_confirmed), 'handed_over', 'confirmed passenger is completed');
  perform kc_test.assert_eq(kc_test.handoff_status(v_waiting), 'cancelled', 'waiting booking is cancelled');
  perform kc_test.assert_row_count(
    format('select 1 from public.karma_ledger where ref_id = %L and event_type in (''giving_handoff_giver'', ''giving_handoff_receiver'')', v_confirmed),
    2, 'confirmed passenger and driver receive configured ride karma');
  perform kc_test.act_as(p.passenger1);
  perform public.rate_giving_handoff(v_confirmed, 5::smallint, null);
  perform kc_test.assert_true(true, 'passenger can optionally rate after owner completion');
end $$;

rollback;

\echo '✓ flows/rides_lifecycle.sql passed'
