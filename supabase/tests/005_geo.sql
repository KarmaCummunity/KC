-- Geo: cities, streets and road junctions are read-only reference data for members, the
-- spatial and name indexes answer the picker queries, and the place search is bounded.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Runs one statement as an API role and returns the number of rows it returned or changed.
create function pg_temp.rows_as(p_role text, p_user_id uuid, p_sql text)
returns bigint
language plpgsql
as $$
declare
  v_rows bigint;
begin
  perform set_config(
    'request.jwt.claims', jsonb_build_object('sub', p_user_id, 'role', p_role)::text, true);
  perform set_config('role', p_role, true);
  execute p_sql;
  get diagnostics v_rows = row_count;
  perform set_config('role', 'none', true);
  return v_rows;
end;
$$;

-- A WGS84 point from longitude / latitude.
create function pg_temp.point(p_lng double precision, p_lat double precision)
returns extensions.geography
language sql
as $$
  select extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography;
$$;

select plan(51);

insert into auth.users (id, email, raw_app_meta_data) values
  ('00000000-0000-4000-8000-00000000000a', 'alice@example.test', '{"provider":"google"}');

-- Hebrew fixtures are written as escapes: \05D4\05E8\05E6\05DC is "Herzl", \05D2\05E0\05D9\05DD "Ganim".
-- T1 lies on the coast, T2 about 55 km inland, T3 has no known centre.
insert into public.cities (city_id, name_he, name_en, location) values
  ('T1', U&'\05D2\05E0\05D9\05DD \05DE\05E2\05E8\05D1', 'Ganim West', pg_temp.point(34.78, 32.08)),
  ('T2', U&'\05D2\05E0\05D9\05DD \05DE\05D6\05E8\05D7', 'Ganim East', pg_temp.point(35.21, 31.77)),
  ('T3', U&'\05D2\05E0\05D9\05DD \05E6\05E4\05D5\05DF', 'Ganim North', null);
insert into public.streets (city_id, street_id, name_he, location) values
  ('T1', 101, U&'\05D4\05E8\05E6\05DC', pg_temp.point(34.781, 32.081)),
  ('T1', 102, U&'\05E9\05D3\05E8\05D5\05EA \05D4\05E8\05E6\05DC', null),
  ('T1', 103, U&'\05D4\05D2\05E4\05DF', null),
  ('T2', 101, U&'\05D4\05E8\05E6\05DC', null);
insert into public.road_junctions (junction_id, kind, name_he, name_en, roads, location) values
  (9001, 'junction', U&'\05D2\05E0\05D9\05DD', 'Ganim', '4/5', pg_temp.point(34.90, 32.10)),
  (9002, 'interchange', U&'\05D4\05D2\05E4\05DF', 'HaGefen', '1', pg_temp.point(35.00, 31.80));

-- ── Read access ─────────────────────────────────────────────────────────────
select is(pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000a', 'select 1 from public.cities'),
  3::bigint, 'a member reads the city list');
select is(pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000a', 'select 1 from public.streets'),
  4::bigint, 'a member reads the street list');
select is(pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000a', 'select 1 from public.road_junctions'),
  2::bigint, 'a member reads the junction list');
select throws_ok(
         format('select pg_temp.rows_as(''anon'', null, %L)', t.stmt),
         '42501', null, 'a signed-out caller cannot ' || t.what)
  from (values
    ('select 1 from public.streets', 'read streets'),
    ('select 1 from public.road_junctions', 'read junctions'),
    ($$select 1 from public.search_places('ganim')$$, 'search places')) as t(stmt, what);

-- ── Nobody writes reference data from a device ──────────────────────────────
select throws_ok(
         format('select pg_temp.rows_as(''authenticated'', ''00000000-0000-4000-8000-00000000000a'', %L)', t.stmt),
         '42501', null, 'a member cannot ' || t.what)
  from (values
    ($$insert into public.cities (city_id, name_he, name_en) values ('T9', 'x', 'x')$$, 'insert a city'),
    ($$update public.cities set name_en = 'x'$$, 'update a city'),
    ('delete from public.cities', 'delete a city'),
    ($$insert into public.streets (city_id, street_id, name_he) values ('T1', 999, 'x')$$, 'insert a street'),
    ($$update public.streets set name_he = 'x'$$, 'update a street'),
    ('delete from public.streets', 'delete a street'),
    ($$insert into public.road_junctions (junction_id, kind, name_he, location)
       select 9999, 'junction', 'x', location from public.road_junctions limit 1$$, 'insert a junction'),
    ($$update public.road_junctions set name_he = 'x'$$, 'update a junction'),
    ('delete from public.road_junctions', 'delete a junction')) as t(stmt, what);

-- Row level security alone would also refuse these; the grant layer must refuse them first.
select ok(
         not has_table_privilege('authenticated', t, 'insert, update, delete, truncate')
           and not has_table_privilege('anon', t, 'select, insert, update, delete, truncate'),
         format('%s: members hold select only, signed-out callers hold nothing', t))
  from unnest(array['public.cities', 'public.streets', 'public.road_junctions']) as t;

-- ── Integrity ───────────────────────────────────────────────────────────────
select throws_ok(
  $$insert into public.streets (city_id, street_id, name_he) values ('NOPE', 1, 'x')$$,
  '23503', null, 'a street must belong to a known city');
select throws_ok(
  $$insert into public.streets (city_id, street_id, name_he) values ('T1', 101, 'x')$$,
  '23505', null, 'a street code is unique inside its city');
select lives_ok(
  $$insert into public.streets (city_id, street_id, name_he) values ('T3', 101, 'x')$$,
  'the same street code may exist in another city');
