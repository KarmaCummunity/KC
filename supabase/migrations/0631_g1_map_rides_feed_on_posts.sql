-- 0631_g1_map_rides_feed_on_posts | G1 step 6a-5f (ADR-006, D-214, issue #1671): the map pins and
-- the rides feed read the post of a post-owned listing.
--
-- Same rule as 0629 / 0630: a post-owned listing (origin 'native' with legacy_post_id: food, rides,
-- housing, time since 0554) is read from its post; every other shape keeps reading the listing.
--   1. map_listing_pins (0438)  the candidate filters (status, moderation, geo envelope, world)
--      stay on the listing, so the geo index still serves them; a post-owned listing is checked
--      with post_listing_visible_to (0628) and returns the post's world, kind, direction, geo and
--      ride details
--   2. list_rides_feed (0623)  every ride in it has a post, so visibility is post_listing_visible_to
--      on that post (the rule is_listing_visible_to applies to both shapes since 0628), and the
--      direction is the post's in the listing's words
--   3. map_listing_clusters (0332), #1911  it never planned: min() has no uuid variant, so every
--      call failed. The cluster's representative listing is now the smallest id as text, cast back
--      (a real listing of the cluster, as min(uuid) meant). With that fixed it follows the same rule
--      as the pins: filters on the listing, visibility and position from the post of a post-owned
--      listing.
-- Title, summary and created_at stay the listing's (see 0630 on posts made post-owned by the 0554
-- backfill). The pins and the rides feed are byte-identical to the pre-0631 bodies, which the test
-- uses as oracles; the clusters, which had no working body, are tested on their behaviour. Names,
-- arguments, return shapes and grants are unchanged; changed lines carry `-- 0631`.

begin;

