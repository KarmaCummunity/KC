-- 0021_cities_geo | P1.2 — Geo coordinates for cities + Haversine helper
-- FR-FEED-006 (distance-based sort), FR-FEED-019 (cities_geo as source of truth)
--
-- Adds latitude/longitude to the existing `cities` reference table and seeds
-- the 20 canonical Israeli cities. Posts already reference cities via the FK
-- `posts.city -> cities.city_id`, so every post inherits coordinates through
-- the join. Adding columns to the existing table avoids data duplication.

alter table public.cities
  add column if not exists lat double precision
    check (lat is null or lat between 29.0 and 34.0),
  add column if not exists lon double precision
    check (lon is null or lon between 34.0 and 36.5);

-- Seed coordinates for the 20 cities introduced in migration 0001.
-- Source: open public data (Wikipedia coordinates for each settlement).
update public.cities set lat = 32.0853, lon = 34.7818 where city_id = 'tel-aviv';
update public.cities set lat = 31.7683, lon = 35.2137 where city_id = 'jerusalem';
update public.cities set lat = 32.7940, lon = 34.9896 where city_id = 'haifa';
update public.cities set lat = 31.9647, lon = 34.8044 where city_id = 'rishon';
update public.cities set lat = 32.0922, lon = 34.8878 where city_id = 'petah-tikva';
update public.cities set lat = 31.7918, lon = 34.6497 where city_id = 'ashdod';
update public.cities set lat = 32.3215, lon = 34.8532 where city_id = 'netanya';
update public.cities set lat = 31.2518, lon = 34.7913 where city_id = 'beer-sheva';
update public.cities set lat = 32.0808, lon = 34.8328 where city_id = 'bnei-brak';
update public.cities set lat = 32.0167, lon = 34.7795 where city_id = 'holon';
update public.cities set lat = 32.0823, lon = 34.8141 where city_id = 'ramat-gan';
update public.cities set lat = 31.6688, lon = 34.5742 where city_id = 'ashkelon';
update public.cities set lat = 31.8928, lon = 34.8113 where city_id = 'rehovot';
update public.cities set lat = 32.0167, lon = 34.7500 where city_id = 'bat-yam';
update public.cities set lat = 32.1664, lon = 34.8434 where city_id = 'herzliya';
update public.cities set lat = 32.1750, lon = 34.9067 where city_id = 'kfar-saba';
update public.cities set lat = 32.4365, lon = 34.9196 where city_id = 'hadera';
update public.cities set lat = 31.8969, lon = 35.0103 where city_id = 'modiin';
update public.cities set lat = 32.7022, lon = 35.2978 where city_id = 'nazareth';
update public.cities set lat = 32.1849, lon = 34.8714 where city_id = 'raanana';

-- Make lat/lon non-null going forward. Future migrations adding cities MUST
-- include coordinates. We keep the columns nullable in shape so existing
-- writes don't fail; the application layer treats null lat/lon as "unknown
-- location" and degrades sort=distance to sort=newest (FR-FEED-006 AC3).
-- (Not enforcing NOT NULL avoids breaking future test inserts that don't
-- care about distance.)

create index if not exists cities_latlon_idx
  on public.cities (lat, lon)
  where lat is not null and lon is not null;

-- ── Haversine helper ────────────────────────────────────────────────────────
-- Pure SQL function returning great-circle distance in kilometres between
-- two coordinates. Returns NULL if any input is NULL.

create or replace function public.haversine_km(
  lat1 double precision,
  lon1 double precision,
  lat2 double precision,
  lon2 double precision
)
returns double precision
language sql
immutable
parallel safe
as $$
  select case
    when lat1 is null or lon1 is null or lat2 is null or lon2 is null then null
    else 6371.0 * 2.0 * asin(
      sqrt(
        power(sin(radians((lat2 - lat1) / 2.0)), 2)
        + cos(radians(lat1)) * cos(radians(lat2))
          * power(sin(radians((lon2 - lon1) / 2.0)), 2)
      )
    )
  end;
$$;

grant execute on function public.haversine_km(double precision, double precision, double precision, double precision)
  to anon, authenticated;
