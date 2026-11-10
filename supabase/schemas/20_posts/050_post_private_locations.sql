-- Posts · exact address and the approximate location shown to others (design §3.9)
--
-- The exact point of a post lives only in `post_private_locations`, readable by its owner.
-- Everyone else — feed, map, distance search, matching — reads `posts.geo_approx`, which is
-- derived here and can never be written directly. Releasing the exact address to the
-- counterparty of a confirmed handoff is an audited RPC of the handoffs module.

create table public.post_private_locations (
  post_id       uuid primary key references public.posts (id) on delete cascade,
  -- Geocoded position of the address; null until the address has been resolved.
  exact_point   extensions.geography(Point, 4326),
  street        text check (char_length(btrim(street)) between 1 and 80),
  -- Digits with an optional entrance letter, Latin or Hebrew (U+05D0–U+05EA).
  street_number text check (street_number ~ '^[0-9]+[A-Za-z\u05D0-\u05EA]?$'),
  -- Rides only: house number at the destination, when the ride ends on a street; the pickup
  -- end uses street_number (FR-RIDE-003 AC9).
  destination_street_number text check (destination_street_number ~ '^[0-9]+[A-Za-z\u05D0-\u05EA]?$'),
  -- Free text for the person arriving: floor, entrance code, where to leave things.
  access_notes  text check (char_length(access_notes) <= 300),
  updated_at    timestamptz not null default now(),
  -- A house number only makes sense with a street.
  constraint post_private_locations_number_needs_street_chk
    check (street_number is null or street is not null)
);
comment on table public.post_private_locations is 'Exact address of a post. Readable and writable by the post owner only.';

create trigger post_private_locations_set_updated_at
  before update on public.post_private_locations
  for each row execute function kc_private.set_updated_at();

-- Approximate location of a post for the given display level.
--   CityOnly        the city centre
--   CityAndStreet   the city centre for now; the geo-reference module, which brings the
--                   street list, replaces this branch with the street centroid
--   FullAddress     the exact point snapped to a grid of 0.003° (about 300 m), then moved by
--                   an offset of up to half a cell that is fixed per post. The offset is
--                   taken from a hash of the post id, so it never changes between
--                   derivations, and any exact point inside the same cell yields the same
--                   result. Without an exact point the city centre is used.
create function kc_private.post_geo_approx(
  p_post_id uuid,
  p_city_id text,
  p_display_level text,
  p_exact_point extensions.geography
)
returns extensions.geography
language sql
stable
set search_path = ''
as $$
  with cell as (select 0.003::double precision as size),
       hash as (select md5(p_post_id::text) as hex)
  select case
    when p_display_level = 'FullAddress' and p_exact_point is not null then
      extensions.st_translate(
        extensions.st_snaptogrid(p_exact_point::extensions.geometry, cell.size),
        -- Two independent values in [-0.5, 0.5) of a cell, from separate parts of the hash.
        (('x' || substr(hash.hex, 1, 8))::bit(32)::bigint / 4294967296.0 - 0.5) * cell.size,
        (('x' || substr(hash.hex, 9, 8))::bit(32)::bigint / 4294967296.0 - 0.5) * cell.size
      )::extensions.geography
    else (select c.location from public.cities c where c.city_id = p_city_id)
  end
  from cell, hash;
$$;
comment on function kc_private.post_geo_approx(uuid, text, text, extensions.geography) is
  'Approximate public location of a post: city centre, or the exact point coarsened to about 300 m.';

-- Keeps posts.geo_approx derived on every write that could change it. On insert the private
-- location does not exist yet, so the post starts at the city centre and is refined by the
-- trigger on post_private_locations below. Definer rights: the derivation is internal.
create function kc_private.posts_set_geo_approx()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.geo_approx := kc_private.post_geo_approx(
    new.id, new.city_id, new.location_display_level,
    (select l.exact_point from public.post_private_locations l where l.post_id = new.id));
  return new;
end;
$$;

-- `geo_approx` is in the column list so that a server-side write to it is overwritten too.
create trigger posts_set_geo_approx
  before insert or update of city_id, location_display_level, geo_approx on public.posts
  for each row execute function kc_private.posts_set_geo_approx();

-- Re-derives the post's approximate location when its exact point is set, moved or removed.
-- Definer rights: the owner has no UPDATE privilege on posts.geo_approx.
create function kc_private.post_private_locations_refresh_geo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post_id constant uuid := case tg_op when 'DELETE' then old.post_id else new.post_id end;
begin
  -- Writing the column fires posts_set_geo_approx, which computes the value.
  update public.posts p set geo_approx = null where p.id = v_post_id;
  return null;
end;
$$;

create trigger post_private_locations_refresh_geo
  after insert or delete or update of exact_point on public.post_private_locations
  for each row execute function kc_private.post_private_locations_refresh_geo();

alter table public.post_private_locations enable row level security;
alter table public.post_private_locations force row level security;

-- Every policy asks the same question: is the caller the owner of the post? The subquery
-- runs under the caller's access to `posts` and is a primary-key lookup.
create policy post_private_locations_select_owner on public.post_private_locations
  for select to authenticated
  using (exists (select 1 from public.posts p
                  where p.id = post_private_locations.post_id and p.owner_id = (select auth.uid())));

create policy post_private_locations_insert_owner on public.post_private_locations
  for insert to authenticated
  with check (exists (select 1 from public.posts p
                       where p.id = post_private_locations.post_id and p.owner_id = (select auth.uid())));

-- The address is editable exactly while the post's content is (draft, open, paused; D104).
create policy post_private_locations_update_owner on public.post_private_locations
  for update to authenticated
  using (exists (select 1 from public.posts p
                  where p.id = post_private_locations.post_id and p.owner_id = (select auth.uid())
                    and p.status in ('draft', 'open', 'paused')))
  with check (exists (select 1 from public.posts p
                       where p.id = post_private_locations.post_id and p.owner_id = (select auth.uid())));

grant select on public.post_private_locations to authenticated;
grant insert (post_id, exact_point, street, street_number, destination_street_number, access_notes)
  on public.post_private_locations to authenticated;
-- The row cannot be moved to another post.
grant update (exact_point, street, street_number, destination_street_number, access_notes)
  on public.post_private_locations to authenticated;
