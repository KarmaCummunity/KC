-- App Store 5.1.1(v) / KC #2728: guests (role anon, no account) can see the map and member profiles read-only.
-- Product decision (Nave, 25.11): guests see Feed, posts, map and profiles; every write still needs an account.
--
-- One eligibility rule for every guest read: kc_access.guest_open_posts is the guest_posts predicate
-- (open, Public, published, unexpired, active owner/world/kind, known city). guest_posts is redefined on
-- top of it with no change in behaviour, and the new RPCs below read only through it, so the three
-- guest surfaces cannot drift apart. The view is not granted to anyone: anon has no usage on kc_access
-- and only these SECURITY DEFINER functions read it.
--
-- Existing tables, member RPCs and their RLS/grants remain unchanged. EXECUTE goes to anon only.

create view kc_access.guest_open_posts as
  select p.id, p.owner_id, p.title, p.description, p.world_slug, p.direction,
         p.item_subcategory_id, p.geo_approx, p.published_at, c.name_he as city_name_he, c.name_en as city_name_en
    from public.posts p
    join public.users u on u.id = p.owner_id and u.is_active
    join public.worlds w on w.slug = p.world_slug and w.is_active
    join public.post_kinds k on k.id = p.kind_id and k.world_slug = p.world_slug and k.is_active
    join public.cities c on c.city_id = p.city_id
   where p.status = 'open' and p.visibility = 'Public'
     and p.published_at is not null
     and (p.expires_at is null or p.expires_at > now());
revoke all on kc_access.guest_open_posts from public, anon, authenticated;
comment on view kc_access.guest_open_posts is
  'The single guest eligibility rule (D186 / #2728): open Public published unexpired posts of active owners, worlds and kinds. Read only by guest_* SECURITY DEFINER RPCs.';

create or replace function public.guest_posts(
  p_post_id uuid default null,
  p_before_id uuid default null,
  p_limit integer default 20
)
returns table (id uuid, title text, description text, city_name_he text, city_name_en text)
language sql
stable
security definer
set search_path = ''
as $$
  select g.id, g.title, g.description, g.city_name_he, g.city_name_en
    from kc_access.guest_open_posts g
   where (p_post_id is null or g.id = p_post_id)
     and (p_before_id is null or g.id < p_before_id)
   order by g.id desc
   limit least(greatest(coalesce(p_limit, 20), 1), 20);
$$;

-- Guest location: posts.geo_approx is already public-grade (the city centre, or the exact point coarsened
-- to ~300 m with a per-post jitter; kc_private.post_geo_approx). For guests it is snapped once more to a
-- fixed 0.01 degree grid (about 1.1 km north-south, ~0.95 km east-west in Israel), deterministically, so
-- a guest never gets the stored coordinate and repeated calls cannot be averaged. To change the guest
-- precision (e.g. city centre only), change only this function.
create function kc_access.guest_point(p_geo extensions.geography)
returns table (lat double precision, lng double precision)
language sql
immutable
set search_path = ''
as $$
  select round(extensions.st_y(p_geo::extensions.geometry)::numeric, 2)::double precision,
         round(extensions.st_x(p_geo::extensions.geometry)::numeric, 2)::double precision;
$$;
revoke all on function kc_access.guest_point(extensions.geography) from public, anon, authenticated;

