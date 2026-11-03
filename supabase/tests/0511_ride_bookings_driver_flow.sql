-- 0511_ride_bookings_driver_flow.sql | Driver booking management contract (G47, D73, S44, S45):
-- approval deadline, the driver's bookings list, decline, expiry and one notification to the
-- other side for every booking change.

begin;

create temp table personas as
select kc_test.create_user('rb_driver')     as driver,
       kc_test.create_user('rb_passenger1') as passenger1,
       kc_test.create_user('rb_passenger2') as passenger2;

-- Notifications of one kind queued for one user about one booking.
create function pg_temp.notified(p_user uuid, p_kind text, p_handoff uuid)
returns bigint
language sql
as $$
  select count(*) from public.notifications_outbox
   where user_id = p_user and kind = p_kind and dedupe_key = p_kind || ':' || p_handoff::text
$$;

-- 1) Booking: approval deadline is the departure when it comes before 12 hours; the
--    driver is notified; the driver sees every booking, nobody else can list them.
do $$
declare
  p personas;
  v_ride uuid;
  v_first uuid;
  v_second uuid;
begin
  select * into p from personas;
  v_ride := kc_test.create_ride_offer(p.driver, p_seats => 3, p_departs_in => interval '2 hours');
  v_first := kc_test.book_ride(p.passenger1, v_ride);
  v_second := kc_test.book_ride(p.passenger2, v_ride, 2);

  perform kc_test.assert_true(
    (select confirm_by from public.giving_handoffs where handoff_id = v_first)
      <= now() + interval '2 hours' + interval '1 minute',
    'a booking must be approved before departure when departure comes first');
  perform kc_test.assert_eq(pg_temp.notified(p.driver, 'ride_booking_requested', v_first), 1::bigint,
    'the driver is notified of a new booking');

  perform kc_test.act_as(p.driver);
  perform kc_test.assert_row_count(format('select 1 from public.list_ride_bookings(%L)', v_ride), 2,
    'the driver sees every booking on the ride');
  perform kc_test.assert_eq(
    (select passenger_name from public.list_ride_bookings(v_ride) where handoff_id = v_second),
    'Test rb_passenger2', 'each booking shows the passenger');
  perform kc_test.assert_eq(
    (select rated_by_me from public.list_ride_bookings(v_ride) where handoff_id = v_second), false,
    'a booking the driver has not rated is marked unrated');

  perform kc_test.act_as(p.passenger1);
  perform kc_test.assert_raises(format('select * from public.list_ride_bookings(%L)', v_ride),
    'owner_only', 'a passenger cannot list the ride''s bookings');
end $$;

-- 2) Driver approves one and declines the other; each passenger hears about it; only the
--    driver may decline and only a waiting booking.
do $$
declare
  p personas;
  v_ride uuid;
  v_first uuid;
  v_second uuid;
begin
  select * into p from personas;
  v_ride := kc_test.create_ride_offer(p.driver, p_seats => 3);
  v_first := kc_test.book_ride(p.passenger1, v_ride);
  v_second := kc_test.book_ride(p.passenger2, v_ride);

  perform kc_test.assert_raises(format('select public.decline_ride_booking(%L)', v_second),
    'owner_only', 'a passenger cannot decline a booking');

  perform kc_test.act_as(p.driver);
  perform public.confirm_ride_booking(v_first);
  perform public.decline_ride_booking(v_second);

  perform kc_test.assert_eq(pg_temp.notified(p.passenger1, 'ride_booking_confirmed', v_first), 1::bigint,
    'an approved passenger is notified');
  perform kc_test.assert_eq(
    (select cancel_reason from public.giving_handoffs where handoff_id = v_second), 'declined',
    'a declined booking records why it ended');
  perform kc_test.assert_eq(pg_temp.notified(p.passenger2, 'ride_booking_declined', v_second), 1::bigint,
    'a declined passenger is notified');
  perform kc_test.assert_raises(format('select public.decline_ride_booking(%L)', v_first),
    'invalid_status', 'an approved booking cannot be declined');
end $$;

-- 3) A passenger who cancels: the reason is filled from the caller and the driver is told.
do $$
declare
  p personas;
  v_ride uuid;
  v_booking uuid;
begin
  select * into p from personas;
  v_ride := kc_test.create_ride_offer(p.driver, p_seats => 1);
  v_booking := kc_test.book_ride(p.passenger1, v_ride);
  perform public.cancel_ride_booking(v_booking);

  perform kc_test.assert_eq(
    (select cancel_reason from public.giving_handoffs where handoff_id = v_booking), 'passenger_cancelled',
    'a passenger''s own cancel is recorded as theirs');
  perform kc_test.assert_eq(pg_temp.notified(p.driver, 'ride_booking_cancelled', v_booking), 1::bigint,
    'the driver hears that a passenger cancelled');
end $$;

-- 4) A booking left waiting past its deadline expires, frees its seat and tells the passenger.
do $$
declare
  p personas;
  v_ride uuid;
  v_booking uuid;
begin
  select * into p from personas;
  v_ride := kc_test.create_ride_offer(p.driver, p_seats => 1);
  v_booking := kc_test.book_ride(p.passenger1, v_ride);
  update public.giving_handoffs set confirm_by = now() - interval '1 minute' where handoff_id = v_booking;

  perform kc_test.act_as_anon();
  perform kc_test.assert_true(public.ride_bookings_expire_sweep() >= 1, 'the sweep expires overdue bookings');
  perform kc_test.assert_eq(kc_test.handoff_status(v_booking), 'cancelled', 'an overdue booking is cancelled');
  perform kc_test.assert_eq(
    (select cancel_reason from public.giving_handoffs where handoff_id = v_booking), 'expired',
    'an overdue booking records that it expired');
  perform kc_test.assert_eq(pg_temp.notified(p.passenger1, 'ride_booking_expired', v_booking), 1::bigint,
    'the passenger hears the booking expired');
  -- Separate statement: a stable lookup does not see a row inserted by the same statement.
  v_booking := kc_test.book_ride(p.passenger2, v_ride);
  perform kc_test.assert_eq(kc_test.handoff_status(v_booking), 'reserved', 'the expired seat can be booked again');
end $$;

-- 5) The rides world is active.
select kc_test.assert_eq(
  (select enabled from public.app_flags where key = 'world_rides_enabled'), true, 'the rides world is on');

rollback;

\echo '✓ 0511_ride_bookings_driver_flow.sql passed'
