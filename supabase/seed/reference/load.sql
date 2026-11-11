-- Reference data loader: cities, streets, road junctions, giving-world catalog, feature flags
-- (see README.md).
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

create temporary table ref_worlds (
  slug text, label_he text, label_en text, sensitivity text, requires_verification boolean,
  geo_mode text, shows_in_main_feed boolean, sort_order integer
) on commit drop;
create temporary table ref_post_kinds (
  world_slug text, slug text, label_he text, label_en text, direction text, sort_order integer
) on commit drop;
create temporary table ref_item_subcategories (
  world_slug text, slug text, label_he text, label_en text, sort_order integer
) on commit drop;
create temporary table ref_app_flags (key text, enabled boolean, description text) on commit drop;

\copy ref_cities from 'data/cities.csv' with (format csv, header true)
\copy ref_streets from 'data/streets.csv' with (format csv, header true)
\copy ref_road_junctions from 'data/road_junctions.csv' with (format csv, header true)
\copy ref_worlds from 'data/worlds.csv' with (format csv, header true)
\copy ref_post_kinds from 'data/post_kinds.csv' with (format csv, header true)
\copy ref_item_subcategories from 'data/item_subcategories.csv' with (format csv, header true)
\copy ref_app_flags from 'data/app_flags.csv' with (format csv, header true)

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

-- 4. Giving-world catalog (worlds, then kinds and subcategories that reference them). Labels
--    and ordering follow the file; is_active, detail schemas and TTLs are operational settings
--    that a reviewed migration or the super admin owns, so a re-run never resets them.
with changed as (
  insert into public.worlds as w (slug, label_he, label_en, sensitivity, requires_verification,
                                  geo_mode, shows_in_main_feed, sort_order)
  select slug, label_he, label_en, sensitivity, requires_verification, geo_mode,
         shows_in_main_feed, sort_order
    from ref_worlds
  on conflict (slug) do update
     set label_he = excluded.label_he, label_en = excluded.label_en, sort_order = excluded.sort_order
   where (w.label_he, w.label_en, w.sort_order)
           is distinct from (excluded.label_he, excluded.label_en, excluded.sort_order)
  returning 1
)
select 'worlds' as reference_table, (select count(*) from ref_worlds) as rows_in_file,
       (select count(*) from changed) as rows_changed;

with changed as (
  insert into public.post_kinds as k (world_slug, slug, label_he, label_en, direction, sort_order)
  select world_slug, slug, label_he, label_en, direction, sort_order from ref_post_kinds
  on conflict (world_slug, slug) do update
     set label_he = excluded.label_he, label_en = excluded.label_en, sort_order = excluded.sort_order
   where (k.label_he, k.label_en, k.sort_order)
           is distinct from (excluded.label_he, excluded.label_en, excluded.sort_order)
  returning 1
)
select 'post_kinds' as reference_table, (select count(*) from ref_post_kinds) as rows_in_file,
       (select count(*) from changed) as rows_changed;

with changed as (
  insert into public.item_subcategories as c (world_slug, slug, label_he, label_en, sort_order)
  select world_slug, slug, label_he, label_en, sort_order from ref_item_subcategories
  on conflict (world_slug, slug) do update
     set label_he = excluded.label_he, label_en = excluded.label_en, sort_order = excluded.sort_order
   where (c.label_he, c.label_en, c.sort_order)
           is distinct from (excluded.label_he, excluded.label_en, excluded.sort_order)
  returning 1
)
select 'item_subcategories' as reference_table, (select count(*) from ref_item_subcategories) as rows_in_file,
       (select count(*) from changed) as rows_changed;

-- 5. Feature flags: only the missing ones are created. The enabled state belongs to the super
--    admin from then on, so an existing flag is never switched back by a re-run.
with changed as (
  insert into public.app_flags (key, enabled, description)
  select key, enabled, description from ref_app_flags
  on conflict (key) do nothing
  returning 1
)
select 'app_flags' as reference_table, (select count(*) from ref_app_flags) as rows_in_file,
       (select count(*) from changed) as rows_changed;

-- Totals in the database after the load.
select (select count(*) from public.cities) as cities,
       (select count(*) from public.streets) as streets,
       (select count(*) from public.road_junctions) as road_junctions,
       (select count(*) from public.worlds) as worlds;

-- Fresh statistics for the planner after a bulk load.
analyze public.cities;
analyze public.streets;
analyze public.road_junctions;
