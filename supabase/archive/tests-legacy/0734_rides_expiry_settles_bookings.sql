-- supabase/tests/0734_rides_expiry_settles_bookings.sql
-- FR-RIDE: a ride that expires without leaving cancels its live bookings: an unanswered request
-- lapses (`ride_booking_expired`), a confirmed seat tells the passenger the ride did not run
-- (`ride_booking_lapsed`). Runs in a rolled-back transaction.

begin;

create temp table personas as
select kc_test.create_user('rexp_driver') as driver,
       kc_test.create_user('rexp_rider_a') as rider_a,
       kc_test.create_user('rexp_rider_b') as rider_b;

do $$
declare
  p personas;
  v_listing uuid;
  v_post uuid;
  v_confirmed uuid;
  v_request uuid;
begin
  select * into p from personas;
  v_listing := kc_test.create_ride_offer(p.driver, p_seats => 3);
  v_post := public.post_id_of_listing(v_listing);
  v_confirmed := kc_test.book_ride(p.rider_a, v_listing, 1);
  v_request := kc_test.book_ride(p.rider_b, v_listing, 1);
  perform kc_test.act_as(p.driver);
  perform public.confirm_ride_booking(v_confirmed);

  -- The ride never set off and its expiry passed.
  update public.posts set expires_at = now() - interval '1 minute' where post_id = v_post;

  -- The sweep runs as pg_cron does, with no caller (self-suppression keys off auth.uid()).
  perform kc_test.act_as_anon();
  perform kc_test.assert_true(public.rides_expired_listings_sweep() >= 1, 'the ride is swept');

  perform kc_test.assert_eq((select status from public.posts where post_id = v_post), 'expired',
    'the ride post expired');
  perform kc_test.assert_eq(
    (select status || ':' || cancel_reason from public.post_handoffs where handoff_id = v_confirmed),
    'cancelled:system', 'the confirmed seat is cancelled by the system');
  perform kc_test.assert_eq(
    (select status || ':' || cancel_reason from public.post_handoffs where handoff_id = v_request),
    'cancelled:expired', 'the unanswered request lapsed');
  perform kc_test.assert_eq(
    (select count(*) from public.notifications_outbox where user_id = p.rider_a and kind = 'ride_booking_lapsed'),
    1::bigint, 'the confirmed passenger hears the ride did not run');
  perform kc_test.assert_eq(
    (select count(*) from public.notifications_outbox where user_id = p.rider_b and kind = 'ride_booking_expired'),
    1::bigint, 'the waiting passenger hears the request lapsed');
end $$;

rollback;
