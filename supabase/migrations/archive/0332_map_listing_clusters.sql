-- 0332_map_listing_clusters | Epic #893 / #906 map clustering (server-side grid).

begin;

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
    select l.listing_id, l.geo, l.world_slug
      from public.listings l
     where l.status = 'open'
       and l.moderation_status = 'published'
       and l.geo is not null
       and l.world_slug <> 'romantic_matchmaking'
       and public.is_listing_visible_to(l, p_viewer)
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
    min(g.listing_id)
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
