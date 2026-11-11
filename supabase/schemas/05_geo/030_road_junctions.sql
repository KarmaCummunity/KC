-- Geo · road junctions and interchanges
--
-- Named junctions and interchanges of the national road network. With cities and streets they
-- are the official places a ride may use for its origin, destination and meeting points (D71);
-- the catalog and its source were approved in D98. Rows are loaded by the reference loader
-- (supabase/seed/reference), never by a client, and never fetched from the source at runtime.

create table public.road_junctions (
  -- The source's place number; stable across refreshes of the catalog.
  junction_id integer primary key,
  kind        text not null check (kind in ('junction', 'interchange')),
  name_he     text not null check (btrim(name_he) <> ''),
  name_en     text,
  name_ar     text,
  -- The roads that meet there, as the source writes them (for example '2/5').
  roads       text,
  location    extensions.geography(Point, 4326) not null
);
comment on table public.road_junctions is 'Reference list of named road junctions and interchanges: official ride places (D71, D98).';

-- Junctions near a point: meeting-point suggestions and the ride map.
create index road_junctions_location_gist_idx on public.road_junctions using gist (location);
-- Place search by name (public.search_places): substring match on either name.
create index road_junctions_name_he_trgm_idx on public.road_junctions
  using gin (name_he extensions.gin_trgm_ops);
create index road_junctions_name_en_trgm_idx on public.road_junctions
  using gin (lower(name_en) extensions.gin_trgm_ops);

alter table public.road_junctions enable row level security;
alter table public.road_junctions force row level security;

-- Read-only reference data for signed-in members.
create policy road_junctions_select_member on public.road_junctions
  for select to authenticated
  using (true);

grant select on public.road_junctions to authenticated;
