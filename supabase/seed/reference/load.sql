-- Reference data loader: cities, streets, road junctions (see README.md).
--
-- Idempotent: every row is inserted, or updated only when it differs from the file, so a
-- second run reports zero changes. Rows that are no longer in a file are left in place
-- (members, posts and rides may reference them); retiring a place is a reviewed migration.
-- Run through load.sh, which starts psql in this directory (the \copy paths are relative)
-- and wraps the whole file in one transaction.

create temporary table ref_cities (
  city_id text, name_he text, name_en text, lat double precision, lng double precision
) on commit drop;
create temporary table ref_streets (
  city_id text, street_id integer, name_he text
) on commit drop;
create temporary table ref_road_junctions (
  junction_id integer, kind text, name_he text, name_en text, name_ar text, roads text,
  lat double precision, lng double precision
) on commit drop;

\copy ref_cities from 'data/cities.csv' with (format csv, header true)
\copy ref_streets from 'data/streets.csv' with (format csv, header true)
\copy ref_road_junctions from 'data/road_junctions.csv' with (format csv, header true)

-- 1. Cities. The centre is built from the file's latitude / longitude; a city the sources
--    have no coordinates for keeps a null centre.
with changed as (
  insert into public.cities as c (city_id, name_he, name_en, location)
  select r.city_id, r.name_he, r.name_en,
         extensions.st_setsrid(extensions.st_makepoint(r.lng, r.lat), 4326)::extensions.geography
    from ref_cities r
  on conflict (city_id) do update
     set name_he = excluded.name_he, name_en = excluded.name_en, location = excluded.location
   where (c.name_he, c.name_en) is distinct from (excluded.name_he, excluded.name_en)
      or extensions.st_astext(c.location) is distinct from extensions.st_astext(excluded.location)
  returning 1
)
select 'cities' as reference_table, (select count(*) from ref_cities) as rows_in_file,
       (select count(*) from changed) as rows_changed;

-- 2. Streets (after cities: foreign key). The file carries no coordinates, so a centroid
--    that was set by other means is never touched.
with changed as (
  insert into public.streets as s (city_id, street_id, name_he)
  select r.city_id, r.street_id, r.name_he from ref_streets r
  on conflict (city_id, street_id) do update
     set name_he = excluded.name_he
   where s.name_he is distinct from excluded.name_he
  returning 1
)
select 'streets' as reference_table, (select count(*) from ref_streets) as rows_in_file,
       (select count(*) from changed) as rows_changed;

-- 3. Road junctions. The point is built from the file's latitude / longitude.
with changed as (
  insert into public.road_junctions as j (junction_id, kind, name_he, name_en, name_ar, roads, location)
  select r.junction_id, r.kind, r.name_he, r.name_en, r.name_ar, r.roads,
         extensions.st_setsrid(extensions.st_makepoint(r.lng, r.lat), 4326)::extensions.geography
    from ref_road_junctions r
  on conflict (junction_id) do update
     set kind = excluded.kind, name_he = excluded.name_he, name_en = excluded.name_en,
         name_ar = excluded.name_ar, roads = excluded.roads, location = excluded.location
   where (j.kind, j.name_he, j.name_en, j.name_ar, j.roads)
           is distinct from (excluded.kind, excluded.name_he, excluded.name_en, excluded.name_ar, excluded.roads)
      or extensions.st_astext(j.location) is distinct from extensions.st_astext(excluded.location)
  returning 1
)
select 'road_junctions' as reference_table, (select count(*) from ref_road_junctions) as rows_in_file,
       (select count(*) from changed) as rows_changed;

-- Totals in the database after the load.
select (select count(*) from public.cities) as cities,
       (select count(*) from public.streets) as streets,
       (select count(*) from public.road_junctions) as road_junctions;

-- Fresh statistics for the planner after a bulk load.
analyze public.cities;
analyze public.streets;
analyze public.road_junctions;
