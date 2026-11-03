-- 0517_ride_listing_safety.sql | Cost caps and the emergency button on the one rides flow (G44, D70).
-- Places: Tel Aviv 5000, Jerusalem 3000; Dizengoff St. 5000:404 (official, D71).

begin;

create temp table personas as
select kc_test.create_user('rsf_driver') as driver,
       kc_test.create_user('rsf_rider') as rider,
       kc_test.create_user('rsf_stranger') as stranger;

-- A Tel Aviv street → Tel Aviv city ride (urban) and a Tel Aviv → Jerusalem ride (intercity).
create function pg_temp.urban(p_cost numeric, p_extra jsonb default '{}'::jsonb)
returns jsonb language sql as $$
  select jsonb_build_object('origin_place_kind', 'street', 'origin_place_id', '5000:404',
                            'dest_place_kind', 'city', 'dest_place_id', '5000', 'cost_share_ils', p_cost) || p_extra;
$$;

create function pg_temp.offer(p_route jsonb, p_in interval default interval '30 minutes')
returns uuid language sql as $$
  select kc_test.create_ride_offer((select driver from personas), 3, p_in, p_route);
$$;

create function pg_temp.emergencies(p_user uuid, p_listing uuid)
returns bigint language sql as $$
  select count(*) from public.notifications_outbox
   where user_id = p_user and kind = 'ride_listing_emergency' and data->'params'->>'listingId' = p_listing::text
$$;

-- 1) Cost caps: ₪20 inside a city, ₪70 between cities; a forged city id cannot lift the cap.
do $$
begin
  perform pg_temp.offer(pg_temp.urban(20));
  perform kc_test.assert_raises('select pg_temp.offer(pg_temp.urban(21))',
    'ride_cost_share_cap_exceeded', 'an urban ride above ₪20 is refused');
  perform pg_temp.offer(kc_test.ride_route_tlv_jlm() || jsonb_build_object('cost_share_ils', 70));
  perform kc_test.assert_raises(
    format('select pg_temp.offer(%L::jsonb)', kc_test.ride_route_tlv_jlm() || jsonb_build_object('cost_share_ils', 71)),
    'ride_cost_share_cap_exceeded', 'an intercity ride above ₪70 is refused');
  perform kc_test.assert_raises(
    'select pg_temp.offer(pg_temp.urban(50, jsonb_build_object(''origin_city_id'', ''3000'')))',
    'ride_cost_share_cap_exceeded', 'a forged city id does not turn an urban ride intercity');
end $$;

-- 2) Emergency: the driver and an approved passenger, during the ride; others are told.
do $$
declare
  p personas;
  v_ride uuid;
  v_booking uuid;
begin
  select * into p from personas;
  v_ride := pg_temp.offer(kc_test.ride_route_tlv_jlm(), interval '30 minutes');
  v_booking := kc_test.book_ride(p.rider, v_ride);

  -- A waiting passenger is not on the ride yet.
  perform kc_test.assert_raises(format('select public.ride_listing_emergency(%L)', v_ride),
    'not_participant', 'a passenger who is not approved cannot raise an emergency');

  perform kc_test.act_as(p.driver);
  perform public.confirm_ride_booking(v_booking);

  perform kc_test.act_as(p.rider);
  perform public.ride_listing_emergency(v_ride, 'flat tyre');
  perform kc_test.assert_eq(pg_temp.emergencies(p.driver, v_ride), 1::bigint, 'the driver is alerted');
  perform kc_test.assert_eq(pg_temp.emergencies(p.rider, v_ride), 0::bigint, 'the passenger is not alerted to their own call');
  perform kc_test.assert_raises(format('select public.ride_listing_emergency(%L)', v_ride),
    'emergency_throttled', 'a second call within 5 minutes is throttled');

  perform kc_test.act_as(p.stranger);
  perform kc_test.assert_raises(format('select public.ride_listing_emergency(%L)', v_ride),
    'not_participant', 'someone not on the ride cannot raise an emergency');
end $$;

-- 3) Outside the active window the button does nothing.
do $$
declare
  v_ride uuid := pg_temp.offer(kc_test.ride_route_tlv_jlm(), interval '5 hours');
begin
  perform kc_test.act_as((select driver from personas));
  perform kc_test.assert_raises(format('select public.ride_listing_emergency(%L)', v_ride),
    'ride_not_active', 'a ride hours before departure is not active');
end $$;

rollback;

\echo '✓ 0517_ride_listing_safety.sql passed'
