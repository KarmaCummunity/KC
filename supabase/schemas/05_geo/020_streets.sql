-- Geo · streets
--
-- Official street list, keyed by city (FR-PROFILE-007 AC1, FR-POST address fields, D-36;
-- an official ride place, D71). Rows are loaded by the reference loader
-- (supabase/seed/reference), never by a client. The source is not filtered (D-36): street code
-- 9000 is the source's "the locality itself" entry and is the only street of many small localities.

create table public.streets (
  city_id   text    not null references public.cities (city_id) on delete cascade,
  -- Official street code. Unique inside its city only, hence the composite key.
  street_id integer not null check (street_id > 0),
  -- The source carries Hebrew names only.
  name_he   text    not null check (btrim(name_he) <> ''),
  -- Street centroid: the approximate location of a post that shows city and street.
  -- Null until a street is geocoded; readers fall back to the city centre.
  location  extensions.geography(Point, 4326),
  -- Also serves the foreign key and "all streets of a city".
  primary key (city_id, street_id)
);
comment on table public.streets is 'Reference list of official streets per city (D-36); optional centroid for street-level approximate locations.';

-- Street picker, after a city is chosen:
--   select street_id, name_he from public.streets
--    where city_id = $1 and name_he ilike '%' || $2 || '%'
--    order by name_he, street_id limit $3;
create index streets_city_name_trgm_idx on public.streets
  using gin (city_id, name_he extensions.gin_trgm_ops);
-- Nearest street to a point (address suggestion from a map pin or the device location).
create index streets_location_gist_idx on public.streets using gist (location);

alter table public.streets enable row level security;
alter table public.streets force row level security;

-- Read-only reference data for signed-in members.
create policy streets_select_member on public.streets
  for select to authenticated
  using (true);

grant select on public.streets to authenticated;
