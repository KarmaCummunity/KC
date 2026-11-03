-- 0512_ride_places_catalog.sql | Ride places come only from official catalogs (G45, D71, S47):
-- the junctions catalog, the picker list, and the canonical-places guard on every ride write.
-- Names are read from the catalogs (no Hebrew literals outside locale files). Places used:
-- Tel Aviv 5000, Jerusalem 3000, Ramat Gan 8600, Hadera 6500, Dizengoff St. 5000:404,
-- Glilot West interchange (by English name).

begin;

create temp table personas as
select kc_test.create_user('rp_driver') as driver;

-- A ride offer departing in 2 hours with the given route keys.
create function pg_temp.ride_with(p_route jsonb)
returns uuid
language sql
as $$
  select kc_test.create_ride_offer((select driver from personas), 2, interval '2 hours', p_route);
$$;

create function pg_temp.city_name(p_city_id text)
returns text
language sql
as $$
  select name_he from public.cities where city_id = p_city_id;
$$;

create function pg_temp.glilot_west()
returns public.road_junctions
language sql
as $$
  select * from public.road_junctions where name_en = 'Glilot West';
$$;

create function pg_temp.details(p_listing uuid)
returns jsonb
language sql
as $$
  select details from public.listings where listing_id = p_listing;
$$;

-- 1) The catalog holds existing Israeli junctions and interchanges, with WGS84 coordinates.
select kc_test.assert_true((select count(*) from public.road_junctions) >= 400, 'the junctions catalog is seeded');
select kc_test.assert_true(
  not exists (select 1 from public.road_junctions where lat not between 29 and 33.5 or lng not between 34 and 36),
  'every junction lies inside Israel (coordinates converted from the Israeli grid)');

-- 2) The picker list: official cities and every junction, readable by anyone.
do $$
begin
  perform kc_test.act_as_anon();
  perform kc_test.assert_true(
    exists (select 1 from public.list_ride_places()
             where place_kind = 'city' and place_id = '6500' and label = pg_temp.city_name('6500') and lat is not null),
    'cities with coordinates are listed');
  perform kc_test.assert_eq(
    (select count(*) from public.list_ride_places() where place_kind = 'junction'),
    (select count(*) from public.road_junctions), 'every junction is listed');
  perform kc_test.assert_true(
    exists (select 1 from public.list_ride_places()
             where place_kind = 'junction' and place_id = (pg_temp.glilot_west()).junction_id::text
               and label like '% ' || (pg_temp.glilot_west()).name_he),
    'a junction is labelled with its kind, then its name');
  perform kc_test.assert_true(
    not exists (select 1 from public.list_ride_places() where lat is null or lng is null),
    'every listed place can be pinned');
end $$;

-- 3) A junction origin and a street destination are stored with their official names and
--    coordinates, whatever the client sent.
do $$
declare
  v_junction text := (pg_temp.glilot_west()).junction_id::text;
  v_ride uuid;
  v_details jsonb;
begin
  v_ride := pg_temp.ride_with(jsonb_build_object(
    'origin_place_kind', 'junction', 'origin_place_id', v_junction,
    'origin_label', 'my secret spot', 'origin_lat', 0, 'origin_lng', 0,
    'dest_place_kind', 'street', 'dest_place_id', '5000:404'));
  v_details := pg_temp.details(v_ride);

  perform kc_test.assert_true(v_details->>'origin_label' like '% ' || (pg_temp.glilot_west()).name_he,
    'a junction keeps its official name');
  perform kc_test.assert_true((v_details->>'origin_lat')::float8 between 32 and 32.3, 'a junction keeps its own coordinates');
  perform kc_test.assert_true(not v_details ? 'origin_city_id', 'a junction belongs to no city');
  perform kc_test.assert_eq(v_details->>'dest_label',
    (select name_he from public.streets where city_id = '5000' and street_id = 404) || ', ' || pg_temp.city_name('5000'),
    'a street is named with its city');
  perform kc_test.assert_eq(v_details->>'dest_city_id', '5000', 'a street is pinned at its city');
end $$;

-- 4) Free-text or unknown places are refused.
do $$
begin
  perform kc_test.assert_raises(
    $q$select pg_temp.ride_with(jsonb_build_object('origin_label', 'behind the mall', 'origin_lat', 32.1, 'origin_lng', 34.8,
                                                    'dest_place_kind', 'city', 'dest_place_id', '3000'))$q$,
    'ride_place_invalid', 'a free-text origin is refused');
  perform kc_test.assert_raises(
    $q$select pg_temp.ride_with(jsonb_build_object('origin_place_kind', 'junction', 'origin_place_id', '999999',
                                                    'dest_place_kind', 'city', 'dest_place_id', '3000'))$q$,
    'ride_place_invalid', 'an unknown junction is refused');
  perform kc_test.assert_raises(
    $q$select pg_temp.ride_with(jsonb_build_object('origin_place_kind', 'street', 'origin_place_id', '5000:not-a-number',
                                                    'dest_place_kind', 'city', 'dest_place_id', '3000'))$q$,
    'ride_place_invalid', 'a malformed street id is refused');
end $$;

-- 5) Up to three meeting points, each official and canonical; a fourth is refused.
do $$
declare
  v_ride uuid;
  v_points jsonb;
  v_route jsonb := kc_test.ride_route_tlv_jlm();
begin
  v_ride := pg_temp.ride_with(v_route || jsonb_build_object('meeting_points', jsonb_build_array(
    jsonb_build_object('kind', 'city', 'id', '8600', 'label', 'anything'),
    jsonb_build_object('kind', 'street', 'id', '5000:404'))));
  v_points := pg_temp.details(v_ride)->'meeting_points';
  perform kc_test.assert_eq(jsonb_array_length(v_points), 2, 'meeting points are kept in order');
  perform kc_test.assert_eq(v_points->0->>'label', pg_temp.city_name('8600'), 'a meeting point keeps its official name');
  perform kc_test.assert_true((v_points->0->>'lat') is not null, 'a meeting point gets its coordinates');

  perform kc_test.assert_raises(
    format('select pg_temp.ride_with(%L::jsonb)', v_route || jsonb_build_object('meeting_points', jsonb_build_array(
      jsonb_build_object('kind', 'junction', 'id', '0')))),
    'ride_place_invalid', 'an unknown meeting point is refused');
  perform kc_test.assert_raises(
    format('select pg_temp.ride_with(%L::jsonb)', v_route || jsonb_build_object('meeting_points', jsonb_build_array(
      jsonb_build_object('kind', 'city', 'id', '8600'), jsonb_build_object('kind', 'city', 'id', '6300'),
      jsonb_build_object('kind', 'city', 'id', '6100'), jsonb_build_object('kind', 'city', 'id', '4000')))),
    'too_many_meeting_points', 'a fourth meeting point is refused');
end $$;

-- 6) A build from before 0512 sends only city ids; they are official places too.
do $$
declare
  v_details jsonb;
begin
  v_details := pg_temp.details(pg_temp.ride_with(jsonb_build_object(
    'origin_city_id', '5000', 'origin_label', 'Tel Aviv', 'origin_lat', 32.08, 'origin_lng', 34.78,
    'dest_city_id', '4000', 'dest_label', 'Haifa', 'dest_lat', 32.8, 'dest_lng', 34.99)));
  perform kc_test.assert_eq(v_details->>'origin_place_kind', 'city', 'a city id becomes a city place');
  perform kc_test.assert_eq(v_details->>'dest_label', pg_temp.city_name('4000'), 'its label is the official city name');
end $$;

rollback;

\echo '✓ 0512_ride_places_catalog.sql passed'