-- Guest map pins: the shape of map_post_pins (same p_bounds / p_filters jsonb, validated by
-- kc_access.map_args), so the app can swap the call. At most 200 pins per call, newest first; the
-- bounding box uses posts_geo_approx_gist_idx (partial on status = 'open').
create function public.guest_map_post_pins(
  p_bounds jsonb,
  p_filters jsonb default '{}'::jsonb,
  p_limit integer default 100
)
returns table (post_id uuid, lat double precision, lng double precision, world_slug text, direction text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_a record;
begin
  select * into v_a from kc_access.map_args(p_bounds, p_filters);
  return query
  select g.id, pt.lat, pt.lng, g.world_slug, g.direction
    from (select g.id, g.world_slug, g.direction, g.geo_approx, g.published_at
            from kc_access.guest_open_posts g
           where extensions.st_intersects(
                   g.geo_approx,
                   extensions.st_makeenvelope(v_a.west, v_a.south, v_a.east, v_a.north, 4326)::extensions.geography)
             and (v_a.world is null or g.world_slug = v_a.world)
             and (v_a.direction is null or g.direction = v_a.direction)
             and (v_a.subcategory_ids is null or g.item_subcategory_id = any (v_a.subcategory_ids))
           order by g.published_at desc, g.id desc
           limit least(greatest(coalesce(p_limit, 100), 1), 200)) g
    cross join lateral kc_access.guest_point(g.geo_approx) pt
   order by g.published_at desc, g.id desc;
end;
$$;
revoke all on function public.guest_map_post_pins(jsonb, jsonb, integer) from public;
grant execute on function public.guest_map_post_pins(jsonb, jsonb, integer) to anon;
comment on function public.guest_map_post_pins(jsonb, jsonb, integer) is
  'Guest read-only map pins (App Store 5.1.1(v), #2728): guest_posts eligibility, coordinates snapped to 0.01 degree (never exact). Max 200.';

-- Guest profile: public fields of an active member with a Public profile, by share handle. No member id,
-- contact, settings, language or account state. Private, inactive (suspended, banned, pending deletion)
-- or unknown handles return no row.
create function public.guest_profile(p_share_handle text)
returns table (
  share_handle text, display_name text, avatar_url text, biography text,
  city_name_he text, city_name_en text, verification_level smallint,
  followers_count integer, following_count integer,
  items_given_count integer, items_received_count integer, open_posts_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select u.share_handle, u.display_name, u.avatar_url, u.biography,
         c.name_he, c.name_en, u.verification_level,
         coalesce(s.followers_count, 0), coalesce(s.following_count, 0),
         coalesce(s.items_given_count, 0), coalesce(s.items_received_count, 0),
         (select count(*)::integer from kc_access.guest_open_posts g where g.owner_id = u.id)
    from public.users u
    left join public.cities c on c.city_id = u.city_id
    left join public.user_stats s on s.user_id = u.id
   where u.share_handle = lower(p_share_handle)
     and u.is_active and u.privacy_mode = 'Public';
$$;
revoke all on function public.guest_profile(text) from public;
grant execute on function public.guest_profile(text) to anon;
comment on function public.guest_profile(text) is
  'Guest read-only public profile by share handle (App Store 5.1.1(v), #2728). Active Public profiles only; no member id or contact.';

-- That member's open Public posts, in the guest_posts row shape and keyset cursor (before-id), 20 per page.
-- Same visibility as guest_profile: nothing for a private or inactive member.
create function public.guest_profile_posts(
  p_share_handle text,
  p_before_id uuid default null,
  p_limit integer default 20
)
returns table (id uuid, title text, description text, city_name_he text, city_name_en text)
language sql
stable
security definer
set search_path = ''
as $$
  select g.id, g.title, g.description, g.city_name_he, g.city_name_en
    from public.users u
    join kc_access.guest_open_posts g on g.owner_id = u.id
   where u.share_handle = lower(p_share_handle)
     and u.is_active and u.privacy_mode = 'Public'
     and (p_before_id is null or g.id < p_before_id)
   order by g.id desc
   limit least(greatest(coalesce(p_limit, 20), 1), 20);
$$;
revoke all on function public.guest_profile_posts(text, uuid, integer) from public;
grant execute on function public.guest_profile_posts(text, uuid, integer) to anon;
comment on function public.guest_profile_posts(text, uuid, integer) is
  'Guest read-only open Public posts of one Public member (App Store 5.1.1(v), #2728): title, description, city only.';
