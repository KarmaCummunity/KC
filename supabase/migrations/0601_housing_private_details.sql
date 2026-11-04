-- 0601_housing_private_details | Housing H1, part 2: the exact place of a stay offer is
-- private (D30, R-Housing-3; spec docs/SSOT/spec/21_housing.md FR-HOUSING-012, fill S-
-- housing-location-reveal in docs/spec/91).
--
--   1. `housing_private_details`: official street + house number, entrance notes, access
--      instructions and the true map point, one row per stay offer.
--   2. Public location = city + a stable fuzzed point 300–700 m from the true one. A housing
--      listing never keeps the exact point a client may send on create: the insert trigger
--      resets it to the city centre, and setting the private details moves it to the fuzzed
--      point.
--   3. Who may read the private details (`can_view_housing_private_details`): the owner, or a
--      guest whose booking on that offer is confirmed or completed, from the confirmation
--      until 24 h after the end of the stay. No other path returns them.
--   4. RPCs: `set_housing_private_details` (owner) and `get_housing_private_details`.

begin;

-- ── 1. Private details ───────────────────────────────────────────────────────
create table if not exists public.housing_private_details (
  listing_id           uuid primary key references public.listings(listing_id) on delete cascade,
  city_id              text not null references public.cities(city_id),
  street_id            integer not null,
  house_number         text not null check (char_length(house_number) between 1 and 10),
  apartment            text check (apartment is null or char_length(apartment) <= 10),
  floor                text check (floor is null or char_length(floor) <= 10),
  entrance_notes       text check (entrance_notes is null or char_length(entrance_notes) <= 300),
  access_instructions  text check (access_instructions is null or char_length(access_instructions) <= 500),
  true_geo             extensions.geography(point, 4326),
  updated_at           timestamptz not null default now(),
  -- Official places only (D71): the street comes from the streets catalog of the listing's city.
  constraint housing_private_details_street_fk
    foreign key (city_id, street_id) references public.streets(city_id, street_id)
);

comment on table public.housing_private_details is
  'Exact place of a housing offer; readable only per can_view_housing_private_details (FR-HOUSING-012). 0601.';

alter table public.housing_private_details enable row level security;

-- The host reads their own row. Guests read only through get_housing_private_details (the
-- reveal window); every write goes through set_housing_private_details.
create policy housing_private_details_owner_read on public.housing_private_details
  for select to authenticated
  using (exists (
    select 1 from public.listings l
     where l.listing_id = housing_private_details.listing_id and l.owner_id = (select auth.uid())
  ));

-- ── 2. Public point ──────────────────────────────────────────────────────────
-- A stable point 300–700 m from p_true in a direction derived from the listing id: the same
-- listing always gets the same point (no averaging attack over repeated reads) and the offset
-- cannot be recomputed without the true point.
create or replace function public.housing_fuzzed_point(p_listing_id uuid, p_true extensions.geography)
returns extensions.geography
language sql
immutable
set search_path = public, extensions
as $$
  select extensions.st_project(
    p_true,
    300 + (('x' || substr(md5(p_listing_id::text), 1, 8))::bit(32)::bigint % 401),
    radians((('x' || substr(md5(p_listing_id::text), 9, 8))::bit(32)::bigint % 360)::double precision)
  )::extensions.geography;
$$;

-- On insert a housing listing gets the city centre, never a client-sent exact point.
create or replace function public.listings_housing_public_point()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.world_slug = 'housing' and new.origin = 'native' then
    new.geo := case when new.city_id is null then null else public.listing_geo_from_city(new.city_id) end;
  end if;
  return new;
end;
$$;

drop trigger if exists listings_world_housing_public_point on public.listings;
create trigger listings_world_housing_public_point
  before insert on public.listings
  for each row execute function public.listings_housing_public_point();

