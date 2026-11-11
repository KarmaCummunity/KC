-- Social · the feed on a map (FR-FEED-021, M10)
--
-- Two reads over `posts.geo_approx`, the only location any member ever sees (design §4.1:
-- a city centre or an exact point coarsened to about 300 m; an exact address is never read
-- here). Map mode shows open posts, so both use the partial GiST index
-- posts_geo_approx_gist_idx (status = 'open').
--
-- Leak-proof rule. Under row security the planner pushes only leak-proof conditions into an
-- index scan, and a spatial test is not one. So the candidates are found by a definer
-- function that applies the audience test of the read policy (own post, public, or followed
-- owner) next to the spatial one, and the invoker functions then read the candidate rows
-- with the caller's rights: RLS on `posts` and `users` (blocks, inactive accounts) is the
-- final gate, and a count never includes a post the caller cannot read.
--
-- p_bounds   {"west", "south", "east", "north"} in degrees; west < east, south < north.
-- p_filters  (every key optional) world, direction, item_subcategory_ids — as in feed_page.
-- Hydrate a pin with public.post_cards(array[post_id]).

-- Ids of open posts inside the box, newest first. Coarse audience test only; see above.
create function kc_access.map_post_candidates(
  p_west double precision,
  p_south double precision,
  p_east double precision,
  p_north double precision,
  p_world text,
  p_direction text,
  p_subcategory_ids uuid[],
  p_limit integer
)
returns table (post_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
    from public.posts p
   where p.status = 'open'
     and extensions.st_intersects(
           p.geo_approx,
           extensions.st_makeenvelope(p_west, p_south, p_east, p_north, 4326)::extensions.geography)
     and (p_world is null or p.world_slug = p_world)
     and (p_direction is null or p.direction = p_direction)
     and (p_subcategory_ids is null or p.item_subcategory_id = any (p_subcategory_ids))
     and (p.owner_id = (select auth.uid())
          or p.visibility = 'Public'
          or (p.visibility = 'FollowersOnly'
              and exists (select 1 from public.follows f
                           where f.follower_id = (select auth.uid()) and f.followed_id = p.owner_id)))
   order by p.published_at desc, p.id desc
   limit p_limit;
$$;
comment on function kc_access.map_post_candidates(
  double precision, double precision, double precision, double precision, text, text, uuid[], integer) is
  'Ids of open posts inside a box that the caller''s audience admits; the caller''s row access is the final gate.';
grant execute on function kc_access.map_post_candidates(
  double precision, double precision, double precision, double precision, text, text, uuid[], integer)
  to authenticated;

-- Validates bounds and filters shared by both map reads and returns them parsed.
create function kc_access.map_args(p_bounds jsonb, p_filters jsonb)
returns table (west double precision, south double precision, east double precision, north double precision,
               world text, direction text, subcategory_ids uuid[])
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_f constant jsonb := coalesce(p_filters, '{}'::jsonb);
begin
  west := (p_bounds ->> 'west')::double precision;
  south := (p_bounds ->> 'south')::double precision;
  east := (p_bounds ->> 'east')::double precision;
  north := (p_bounds ->> 'north')::double precision;
  if west is null or south is null or east is null or north is null
     or west >= east or south >= north
     or west < -180 or east > 180 or south < -90 or north > 90 then
    raise exception 'invalid_bounds' using errcode = 'P0001';
  end if;
  world := v_f ->> 'world';
  direction := v_f ->> 'direction';
  if direction is not null and direction not in ('offer', 'request') then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  if jsonb_typeof(v_f -> 'item_subcategory_ids') = 'array' then
    subcategory_ids := array(select jsonb_array_elements_text(v_f -> 'item_subcategory_ids')::uuid);
  end if;
  return next;
end;
$$;
comment on function kc_access.map_args(jsonb, jsonb) is 'Parses the bounds and filters of the map reads; invalid_bounds / invalid_input on bad values.';
grant execute on function kc_access.map_args(jsonb, jsonb) to authenticated;

-- Single posts inside the viewport as approximate pins, newest first. At most p_limit
-- (default 100, maximum 200) are returned; a screen that receives p_limit pins should zoom
-- in or switch to map_post_clusters.
create function public.map_post_pins(
  p_bounds jsonb,
  p_filters jsonb default '{}'::jsonb,
  p_limit integer default 100
)
returns table (post_id uuid, lat double precision, lng double precision, world_slug text, direction text)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_a record;
  v_ids uuid[];
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  select * into v_a from kc_access.map_args(p_bounds, p_filters);
  v_ids := array(select c.post_id from kc_access.map_post_candidates(
    v_a.west, v_a.south, v_a.east, v_a.north, v_a.world, v_a.direction, v_a.subcategory_ids,
    least(greatest(coalesce(p_limit, 100), 1), 200)) c);
  return query
  select p.id, extensions.st_y(p.geo_approx::extensions.geometry),
         extensions.st_x(p.geo_approx::extensions.geometry), p.world_slug, p.direction
    from public.posts p
   where p.id = any (v_ids)
   order by p.published_at desc, p.id desc;
end;
$$;
comment on function public.map_post_pins(jsonb, jsonb, integer) is
  'Open posts inside a map viewport as approximate pins (FR-FEED-021); at most 200.';
grant execute on function public.map_post_pins(jsonb, jsonb, integer) to authenticated;

-- Posts inside the viewport grouped on a grid that halves with every zoom level (cells of
-- a quarter of a 256-pixel tile): centre of the cluster, number of posts and, for a lone
-- post, its id. Counts cover the 3000 newest candidates of the viewport and only posts the
-- caller can read. At most 500 clusters, the largest first. zoom is 0 to 20.
create function public.map_post_clusters(
  p_bounds jsonb,
  p_zoom integer,
  p_filters jsonb default '{}'::jsonb
)
returns table (lat double precision, lng double precision, post_count integer, single_post_id uuid)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_a record;
  v_ids uuid[];
  v_cell constant double precision := 360.0 / power(2, least(greatest(coalesce(p_zoom, 0), 0), 20)) / 4;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  if p_zoom is null or p_zoom not between 0 and 20 then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  select * into v_a from kc_access.map_args(p_bounds, p_filters);
  v_ids := array(select c.post_id from kc_access.map_post_candidates(
    v_a.west, v_a.south, v_a.east, v_a.north, v_a.world, v_a.direction, v_a.subcategory_ids, 3000) c);
  return query
  select avg(extensions.st_y(p.geo_approx::extensions.geometry)),
         avg(extensions.st_x(p.geo_approx::extensions.geometry)),
         count(*)::integer,
         case when count(*) = 1 then (array_agg(p.id))[1] end
    from public.posts p
   where p.id = any (v_ids)
   group by extensions.st_snaptogrid(p.geo_approx::extensions.geometry, v_cell)
   order by count(*) desc, 1, 2
   limit 500;
end;
$$;
comment on function public.map_post_clusters(jsonb, integer, jsonb) is
  'Open posts inside a map viewport grouped into zoom-sized grid clusters (FR-FEED-021); at most 500.';
grant execute on function public.map_post_clusters(jsonb, integer, jsonb) to authenticated;
