-- 0022_feed_ranked_ids | P1.2 — Ranked feed query with filters, sort, and distance
-- FR-FEED-004 (filter modal), FR-FEED-006 (distance sort), FR-FEED-018, FR-FEED-019
--
-- Returns ordered post_ids plus a computed distance_km. The application layer
-- then fetches full post rows via the existing select-builder using IN(...),
-- preserving the order returned here.
--
-- Why ids-only:
--   • Keeps SQL focused on filtering + ranking; full PostWithOwner shape stays
--     owned by the typed adapter (POST_SELECT_OWNER in mapPostRow.ts).
--   • Adapter remains the single source of truth for row-to-domain mapping.
--   • Two round-trips (~100ms total) is acceptable for a feed.

create or replace function public.feed_ranked_ids(
  p_viewer_id uuid,
  p_filter_type text default null,
  p_filter_categories text[] default null,
  p_filter_item_conditions text[] default null,
  p_filter_status text default 'open',
  p_filter_center_city text default null,
  p_filter_radius_km double precision default null,
  p_sort_order text default 'newest',
  p_proximity_sort_city text default null,
  p_page_limit integer default 20,
  p_cursor_distance double precision default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_post_id uuid default null
)
returns table (
  post_id uuid,
  distance_km double precision
)
language plpgsql
stable
security invoker
as $$
declare
  v_center_lat double precision;
  v_center_lon double precision;
  v_filter_lat double precision;
  v_filter_lon double precision;
  v_status_set text[];
begin
  -- Resolve proximity-sort center: explicit city, else viewer's city.
  if p_sort_order = 'distance' then
    if p_proximity_sort_city is not null then
      select c.lat, c.lon into v_center_lat, v_center_lon
      from public.cities c where c.city_id = p_proximity_sort_city;
    elsif p_viewer_id is not null then
      select c.lat, c.lon into v_center_lat, v_center_lon
      from public.users u
      join public.cities c on c.city_id = u.city
      where u.user_id = p_viewer_id;
    end if;
    -- If no center resolved (viewer skipped onboarding, no explicit city),
    -- fall back to 'newest' behavior (FR-FEED-006 AC3).
    if v_center_lat is null then
      p_sort_order := 'newest';
    end if;
  end if;

  -- Resolve location-filter center (independent of sort).
  if p_filter_center_city is not null and p_filter_radius_km is not null then
    select c.lat, c.lon into v_filter_lat, v_filter_lon
    from public.cities c where c.city_id = p_filter_center_city;
  end if;

  -- Translate 3-mode status filter to a set of valid statuses.
  v_status_set := case p_filter_status
    when 'open'   then array['open']::text[]
    when 'closed' then array['closed_delivered']::text[]
    when 'all'    then array['open','closed_delivered']::text[]
    else          array['open']::text[]
  end;

  return query
  with ranked as (
    select
      p.post_id,
      p.created_at,
      case when p_sort_order = 'distance'
           then public.haversine_km(v_center_lat, v_center_lon, c.lat, c.lon)
           else null
      end as dist_km,
      case when v_filter_lat is not null
           then public.haversine_km(v_filter_lat, v_filter_lon, c.lat, c.lon)
           else null
      end as filter_dist
    from public.posts p
    join public.cities c on c.city_id = p.city
    where p.status = any(v_status_set)
      and (p_filter_type is null or p.type = p_filter_type)
      and (p_filter_categories is null or p.category = any(p_filter_categories))
      and (p_filter_item_conditions is null
           or p.item_condition = any(p_filter_item_conditions))
      and public.is_post_visible_to(p.*, p_viewer_id)
  )
  select r.post_id, r.dist_km
  from ranked r
  where
    -- Apply radius filter (skip rows beyond the radius).
    (p_filter_radius_km is null or r.filter_dist is null
     or r.filter_dist <= p_filter_radius_km)
    -- Keyset cursor:
    --   newest:  WHERE created_at < cursor_created_at
    --   oldest:  WHERE created_at > cursor_created_at
    --   distance: WHERE (dist, created_at, post_id) > (cursor_dist, cursor_ts, cursor_id)
    and (
      case
        when p_cursor_created_at is null then true
        when p_sort_order = 'newest' then r.created_at < p_cursor_created_at
        when p_sort_order = 'oldest' then r.created_at > p_cursor_created_at
        when p_sort_order = 'distance' then
          coalesce(r.dist_km, 1e9) > coalesce(p_cursor_distance, -1)
          or (coalesce(r.dist_km, 1e9) = coalesce(p_cursor_distance, -1)
              and r.created_at < p_cursor_created_at)
          or (coalesce(r.dist_km, 1e9) = coalesce(p_cursor_distance, -1)
              and r.created_at = p_cursor_created_at
              and r.post_id > p_cursor_post_id)
        else true
      end
    )
  order by
    case when p_sort_order = 'distance' then r.dist_km end asc nulls last,
    case when p_sort_order = 'oldest'   then r.created_at end asc,
    case when p_sort_order in ('newest','distance')
         then r.created_at end desc,
    r.post_id desc
  limit p_page_limit;
end;
$$;

grant execute on function public.feed_ranked_ids(
  uuid, text, text[], text[], text, text, double precision,
  text, text, integer, double precision, timestamptz, uuid
) to anon, authenticated;
