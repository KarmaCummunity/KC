-- 0438_map_listing_pins | Epic #1166 convenient map: per-listing pins in a viewport.
-- Function only (no tables / columns / indexes). Coordinates are rounded to ~100m
-- (3 decimals) so the map never reveals an exact address before a match.

begin;

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
    l.world_slug,
    lk.slug,
    l.direction,
    l.title,
    l.summary,
    round(extensions.st_y(l.geo::geometry)::numeric, 3)::double precision,
    round(extensions.st_x(l.geo::geometry)::numeric, 3)::double precision,
    case when l.world_slug = 'rides' and l.details ? 'origin_lat'
      then round((l.details->>'origin_lat')::numeric, 3)::double precision end,
    case when l.world_slug = 'rides' and l.details ? 'origin_lng'
      then round((l.details->>'origin_lng')::numeric, 3)::double precision end,
    case when l.world_slug = 'rides' and l.details ? 'dest_lat'
      then round((l.details->>'dest_lat')::numeric, 3)::double precision end,
    case when l.world_slug = 'rides' and l.details ? 'dest_lng'
      then round((l.details->>'dest_lng')::numeric, 3)::double precision end,
    case when l.world_slug = 'rides' then nullif(trim(l.details->>'origin_label'), '') end,
    case when l.world_slug = 'rides' then nullif(trim(l.details->>'dest_label'), '') end,
    case when l.world_slug = 'rides' then l.details->>'departs_at' end,
    case when l.world_slug = 'rides' then
      coalesce(
        case when jsonb_typeof(l.details->'seats_available') = 'number' then (l.details->>'seats_available')::int end,
        case when jsonb_typeof(l.details->'passengers') = 'number' then (l.details->>'passengers')::int end
      ) end
  from public.listings l
  join public.listing_kinds lk on lk.kind_id = l.kind_id
  where l.status = 'open'
    and l.moderation_status = 'published'
    and l.geo is not null
    and l.world_slug <> 'romantic_matchmaking'
    and public.is_listing_visible_to(l, auth.uid())
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

commit;