select throws_ok(
  $$insert into public.streets (city_id, street_id, name_he) values ('T1', 0, 'x')$$,
  '23514', null, 'a street code is positive');
select throws_ok(
  $$insert into public.streets (city_id, street_id, name_he) values ('T1', 500, '  ')$$,
  '23514', null, 'a street has a name');
select throws_ok(
  $$insert into public.road_junctions (junction_id, kind, name_he, location)
    values (9003, 'roundabout', 'x', pg_temp.point(35, 32))$$,
  '23514', null, 'a junction kind outside the vocabulary is rejected');
select throws_ok(
  $$insert into public.road_junctions (junction_id, kind, name_he) values (9003, 'junction', 'x')$$,
  '23502', null, 'a junction always has a location');
select throws_ok(
  $$insert into public.road_junctions (junction_id, kind, name_he, location)
    values (9003, 'junction', 'x', 'SRID=4326;LINESTRING(35 32, 35 33)')$$,
  '22023', null, 'a location is a point');

-- ── Spatial queries ─────────────────────────────────────────────────────────
select results_eq(
  $$select city_id from public.cities where location is not null
     order by location <-> pg_temp.point(34.80, 32.07) limit 1$$,
  $$values ('T1')$$, 'nearest city to a point');
select results_eq(
  $$select city_id from public.cities
     where st_dwithin(location, pg_temp.point(35.20, 31.78), 10000) order by city_id$$,
  $$values ('T2')$$, 'cities inside a 10 km radius');
select results_eq(
  $$select city_id from public.cities
     where st_dwithin(location, pg_temp.point(35.00, 31.90), 60000) order by city_id$$,
  $$values ('T1'), ('T2')$$, 'a wider radius finds both, never the city without a centre');
select results_eq(
  $$select junction_id from public.road_junctions order by location <-> pg_temp.point(34.99, 31.81) limit 1$$,
  $$values (9002)$$, 'nearest junction to a point');
select results_eq(
  $$select city_id, street_id from public.streets where location is not null
     order by location <-> pg_temp.point(34.78, 32.08) limit 1$$,
  $$values ('T1', 101)$$, 'nearest street with a centroid');

-- ── Street picker ───────────────────────────────────────────────────────────
select results_eq(
  $$select street_id from public.streets
     where city_id = 'T1' and name_he ilike '%' || U&'\05E8\05E6\05DC' || '%'
     order by name_he, street_id limit 20$$,
  $$values (101), (102)$$, 'the street picker matches a substring inside the chosen city only');
select is(pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000a',
    $$select 1 from public.streets where city_id = 'T2' and name_he ilike '%' || U&'\05D4\05D2\05E4\05DF' || '%'$$),
  0::bigint, 'a street of another city is not offered');

-- ── Place search ────────────────────────────────────────────────────────────
select results_eq(
  $$select place_kind, place_id from public.search_places(U&'\05D2\05E0\05D9\05DD')$$,
  $$values ('junction', '9001'), ('city', 'T2'), ('city', 'T1')$$,
  'the search spans cities and junctions, ordered by name, and skips a city without a centre');
select results_eq(
  $$select place_kind, place_id, junction_kind from public.search_places(U&'\05D2\05E4\05DF', array['junction'])$$,
  $$values ('junction', '9002', 'interchange')$$, 'the search can be limited to one kind and tells an interchange apart');
select results_eq(
  $$select place_id from public.search_places('  WEST ', array['city'])$$,
  $$values ('T1')$$, 'English names match regardless of case and surrounding spaces');
select results_eq(
  $$select place_id from public.search_places('east')
    union all select place_id from public.search_places('gefen')$$,
  $$values ('T2'), ('9002')$$, 'a match in the middle of a name is found');
select results_eq(
  $$select place_id from public.search_places('ganim e')$$,
  $$values ('T2')$$, 'names starting with the query come first');
select results_eq(
  $$select round(lat::numeric, 2), round(lng::numeric, 2), city_id, roads
      from public.search_places('ganim west')$$,
  $$values (32.08, 34.78, 'T1', null::text)$$, 'a city is returned with its centre as latitude / longitude');
select results_eq(
  $$select city_id, roads from public.search_places('ganim', array['junction'])$$,
  $$values (null::text, '4/5')$$, 'a junction belongs to no city and carries its roads');
select is((select count(*) from public.search_places('ganim', array['city', 'junction'], 2)),
  2::bigint, 'the result is capped at the requested limit');
select is((select count(*) from public.search_places('%')) + (select count(*) from public.search_places('_')),
  0::bigint, 'pattern characters in the query are matched literally');
select is(pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000a',
    $$select 1 from public.search_places('ganim')$$),
  3::bigint, 'a member can search places');

select throws_ok(format('select * from public.search_places(%s)', t.args), '22023', t.message, t.what)
  from (values
    ($$'   '$$, 'place_query_invalid', 'an empty query is rejected'),
    ('null', 'place_query_invalid', 'a missing query is rejected'),
    ($$repeat('a', 81)$$, 'place_query_invalid', 'an over-long query is rejected'),
    ($$'ganim', array['city', 'street']$$, 'place_kinds_invalid', 'an unknown place kind is rejected'),
    ($$'ganim', array[]::text[]$$, 'place_kinds_invalid', 'an empty kind list is rejected'),
    ($$'ganim', array['city'], 0$$, 'place_limit_invalid', 'a non-positive limit is rejected'),
    ($$'ganim', array['city'], 51$$, 'place_limit_invalid', 'a limit above the cap is rejected')) as t(args, message, what);

-- ── Removing a city removes its streets ─────────────────────────────────────
delete from public.cities where city_id = 'T1';
select is((select count(*) from public.streets where city_id = 'T1'), 0::bigint,
  'streets go with their city');

select * from finish();
rollback;
