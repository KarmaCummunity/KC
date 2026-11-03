-- 0527_ride_places_stable_order | #1411 the ride place picker gets the whole catalog
--
-- `list_ride_places` (0512) returns every city and junction, more rows than PostgREST
-- serves in one response (`max_rows`, 1000), so the app read only the first page and
-- the rest of the catalog was missing from the picker. The app now reads it page by page
-- (`Range`); a page boundary is only stable when the order is total, so the label sort
-- gets a tiebreak on the place's kind and id (a city and a junction can share a label).
-- Same signature, rows and grants as 0512; only the order changes.

begin;

create or replace function public.list_ride_places()
returns table (
  place_kind text,
  place_id   text,
  label      text,
  city_id    text,
  lat        double precision,
  lng        double precision
)
language sql
stable
set search_path = public
as $$
  select 'city'::text, c.city_id, c.name_he, c.city_id, c.lat, c.lon
    from public.cities c
   where c.lat is not null and c.lon is not null
  union all
  select 'junction', j.junction_id::text,
         (case j.kind when 'interchange' then 'מחלף ' else 'צומת ' end) || j.name_he,
         null, j.lat, j.lng
    from public.road_junctions j
  order by 3, 1, 2;
$$;

comment on function public.list_ride_places() is
  'Cities and junctions/interchanges a ride place can be picked from (D71), in a total order (label, kind, id) so the app can page through it.';

commit;
