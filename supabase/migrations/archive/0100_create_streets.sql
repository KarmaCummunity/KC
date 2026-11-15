-- 0100_create_streets | Canonical Israeli street list, keyed by city.
-- Sourced from data.gov.il package 321 (resource 9ad3862c-8391-4b2f-84a4-2d4c68625f4b).
-- Seeded in 0101_seed_streets.sql.
--
-- Notes:
--   * (city_id, street_id) is the natural key — street_id is unique per city,
--     not globally. No surrogate id column.
--   * No name_en column: the source dataset has no English street names.
--   * RLS mirrors public.cities — public read for anon + authenticated; writes
--     happen only via the service role (migrations).
--   * Code 9000 in street_id is the source's "the village itself" sentinel —
--     kept verbatim; for 486 small settlements it is the only canonical entry.
--   * `on delete cascade` because a city deletion (extremely rare) should drop
--     its dependent street rows; orphaned streets serve no purpose.

create table public.streets (
  city_id   text     not null references public.cities(city_id) on delete cascade,
  street_id integer  not null,
  name_he   text     not null,
  primary key (city_id, street_id)
);

create index streets_city_name_idx on public.streets (city_id, name_he);

alter table public.streets enable row level security;

create policy "streets_public_read"
  on public.streets
  for select
  to anon, authenticated
  using (true);

comment on table public.streets is
  'Canonical Israeli streets keyed by (city_id, street_id). Sourced from data.gov.il package 321. Code 9000 = "the village itself" sentinel (kept verbatim).';
