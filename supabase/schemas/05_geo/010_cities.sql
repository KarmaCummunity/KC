-- Geo · cities
--
-- Reference list of localities. Rows are loaded by the seed scripts, never by a client.
-- Every city reference in the product is a foreign key to this table, so a city is never
-- stored as free text.

create table public.cities (
  -- Official locality code (stable across name changes).
  city_id      text primary key,
  name_he      text not null,
  name_en      text not null,
  country_code text not null default 'IL' check (country_code ~ '^[A-Z]{2}$'),
  -- City centre. Also the approximate location of a post that shows its city only.
  location     extensions.geography(Point, 4326)
);
comment on table public.cities is 'Reference list of localities; city centre doubles as the city-level approximate location.';

-- Radius and nearest-city queries.
create index cities_location_gist_idx on public.cities using gist (location);
-- City picker autocomplete: substring match on either name.
create index cities_name_he_trgm_idx on public.cities using gin (name_he extensions.gin_trgm_ops);
create index cities_name_en_trgm_idx on public.cities using gin (lower(name_en) extensions.gin_trgm_ops);

alter table public.cities enable row level security;
alter table public.cities force row level security;

-- Read-only reference data for signed-in members.
create policy cities_select_member on public.cities
  for select to authenticated
  using (true);

grant select on public.cities to authenticated;
