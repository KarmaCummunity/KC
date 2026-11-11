-- supabase/tests/0743_ride_cancel_notifies_passengers.sql
-- FR-RIDE-047: a driver may pause or delete a ride that has bookings; before departure each seat
-- is cancelled (`host_cancelled`) and its passenger told once (`ride_booking_withdrawn`). A seat
-- the driver cancels on its own keeps its own push, and a completed trip still blocks a delete.
-- Runs in a rolled-back transaction.

begin;

update public.matching_settings set quiet_start = '00:00', quiet_end = '00:00';

create temp table personas as
select kc_test.create_user('rcn_driver')  as driver,
       kc_test.create_user('rcn_rider_a') as rider_a,
       kc_test.create_user('rcn_rider_b') as rider_b;

create function pg_temp.withdrawn(p_user uuid) returns bigint
language sql as $$
  select count(*) from public.notifications_outbox where user_id = p_user and kind = 'ride_booking_withdrawn'
$$;

-- ── 1. Pausing a booked ride cancels its seats and tells each passenger ─────────
do $$
declare
  p personas;
  v_ride uuid;
  v_a uuid;
  v_b uuid;
begin
  select * into p from personas;
  v_ride := kc_test.create_ride_offer(p.driver, 3, interval '1 day');
  v_a := kc_test.book_ride(p.rider_a, v_ride, 1);
  v_b := kc_test.book_ride(p.rider_b, v_ride, 1);
  perform kc_test.act_as(p.driver);
  perform public.confirm_ride_booking(v_a);

  perform public.pause_my_listing(v_ride);
  perform kc_test.assert_eq(
    (select count(*) from public.post_handoffs
      where handoff_id in (v_a, v_b) and status = 'cancelled' and cancel_reason = 'host_cancelled'),
    2::bigint, 'a requested and a confirmed seat are both cancelled by the driver');
  perform kc_test.assert_eq(pg_temp.withdrawn(p.rider_a), 1::bigint, 'the confirmed passenger is told');
  perform kc_test.assert_eq(pg_temp.withdrawn(p.rider_b), 1::bigint, 'the requesting passenger is told');
end $$;

-- ── 2. Deleting a booked ride tells the passenger before the row goes ───────────
do $$
declare
  p personas;
  v_ride uuid;
begin
  select * into p from personas;
  v_ride := kc_test.create_ride_offer(p.driver, 2, interval '2 days');
  perform kc_test.book_ride(p.rider_a, v_ride, 1);
  perform kc_test.act_as(p.driver);
  perform public.delete_my_listing(v_ride);
  perform kc_test.assert_eq(pg_temp.withdrawn(p.rider_a), 2::bigint, 'the passenger is told of the deleted ride');
  perform kc_test.assert_true(
    not exists (select 1 from public.posts where post_id = public.post_id_of_listing(v_ride)),
    'the ride is gone');
end $$;

-- ── 3. A single seat the driver cancels keeps its own push ──────────────────────
do $$
declare
  p personas;
  v_ride uuid;
  v_seat uuid;
begin
  select * into p from personas;
  v_ride := kc_test.create_ride_offer(p.driver, 2, interval '3 days');
  v_seat := kc_test.book_ride(p.rider_b, v_ride, 1);
  perform kc_test.act_as(p.driver);
  perform public.cancel_ride_booking(v_seat);
  perform kc_test.assert_eq(
    (select cancel_reason from public.post_handoffs where handoff_id = v_seat),
    'driver_cancelled', 'one seat cancelled by the driver stays driver_cancelled');
  perform kc_test.assert_eq(pg_temp.withdrawn(p.rider_b), 1::bigint,
    'and does not send the whole-ride push');
end $$;

-- ── 4. After departure a pause cancels nothing ─────────────────────────────────
do $$
declare
  p personas;
  v_ride uuid;
  v_seat uuid;
begin
  select * into p from personas;
  v_ride := kc_test.create_ride_offer(p.driver, 2, interval '1 day');
  v_seat := kc_test.book_ride(p.rider_a, v_ride, 1);
  -- The ride has left: the trip or the expiry sweep settles the seat (0734).
  update public.ride_post_details set departs_at = now() - interval '10 minutes'
   where post_id = public.post_id_of_listing(v_ride);
  perform kc_test.assert_eq(kc_private.ride_cancel_open_bookings(public.post_id_of_listing(v_ride)), 0,
    'a departed ride''s seats are not cancelled');
  perform kc_test.assert_true(
    (select status <> 'cancelled' from public.post_handoffs where handoff_id = v_seat),
    'the seat stays as it was');
end $$;

rollback;
