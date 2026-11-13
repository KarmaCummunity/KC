-- 0331_browse_listings_filters | Epic #893 / #906
-- Filtered browse using effective_geo (#828).

begin;

create or replace function public.browse_listings(
  p_world_slug text default null,
  p_direction text default null,
  p_urgency_min smallint default null,
  p_availability text default null,
  p_lat double precision default null,
  p_lng double precision default null,
  p_radius_km numeric default null,
  p_limit int default 24,
  p_offset int default 0,
  p_viewer uuid default auth.uid()
)
returns table (
  listing_id uuid,
  world_slug text,
  kind_slug text,
  direction text,
  title text,
  summary text,
  urgency_level smallint,
  availability_status text,
  city_id text,
  distance_km numeric,
  geo geography
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_anchor geography;
  v_radius numeric := coalesce(p_radius_km, 25);
  v_lim int := least(greatest(coalesce(p_limit, 24), 1), 50);
  v_off int := greatest(coalesce(p_offset, 0), 0);
begin
  if p_lat is not null and p_lng is not null then
    v_anchor := extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::geography;
  elsif p_viewer is not null then
    select coalesce(ugp.home_geo, public.listing_geo_from_city(ugp.home_city_id))
      into v_anchor
      from public.user_geo_prefs ugp
     where ugp.user_id = p_viewer;
  end if;

  return query
  select
    l.listing_id,
    l.world_slug,
    lk.slug,
    l.direction,
    l.title,
    l.summary,
    l.urgency_level,
    l.availability_status,
    l.city_id,
    case
      when v_anchor is null or l.geo is null then null
      else (extensions.st_distance(v_anchor, l.geo) / 1000.0)::numeric
    end as distance_km,
    l.geo
  from public.listings l
  join public.listing_kinds lk on lk.kind_id = l.kind_id
  where l.status = 'open'
    and l.moderation_status = 'published'
    and l.world_slug <> 'romantic_matchmaking'
    and public.is_listing_visible_to(l, p_viewer)
    and (p_world_slug is null or l.world_slug = p_world_slug)
    and (p_direction is null or l.direction = p_direction)
    and (p_urgency_min is null or l.urgency_level >= p_urgency_min)
    and (p_availability is null or l.availability_status = p_availability)
    and (
      v_anchor is null
      or l.geo is null
      or (extensions.st_distance(v_anchor, l.geo) / 1000.0) <= v_radius
    )
  order by
    case when v_anchor is not null and l.geo is not null
      then extensions.st_distance(v_anchor, l.geo) else 1e15 end,
    l.urgency_level desc,
    l.created_at desc
  limit v_lim offset v_off;
end;
$$;

revoke all on function public.browse_listings(
  text, text, smallint, text, double precision, double precision, numeric, int, int, uuid
) from public;
grant execute on function public.browse_listings(
  text, text, smallint, text, double precision, double precision, numeric, int, int, uuid
) to anon, authenticated, service_role;

commit;
