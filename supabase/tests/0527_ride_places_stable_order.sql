-- supabase/tests/0527_ride_places_stable_order.sql
-- Regression for migration 0527 (#1411): the ride place catalog is complete and in a total
-- order, so reading it in pages yields every place exactly once.
--
--   1. The catalog has every city with coordinates and every junction.
--   2. Two cities sharing a label stay in a fixed order (kind, then id) across reads.
--   3. Pages of 1000 (PostgREST's max_rows) concatenate to the whole catalog, no duplicates.
--   4. Clients keep EXECUTE (anon for guests browsing rides, authenticated).
-- Runs in a rolled-back transaction.

begin;

select kc_test.assert_eq(
  (select count(*) from public.list_ride_places()),
  (select count(*) from public.cities where lat is not null and lon is not null)
    + (select count(*) from public.road_junctions),
  'the catalog has every located city and every junction');

-- Two places with the same label: the order between them must not depend on the plan.
insert into public.cities (city_id, name_he, name_en, lat, lon)
values ('kc_test_a', 'zz kc test place', 'zz test a', 31.9, 34.9),
       ('kc_test_b', 'zz kc test place', 'zz test b', 31.9, 34.9);

select kc_test.assert_eq(
  (select string_agg(place_id, ',' order by ord)
     from (select place_id, row_number() over () as ord
             from public.list_ride_places() where label = 'zz kc test place') q),
  'kc_test_a,kc_test_b',
  'places that share a label are ordered by kind, then id');

with pages as (
  select p.*
    from generate_series(0, (select count(*) from public.list_ride_places()) / 1000) as page(n)
   cross join lateral (
     select place_kind, place_id from public.list_ride_places() offset page.n * 1000 limit 1000
   ) p
)
select kc_test.assert_eq(
  (select count(distinct (place_kind, place_id)) from pages)::bigint,
  (select count(*) from public.list_ride_places()),
  'pages of 1000 cover the whole catalog, each place once');

select kc_test.assert_true(
  has_function_privilege('anon', 'public.list_ride_places()', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.list_ride_places()', 'EXECUTE'),
  'guests and members can read the catalog');

rollback;

\echo '✓ 0527 ride place catalog order regression test passed'
