-- 0515_rides_feed.sql | Rides feed: offers + requests by departure, departed hidden, free seats (G49, D75).

begin;

create temp table personas as
select kc_test.create_user('rf_driver') as driver,
       kc_test.create_user('rf_rider') as rider;

do $$
declare
  p personas;
  v_later uuid;
  v_sooner uuid;
  v_request uuid;
  v_departed uuid;
begin
  select * into p from personas;
  v_later := kc_test.create_ride_offer(p.driver, 3, interval '5 hours');
  v_sooner := kc_test.create_ride_offer(p.driver, 3, interval '1 hour');
  v_request := kc_test.create_listing(p.rider, 'rides', 'ride_request', 'request', 'Need a ride',
    kc_test.ride_route_tlv_jlm() || jsonb_build_object('departs_at', kc_test.iso_in(interval '3 hours'), 'passengers', 2));
  v_departed := kc_test.create_ride_offer(p.driver, 3, interval '2 hours');
  update public.listings
     set details = details || jsonb_build_object('departs_at', kc_test.iso_in(-interval '10 minutes'))
   where listing_id = v_departed;
  perform kc_test.book_ride(p.rider, v_sooner, 2);

  perform kc_test.act_as_anon();
  perform kc_test.assert_eq(
    (select array_agg(f.listing_id order by f.departs_at)::text from public.list_rides_feed(50) f
      where f.listing_id in (v_later, v_sooner, v_request, v_departed)),
    array[v_sooner, v_request, v_later]::text, 'offers and requests together, soonest first, departed hidden');
  perform kc_test.assert_eq(
    (select seats_left from public.list_rides_feed(50) where listing_id = v_sooner), 1,
    'an offer shows the seats still free');
  perform kc_test.assert_eq(
    (select passengers from public.list_rides_feed(50) where listing_id = v_request), 2,
    'a request shows its passengers');
  perform kc_test.assert_eq(
    (select origin_label from public.list_rides_feed(50) where listing_id = v_later),
    (select name_he from public.cities where city_id = '5000'), 'the official origin name is shown');
end $$;

-- A closed ride leaves the feed.
do $$
declare
  v_ride uuid := kc_test.create_ride_offer((select driver from personas), 2, interval '4 hours');
begin
  update public.listings set status = 'closed' where listing_id = v_ride;
  perform kc_test.act_as_anon();
  perform kc_test.assert_row_count(format('select 1 from public.list_rides_feed(200) where listing_id = %L', v_ride), 0,
    'a closed ride is not in the feed');
end $$;

rollback;

\echo '✓ 0515_rides_feed.sql passed'
