-- 0240_marketplace_extensions_and_cities_geo | Issue #823
-- Enable pgvector, PostGIS, pg_trgm, pg_jsonschema (when available).
-- Add geography point on cities (from lat/lon) and nullable geo on streets.

begin;

create extension if not exists vector with schema extensions;
create extension if not exists postgis with schema extensions;
create extension if not exists pg_trgm with schema extensions;

do $jsonschema$
begin
  execute 'create extension if not exists pg_jsonschema with schema extensions';
exception
  when undefined_file then
    raise notice '0238: pg_jsonschema extension not available on this cluster — skipping';
  when insufficient_privilege then
    raise notice '0238: pg_jsonschema install skipped (insufficient privilege)';
end;
$jsonschema$;

-- ── cities.geo (FR-FEED-019 evolution: PostGIS geography) ───────────────────
alter table public.cities
  add column if not exists geo geography(point, 4326);

update public.cities c
   set geo = extensions.st_setsrid(extensions.st_makepoint(c.lon, c.lat), 4326)::geography
 where c.lat is not null
   and c.lon is not null
   and c.geo is null;

create or replace function public.cities_sync_geo_from_latlon()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if new.lat is not null and new.lon is not null then
    new.geo := st_setsrid(st_makepoint(new.lon, new.lat), 4326)::geography;
  else
    new.geo := null;
  end if;
  return new;
end;
$$;

drop trigger if exists cities_sync_geo_from_latlon on public.cities;
create trigger cities_sync_geo_from_latlon
  before insert or update of lat, lon on public.cities
  for each row
  execute function public.cities_sync_geo_from_latlon();

create index if not exists cities_geo_gist_idx
  on public.cities using gist (geo)
  where geo is not null;

comment on column public.cities.geo is
  'WGS84 geography point derived from lat/lon (#823). Maintained by cities_sync_geo_from_latlon.';

-- ── streets.geo (nullable; no bulk backfill — no canonical coordinates yet) ─
alter table public.streets
  add column if not exists geo geography(point, 4326);

create index if not exists streets_geo_gist_idx
  on public.streets using gist (geo)
  where geo is not null;

comment on column public.streets.geo is
  'Optional street-level geography (#823). Nullable until geocoding is available.';

commit;
