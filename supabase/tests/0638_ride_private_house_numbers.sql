-- 0638_ride_private_house_numbers.sql | FR-RIDE-003 AC9: private house numbers on a ride's
-- street ends — only the driver writes them; the driver and approved passengers read them.

begin;

create temp table personas as
select kc_test.create_user('hn_driver')    as driver,
       kc_test.create_user('hn_approved')  as approved,
       kc_test.create_user('hn_waiting')   as waiting,
       kc_test.create_user('hn_stranger')  as stranger;

create temp table rides as
select kc_test.create_ride_offer(
         (select driver from personas),
         p_route => kc_test.ride_route_tlv_jlm() || jsonb_build_object(
           'origin_place_kind', 'street',
           'origin_place_id', '5000:' || (select street_id from public.streets where city_id = '5000' limit 1)))
         as street_ride,
       kc_test.create_ride_offer((select driver from personas)) as city_ride;

do $$
declare
  p personas;
  r rides;
  v_ok uuid;
  v_wait uuid;
begin
  select * into p from personas;
  select * into r from rides;
  v_ok := kc_test.book_ride(p.approved, r.street_ride);
  v_wait := kc_test.book_ride(p.waiting, r.street_ride);

  -- Writes: owner only, street ends only, a sane number only.
  perform kc_test.act_as(p.stranger);
  perform kc_test.assert_raises(format('select public.set_ride_house_numbers(%L, %L)', r.street_ride, '12'),
    'owner_only', 'a stranger cannot set house numbers');

  perform kc_test.act_as(p.driver);
  perform kc_test.assert_raises(format('select public.set_ride_house_numbers(%L, %L)', r.city_ride, '12'),
    'ride_house_number_not_street', 'a city origin has no house number');
  perform kc_test.assert_raises(format('select public.set_ride_house_numbers(%L, %L)', r.street_ride, '12; drop'),
    'ride_house_number_invalid', 'free text is refused');
  perform public.set_ride_house_numbers(r.street_ride, ' 12א ');
  perform public.confirm_ride_booking(v_ok);

  -- Reads: the driver and the approved passenger; the waiting passenger and strangers get nothing.
  perform kc_test.assert_eq(
    (select house_number from public.get_ride_house_numbers(r.street_ride) where place_end = 'origin'), '12א',
    'the driver reads the trimmed number');

  perform kc_test.act_as(p.approved);
  perform kc_test.assert_row_count(format('select 1 from public.get_ride_house_numbers(%L)', r.street_ride), 1,
    'an approved passenger reads the number');

  perform kc_test.act_as(p.waiting);
  perform kc_test.assert_row_count(format('select 1 from public.get_ride_house_numbers(%L)', r.street_ride), 0,
    'a passenger still waiting for approval reads nothing');

  perform kc_test.act_as(p.stranger);
  perform kc_test.assert_row_count(format('select 1 from public.get_ride_house_numbers(%L)', r.street_ride), 0,
    'a stranger reads nothing');
  perform kc_test.assert_true(
    not has_table_privilege('authenticated', 'public.ride_listing_house_numbers', 'select')
    and not has_table_privilege('anon', 'public.ride_listing_house_numbers', 'select'),
    'the table itself is closed');

  -- Clearing: a blank number removes the row.
  perform kc_test.act_as(p.driver);
  perform public.set_ride_house_numbers(r.street_ride, '');
  perform kc_test.assert_row_count(format('select 1 from public.get_ride_house_numbers(%L)', r.street_ride), 0,
    'a blank number clears it');
end $$;

rollback;

\echo '✓ 0638_ride_private_house_numbers.sql passed'