-- ── 3. Who may read the exact place ──────────────────────────────────────────
create or replace function public.can_view_housing_private_details(p_listing_id uuid, p_viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_viewer is not null and (
    exists (select 1 from public.listings l
             where l.listing_id = p_listing_id and l.owner_id = p_viewer)
    or exists (
      select 1 from public.giving_handoffs h
       where h.listing_id = p_listing_id
         and h.world_slug = 'housing'
         and h.recipient_id = p_viewer
         and h.status in ('confirmed', 'handed_over')
         and now() < coalesce(h.slot_ends_at, h.confirmed_at) + interval '24 hours'
    )
  );
$$;

-- ── 4. RPCs ──────────────────────────────────────────────────────────────────
create or replace function public.set_housing_private_details(
  p_listing_id uuid,
  p_street_id integer,
  p_house_number text,
  p_apartment text default null,
  p_floor text default null,
  p_entrance_notes text default null,
  p_access_instructions text default null,
  p_lat double precision default null,
  p_lng double precision default null
)
returns public.housing_private_details
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_listing public.listings;
  v_true extensions.geography;
  v_row public.housing_private_details;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  select l.* into v_listing
    from public.listings l
    join public.listing_kinds k on k.kind_id = l.kind_id
   where l.listing_id = p_listing_id and l.world_slug = 'housing' and k.slug = 'host_offer'
   for update of l;
  if not found then raise exception 'listing_not_available' using errcode = 'P0002'; end if;
  if v_listing.owner_id <> v_uid then raise exception 'owner_only' using errcode = '42501'; end if;
  if v_listing.city_id is null then raise exception 'housing_city_required' using errcode = '23514'; end if;

  if p_lat is not null and p_lng is not null then
    v_true := extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography;
  end if;

  insert into public.housing_private_details as d (
    listing_id, city_id, street_id, house_number, apartment, floor,
    entrance_notes, access_instructions, true_geo, updated_at
  ) values (
    p_listing_id, v_listing.city_id, p_street_id, btrim(p_house_number), nullif(btrim(p_apartment), ''),
    nullif(btrim(p_floor), ''), nullif(btrim(p_entrance_notes), ''), nullif(btrim(p_access_instructions), ''),
    v_true, now()
  )
  on conflict (listing_id) do update
    set city_id = excluded.city_id, street_id = excluded.street_id,
        house_number = excluded.house_number, apartment = excluded.apartment, floor = excluded.floor,
        entrance_notes = excluded.entrance_notes, access_instructions = excluded.access_instructions,
        true_geo = excluded.true_geo, updated_at = now()
  returning * into v_row;

  -- The public map point moves to the fuzzed point of the true location, or stays at the city.
  update public.listings
     set geo = coalesce(public.housing_fuzzed_point(p_listing_id, v_true),
                        public.listing_geo_from_city(v_listing.city_id))
   where listing_id = p_listing_id;

  return v_row;
end;
$$;

-- Returns the exact place, or raises `housing_private_details_hidden` for anyone not allowed.
create or replace function public.get_housing_private_details(p_listing_id uuid)
returns table (
  listing_id           uuid,
  city_id              text,
  street_name          text,
  house_number         text,
  apartment            text,
  floor                text,
  entrance_notes       text,
  access_instructions  text,
  lat                  double precision,
  lng                  double precision
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  if auth.uid() is null then raise exception 'auth_required' using errcode = '42501'; end if;
  if not public.can_view_housing_private_details(p_listing_id, auth.uid()) then
    raise exception 'housing_private_details_hidden' using errcode = '42501';
  end if;
  return query
    select d.listing_id, d.city_id, s.name_he, d.house_number, d.apartment, d.floor,
           d.entrance_notes, d.access_instructions,
           extensions.st_y(d.true_geo::extensions.geometry), extensions.st_x(d.true_geo::extensions.geometry)
      from public.housing_private_details d
      join public.streets s on s.city_id = d.city_id and s.street_id = d.street_id
     where d.listing_id = p_listing_id;
end;
$$;

-- ── Grants (0520) ────────────────────────────────────────────────────────────
revoke all on function public.housing_fuzzed_point(uuid, extensions.geography) from public;
revoke all on function public.listings_housing_public_point() from public, anon, authenticated;
revoke all on function public.can_view_housing_private_details(uuid, uuid) from public;
revoke all on function public.set_housing_private_details(uuid, integer, text, text, text, text, text, double precision, double precision) from public;
revoke all on function public.get_housing_private_details(uuid) from public;

grant execute on function public.housing_fuzzed_point(uuid, extensions.geography) to service_role;
grant execute on function public.can_view_housing_private_details(uuid, uuid) to service_role;
grant execute on function public.set_housing_private_details(uuid, integer, text, text, text, text, text, double precision, double precision) to authenticated;
grant execute on function public.get_housing_private_details(uuid) to authenticated;

commit;