-- ── 1. map_listing_pins (0438) ──────────────────────────────────────────────────────────────────
create or replace function public.map_listing_pins(
  p_sw_lat double precision,
  p_sw_lng double precision,
  p_ne_lat double precision,
  p_ne_lng double precision,
  p_world_slug text default null,
  p_limit int default 300
)
returns table (
  listing_id uuid,
  world_slug text,
  kind_slug text,
  direction text,
  title text,
  summary text,
  lat double precision,
  lng double precision,
  origin_lat double precision,
  origin_lng double precision,
  dest_lat double precision,
  dest_lng double precision,
  origin_label text,
  dest_label text,
  departs_at text,
  seats int
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    l.listing_id,
    w.world_slug,                                                                         -- 0631
    lk.slug,
    case when p.post_id is null then l.direction                                          -- 0631
         when p.direction = 'request' then 'request' else 'give' end,                      -- 0631
    l.title,
    l.summary,
    round(extensions.st_y(w.geo::geometry)::numeric, 3)::double precision,
    round(extensions.st_x(w.geo::geometry)::numeric, 3)::double precision,
    case when w.world_slug = 'rides' and w.details ? 'origin_lat'
      then round((w.details->>'origin_lat')::numeric, 3)::double precision end,
    case when w.world_slug = 'rides' and w.details ? 'origin_lng'
      then round((w.details->>'origin_lng')::numeric, 3)::double precision end,
    case when w.world_slug = 'rides' and w.details ? 'dest_lat'
      then round((w.details->>'dest_lat')::numeric, 3)::double precision end,
    case when w.world_slug = 'rides' and w.details ? 'dest_lng'
      then round((w.details->>'dest_lng')::numeric, 3)::double precision end,
    case when w.world_slug = 'rides' then nullif(trim(w.details->>'origin_label'), '') end,
    case when w.world_slug = 'rides' then nullif(trim(w.details->>'dest_label'), '') end,
    case when w.world_slug = 'rides' then w.details->>'departs_at' end,
    case when w.world_slug = 'rides' then
      coalesce(
        case when jsonb_typeof(w.details->'seats_available') = 'number' then (w.details->>'seats_available')::int end,
        case when jsonb_typeof(w.details->'passengers') = 'number' then (w.details->>'passengers')::int end
      ) end
  from public.listings l
  -- 0631: the post of a post-owned listing (food, rides, housing, time; 0554), the record.
  left join public.posts p on p.post_id = l.legacy_post_id and l.origin = 'native'        -- 0631
  -- 0631: the fields both syncs keep equal, from the post when it is the record (0554, 0626).
  cross join lateral (select case when p.post_id is null then l.world_slug else p.world_slug end as world_slug, -- 0631
                             case when p.post_id is null then l.geo else p.geo end as geo,                   -- 0631
                             case when p.post_id is null then l.details else p.details end as details) w     -- 0631
  join public.listing_kinds lk on lk.kind_id = coalesce(p.kind_id, l.kind_id)            -- 0631
  where l.status = 'open'
    and l.moderation_status = 'published'
    and l.geo is not null
    and l.world_slug <> 'romantic_matchmaking'
    and (case when p.post_id is null then public.is_listing_visible_to(l, auth.uid())     -- 0631
              else public.post_listing_visible_to(p, auth.uid()) end)                     -- 0631
    and (p_world_slug is null or l.world_slug = p_world_slug)
    and extensions.st_within(
      l.geo::geometry,
      extensions.st_makeenvelope(p_sw_lng, p_sw_lat, p_ne_lng, p_ne_lat, 4326)
    )
  order by l.urgency_level desc, l.listing_id
  limit least(greatest(coalesce(p_limit, 300), 1), 500);
$$;

revoke all on function public.map_listing_pins(
  double precision, double precision, double precision, double precision, text, int
) from public;
grant execute on function public.map_listing_pins(
  double precision, double precision, double precision, double precision, text, int
) to anon, authenticated, service_role;

-- ── 2. list_rides_feed (0623) ───────────────────────────────────────────────────────────────────
create or replace function public.list_rides_feed(p_limit int default 100)
returns table (
  listing_id     uuid,
  direction      text,
  title          text,
  departs_at     timestamptz,
  origin_label   text,
  dest_label     text,
  meeting_points int,
  seats_left     int,
  passengers     int,
  recurrence     jsonb,
  series_more    int
)
language sql
stable
security definer
set search_path = public
as $$
  with upcoming as (
    select l.listing_id, l.title,                    -- 0623: the listing keeps its id and title
           case when p.direction = 'request' then 'request' else 'give' end as direction, -- 0631: the post's
           p.post_id,                                -- 0623: the ride's post
           p.details -> 'ride_series' as recurrence, -- 0623: the post's copy of the series marker
           r.origin_label, r.dest_label, r.meeting_points, r.seats_available, r.passengers, -- 0623
           r.departs_at as departs,                  -- 0623: the ride's schedule
           r.series_id::text as series_id            -- 0623: the series of the occurrence
      from public.listings l
      join public.posts p on p.listing_id = l.listing_id        -- 0623
      join public.ride_post_details r on r.post_id = p.post_id  -- 0623
     where l.world_slug = 'rides'
       and p.status = 'open' -- 0623: open and published (listing_feed_mirror_status, 0551)
       and r.departs_at > now() -- 0623: a typed departure
       and public.post_listing_visible_to(p, auth.uid()) -- 0631: every row has its post (0628 rules)
  ), horizon as (
    -- Midnight starting the day after tomorrow, Israel time.
    select (((now() at time zone 'Asia/Jerusalem')::date + 2)::timestamp) at time zone 'Asia/Jerusalem' as at
  ), keyed as (
    select u.*,
           case when u.series_id is not null and u.departs >= h.at
                then 'series:' || u.series_id else 'listing:' || u.listing_id::text end as fold_key
      from upcoming u, horizon h
  ), folded as (
    select distinct on (k.fold_key)
           k.*, (count(*) over (partition by k.fold_key) - 1)::int as later_count
      from keyed k
     order by k.fold_key, k.departs, k.listing_id
  )
  select f.listing_id,
         f.direction,
         f.title,
         f.departs,
         f.origin_label,                          -- 0623
         f.dest_label,                            -- 0623
         jsonb_array_length(f.meeting_points),    -- 0623: always an array (ride_post_details check)
         case when f.direction = 'give' then greatest(0,
           coalesce(f.seats_available, 1)         -- 0623
           - coalesce((select sum(h.seats)::int from public.post_handoffs h -- 0623: the record
                        where h.post_id = f.post_id                         -- 0623
                          and h.status in ('reserved', 'confirmed', 'handed_over')), 0))
         end,
         case when f.direction = 'request' then f.passengers end, -- 0623
         f.recurrence,                                            -- 0623
         f.later_count
    from folded f
   order by f.departs, f.listing_id
   limit greatest(1, least(coalesce(p_limit, 100), 200));
$$;

revoke all on function public.list_rides_feed(int) from public;
grant execute on function public.list_rides_feed(int) to anon, authenticated;

-- ── 3. map_listing_clusters (0332), #1911 ───────────────────────────────────────────────────────
create or replace function public.map_listing_clusters(
  p_sw_lat double precision,
  p_sw_lng double precision,
  p_ne_lat double precision,
  p_ne_lng double precision,
  p_world_slug text default null,
  p_viewer uuid default auth.uid()
)
returns table (
  cluster_key text,
  center_lat double precision,
  center_lng double precision,
  listing_count int,
  sample_listing_id uuid
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_sw geography;
  v_ne geography;
begin
  v_sw := extensions.st_setsrid(extensions.st_makepoint(p_sw_lng, p_sw_lat), 4326)::geography;
  v_ne := extensions.st_setsrid(extensions.st_makepoint(p_ne_lng, p_ne_lat), 4326)::geography;

  return query
  with visible as (
    select l.listing_id,
           case when p.post_id is null then l.geo else p.geo end as geo,                 -- 0631: the post's
           l.world_slug
      from public.listings l
      -- 0631: the post of a post-owned listing (food, rides, housing, time; 0554), the record.
      left join public.posts p on p.post_id = l.legacy_post_id and l.origin = 'native'    -- 0631
     where l.status = 'open'
       and l.moderation_status = 'published'
       and l.geo is not null
       and l.world_slug <> 'romantic_matchmaking'
       and (case when p.post_id is null then public.is_listing_visible_to(l, p_viewer)    -- 0631
                 else public.post_listing_visible_to(p, p_viewer) end)                   -- 0631
       and (p_world_slug is null or l.world_slug = p_world_slug)
       and extensions.st_within(
         l.geo::geometry,
         extensions.st_makeenvelope(p_sw_lng, p_sw_lat, p_ne_lng, p_ne_lat, 4326)
       )
  ),
  gridded as (
    select
      listing_id,
      geo,
      round(extensions.st_y(geo::geometry)::numeric, 2) as lat_bucket,
      round(extensions.st_x(geo::geometry)::numeric, 2) as lng_bucket
    from visible
  )
  select
    (g.lat_bucket || ',' || g.lng_bucket) as cluster_key,
    avg(extensions.st_y(g.geo::geometry))::double precision,
    avg(extensions.st_x(g.geo::geometry))::double precision,
    count(*)::int,
    min(g.listing_id::text)::uuid -- 0631: min() has no uuid variant (#1911); a real listing of the cluster
  from gridded g
  group by g.lat_bucket, g.lng_bucket
  order by listing_count desc;
end;
$$;

revoke all on function public.map_listing_clusters(
  double precision, double precision, double precision, double precision, text, uuid
) from public;
grant execute on function public.map_listing_clusters(
  double precision, double precision, double precision, double precision, text, uuid
) to anon, authenticated, service_role;

commit;
