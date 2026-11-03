-- 0514_ride_schedule_expiry.sql | Estimated end and auto-close of ride offers (G49, D21, S46).

begin;

create temp table personas as
select kc_test.create_user('rs_driver') as driver;

-- 1) An offer expires 30 minutes after its estimated end; without one, after departure.
do $$
declare
  p personas;
  v_ride uuid;
  v_departs timestamptz := date_trunc('minute', now()) + interval '2 hours';
begin
  select * into p from personas;
  v_ride := kc_test.create_listing(p.driver, 'rides', 'ride_offer', 'give', 'Tel Aviv to Jerusalem',
    kc_test.ride_route_tlv_jlm() || jsonb_build_object(
      'departs_at', v_departs, 'arrives_at', v_departs + interval '75 minutes', 'seats_available', 3));
  perform kc_test.assert_eq(
    (select expires_at from public.listings where listing_id = v_ride),
    v_departs + interval '105 minutes', 'an offer closes 30 minutes after its estimated end');

  v_ride := kc_test.create_ride_offer(p.driver, 2, interval '3 hours');
  perform kc_test.assert_true(
    (select expires_at from public.listings where listing_id = v_ride)
      between now() + interval '3 hours 29 minutes' and now() + interval '3 hours 31 minutes',
    'an offer without an estimated end closes 30 minutes after departure');
end $$;

-- 2) The estimated end must come after the departure.
do $$
begin
  perform kc_test.assert_raises(
    format('select kc_test.create_listing(%L, ''rides'', ''ride_offer'', ''give'', ''x'', %L::jsonb)',
      (select driver from personas),
      kc_test.ride_route_tlv_jlm() || jsonb_build_object(
        'departs_at', now() + interval '2 hours', 'arrives_at', now() + interval '1 hour')),
    'ride_arrival_before_departure', 'an estimated end before departure is refused');
end $$;

-- 3) Ride requests are not closed by their departure (D21: requests never expire). The
--    harness gives every listing a default expiry, so check the trigger did not replace it.
do $$
declare
  v_request uuid;
  v_departs timestamptz := date_trunc('minute', now()) + interval '2 hours';
begin
  v_request := kc_test.create_listing((select driver from personas), 'rides', 'ride_request', 'request', 'Need a ride',
    kc_test.ride_route_tlv_jlm() || jsonb_build_object('departs_at', v_departs, 'passengers', 1));
  perform kc_test.assert_true(
    (select expires_at from public.listings where listing_id = v_request) is distinct from v_departs + interval '30 minutes',
    'a ride request keeps its own expiry');
end $$;

-- 4) The sweep closes offers past their expiry and leaves the others open.
do $$
declare
  v_past uuid;
  v_future uuid;
begin
  v_past := kc_test.create_ride_offer((select driver from personas), 2, interval '2 hours');
  v_future := kc_test.create_ride_offer((select driver from personas), 2, interval '2 hours');
  update public.listings set expires_at = now() - interval '1 minute' where listing_id = v_past;

  perform kc_test.act_as_anon();
  perform kc_test.assert_true(public.rides_expired_listings_sweep() >= 1, 'the sweep closes overdue offers');
  perform kc_test.assert_eq(kc_test.listing_status(v_past), 'expired', 'an offer past its expiry is expired');
  perform kc_test.assert_eq(kc_test.listing_status(v_future), 'open', 'a future offer stays open');
end $$;

rollback;

\echo '✓ 0514_ride_schedule_expiry.sql passed'
