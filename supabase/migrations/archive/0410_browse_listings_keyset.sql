-- 0410_browse_listings_keyset | perf: keyset pagination + lazy visibility for browse_listings.
--
-- Before: ORDER BY over every open listing, is_listing_visible_to() evaluated for
-- every row before the sort, then LIMIT/OFFSET (~100 ms on 726 listings on kc-dev,
-- linear in table size, and OFFSET pages re-scan everything before them).
-- After:
--   * keyset cursor (sort_key, urgency_level, created_at, listing_id); p_offset is
--     kept for old clients and only honoured when no cursor is passed;
--   * radius uses ST_DWithin (GiST listings_geo_gist_idx) instead of ST_Distance <=;
--   * the visibility check runs lazily while walking the ordered rows, so it is
--     evaluated for ~limit rows instead of the whole table;
--   * without a geo anchor the walk follows a matching partial index and stops early.
-- Returns created_at + sort_key so the client can build the next cursor.

begin;

drop function if exists public.browse_listings(
  text, text, smallint, text, double precision, double precision, numeric, int, int, uuid
);

create index if not exists listings_browse_keyset_idx
  on public.listings (urgency_level desc, created_at desc, listing_id desc)
  where status = 'open' and moderation_status = 'published';

create index if not exists listings_browse_world_keyset_idx
  on public.listings (world_slug, urgency_level desc, created_at desc, listing_id desc)
  where status = 'open' and moderation_status = 'published';

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
  p_viewer uuid default auth.uid(),
  p_cursor_sort double precision default null,
  p_cursor_urgency smallint default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null
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
  geo geography,
  created_at timestamptz,
  sort_key double precision
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_anchor geography;
  v_radius_m double precision := coalesce(p_radius_km, 25)::double precision * 1000.0;
  v_lim int := least(greatest(coalesce(p_limit, 24), 1), 50);
  v_skip int := case when p_cursor_id is null then greatest(coalesce(p_offset, 0), 0) else 0 end;
  v_has_cursor boolean := p_cursor_id is not null and p_cursor_created_at is not null;
  v_n int := 0;
  v_cur refcursor;
  r record;
begin
  if p_lat is not null and p_lng is not null then
    v_anchor := extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::geography;
  elsif p_viewer is not null then
    select coalesce(ugp.home_geo, public.listing_geo_from_city(ugp.home_city_id))
      into v_anchor
      from public.user_geo_prefs ugp
     where ugp.user_id = p_viewer;
  end if;

  if v_anchor is null then
    -- No anchor: every row has sort_key 1e15, so order = (urgency, created_at, id) desc,
    -- which walks listings_browse_(world_)keyset_idx and stops after v_lim visible rows.
    open v_cur for
      select l as lrow, 1e15::double precision as sk
        from public.listings l
       where l.status = 'open'
         and l.moderation_status = 'published'
         and l.world_slug <> 'romantic_matchmaking'
         and (p_world_slug is null or l.world_slug = p_world_slug)
         and (p_direction is null or l.direction = p_direction)
         and (p_urgency_min is null or l.urgency_level >= p_urgency_min)
         and (p_availability is null or l.availability_status = p_availability)
         and (
           not v_has_cursor
           or (l.urgency_level, l.created_at, l.listing_id)
              < (p_cursor_urgency, p_cursor_created_at, p_cursor_id)
         )
       order by l.urgency_level desc, l.created_at desc, l.listing_id desc;
  else
    open v_cur for
      select c.lrow, c.sk
        from (
          select l as lrow,
                 l.urgency_level as urg,
                 l.created_at as cat,
                 l.listing_id as lid,
                 case when l.geo is null then 1e15::double precision
                      else extensions.st_distance(v_anchor, l.geo)
                 end as sk
            from public.listings l
           where l.status = 'open'
             and l.moderation_status = 'published'
             and l.world_slug <> 'romantic_matchmaking'
             and (p_world_slug is null or l.world_slug = p_world_slug)
             and (p_direction is null or l.direction = p_direction)
             and (p_urgency_min is null or l.urgency_level >= p_urgency_min)
             and (p_availability is null or l.availability_status = p_availability)
             and (l.geo is null or extensions.st_dwithin(l.geo, v_anchor, v_radius_m))
        ) c
       where not v_has_cursor
          or c.sk > p_cursor_sort
          or (c.sk = p_cursor_sort
              and (c.urg, c.cat, c.lid) < (p_cursor_urgency, p_cursor_created_at, p_cursor_id))
       order by c.sk, c.urg desc, c.cat desc, c.lid desc;
  end if;

  loop
    fetch v_cur into r;
    exit when not found;
    continue when not public.is_listing_visible_to(r.lrow, p_viewer);
    if v_skip > 0 then
      v_skip := v_skip - 1;
      continue;
    end if;

    listing_id := (r.lrow).listing_id;
    world_slug := (r.lrow).world_slug;
    select lk.slug into kind_slug from public.listing_kinds lk where lk.kind_id = (r.lrow).kind_id;
    direction := (r.lrow).direction;
    title := (r.lrow).title;
    summary := (r.lrow).summary;
    urgency_level := (r.lrow).urgency_level;
    availability_status := (r.lrow).availability_status;
    city_id := (r.lrow).city_id;
    distance_km := case when r.sk >= 1e15 then null else (r.sk / 1000.0)::numeric end;
    geo := (r.lrow).geo;
    created_at := (r.lrow).created_at;
    sort_key := r.sk;
    return next;

    v_n := v_n + 1;
    exit when v_n >= v_lim;
  end loop;
  close v_cur;
end;
$$;

revoke all on function public.browse_listings(
  text, text, smallint, text, double precision, double precision, numeric, int, int, uuid,
  double precision, smallint, timestamptz, uuid
) from public;
grant execute on function public.browse_listings(
  text, text, smallint, text, double precision, double precision, numeric, int, int, uuid,
  double precision, smallint, timestamptz, uuid
) to anon, authenticated, service_role;

commit;
