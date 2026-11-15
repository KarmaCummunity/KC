-- 0392: find ride listings near a corridor (origin+dest proximity via PostGIS).

begin;

create or replace function public.find_ride_listing_matches(
  p_origin_lat double precision,
  p_origin_lng double precision,
  p_dest_lat double precision,
  p_dest_lng double precision,
  p_departs_after timestamptz default now(),
  p_departs_before timestamptz default (now() + interval '7 days'),
  p_radius_km double precision default 15,
  p_limit int default 20
)
returns table (
  listing_id uuid,
  title text,
  direction text,
  seats_left int,
  departs_at timestamptz,
  origin_label text,
  dest_label text,
  distance_m double precision
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with viewer as (
    select auth.uid() as uid
  ),
  params as (
    select
      st_setsrid(st_makepoint(p_origin_lng, p_origin_lat), 4326)::geography as origin_g,
      st_setsrid(st_makepoint(p_dest_lng, p_dest_lat), 4326)::geography as dest_g,
      greatest(1.0, least(coalesce(p_radius_km, 15), 100)) * 1000.0 as radius_m,
      least(greatest(coalesce(p_limit, 20), 1), 50) as lim
  ),
  booked as (
    select h.listing_id, coalesce(sum(h.seats), 0)::int as seats_taken
      from public.giving_handoffs h
     where h.world_slug = 'rides'
       and h.status in ('reserved', 'confirmed', 'handed_over')
     group by h.listing_id
  )
  select
    l.listing_id,
    l.title,
    l.direction,
    greatest(
      0,
      coalesce((l.details->>'seats_available')::int, (l.details->>'passengers')::int, 1)
      - coalesce(b.seats_taken, 0)
    ) as seats_left,
    (l.details->>'departs_at')::timestamptz as departs_at,
    l.details->>'origin_label' as origin_label,
    l.details->>'dest_label' as dest_label,
    (
      st_distance(
        st_setsrid(st_makepoint((l.details->>'origin_lng')::float8, (l.details->>'origin_lat')::float8), 4326)::geography,
        p.origin_g
      )
      + st_distance(
        st_setsrid(st_makepoint((l.details->>'dest_lng')::float8, (l.details->>'dest_lat')::float8), 4326)::geography,
        p.dest_g
      )
    ) / 2.0 as distance_m
  from public.listings l
  cross join params p
  cross join viewer v
  left join booked b on b.listing_id = l.listing_id
  where l.world_slug = 'rides'
    and l.status = 'open'
    and public.is_listing_visible_to(l, v.uid)
    and (l.details->>'departs_at')::timestamptz between p_departs_after and p_departs_before
    and l.details ? 'origin_lat' and l.details ? 'origin_lng'
    and l.details ? 'dest_lat' and l.details ? 'dest_lng'
    and st_dwithin(
      st_setsrid(st_makepoint((l.details->>'origin_lng')::float8, (l.details->>'origin_lat')::float8), 4326)::geography,
      p.origin_g,
      p.radius_m
    )
    and st_dwithin(
      st_setsrid(st_makepoint((l.details->>'dest_lng')::float8, (l.details->>'dest_lat')::float8), 4326)::geography,
      p.dest_g,
      p.radius_m
    )
    and greatest(
      0,
      coalesce((l.details->>'seats_available')::int, (l.details->>'passengers')::int, 1)
      - coalesce(b.seats_taken, 0)
    ) > 0
  order by distance_m asc, departs_at asc
  limit (select lim from params);
$$;

revoke all on function public.find_ride_listing_matches(
  double precision, double precision, double precision, double precision,
  timestamptz, timestamptz, double precision, int
) from public;
grant execute on function public.find_ride_listing_matches(
  double precision, double precision, double precision, double precision,
  timestamptz, timestamptz, double precision, int
) to authenticated;

commit;
