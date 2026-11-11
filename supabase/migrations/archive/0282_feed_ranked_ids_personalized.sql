-- 0282_feed_ranked_ids_personalized | KC#870 — personalized ranking + feed filters.

drop function if exists public.feed_ranked_ids(
  uuid, text, text[], text[], text, text, double precision,
  text, text, integer, double precision, timestamptz, uuid, text, boolean
);

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
  p_cursor_post_id uuid default null,
  p_filter_search_query text default null,
  p_followers_only boolean default false,
  p_cursor_rank_score double precision default null
)
returns table (
  post_id uuid,
  distance_km double precision,
  rank_score double precision
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_center_lat double precision;
  v_center_lon double precision;
  v_filter_lat double precision;
  v_filter_lon double precision;
  v_status_set text[];
  v_search_esc text;
  v_sort text;
  w_fresh double precision;
  w_follow double precision;
  w_eng double precision;
  w_geo double precision;
  w_cat double precision;
begin
  v_sort := coalesce(p_sort_order, 'newest');
  if v_sort not in ('newest', 'oldest', 'distance', 'personalized') then
    v_sort := 'newest';
  end if;

  select coalesce(max(case when config_key = 'freshness' then weight end), 0.35),
         coalesce(max(case when config_key = 'follow_graph' then weight end), 0.25),
         coalesce(max(case when config_key = 'engagement' then weight end), 0.20),
         coalesce(max(case when config_key = 'geo' then weight end), 0.15),
         coalesce(max(case when config_key = 'interest_category' then weight end), 0.05)
    into w_fresh, w_follow, w_eng, w_geo, w_cat
    from public.feed_ranking_config;

  if v_sort = 'distance' then
    if p_proximity_sort_city is not null then
      select c.lat, c.lon into v_center_lat, v_center_lon
      from public.cities c where c.city_id = p_proximity_sort_city;
    elsif p_viewer_id is not null then
      select c.lat, c.lon into v_center_lat, v_center_lon
      from public.users u
      join public.cities c on c.city_id = u.city
      where u.user_id = p_viewer_id;
    end if;
    if v_center_lat is null then v_sort := 'newest'; end if;
  elsif v_sort = 'personalized' and p_viewer_id is null then
    v_sort := 'newest';
  end if;

  if p_filter_center_city is not null and p_filter_radius_km is not null then
    select c.lat, c.lon into v_filter_lat, v_filter_lon
    from public.cities c where c.city_id = p_filter_center_city;
  end if;

  v_status_set := case p_filter_status
    when 'open'   then array['open']::text[]
    when 'closed' then array['closed_delivered']::text[]
    when 'all'    then array['open','closed_delivered']::text[]
    else array['open']::text[]
  end;

  if p_filter_search_query is not null and length(trim(p_filter_search_query)) >= 2 then
    v_search_esc := public.escape_ilike(trim(p_filter_search_query));
  end if;

  return query
  with viewer_city as (
    select u.city as city_id, c.lat, c.lon
      from public.users u
      join public.cities c on c.city_id = u.city
     where u.user_id = p_viewer_id
  ),
  ranked as (
    select
      p.post_id,
      p.created_at,
      p.owner_id,
      p.category,
      p.title,
      p.description,
      case when v_sort = 'distance'
           then public.haversine_km(v_center_lat, v_center_lon, c.lat, c.lon)
           else null
      end as dist_km,
      case when v_filter_lat is not null
           then public.haversine_km(v_filter_lat, v_filter_lon, c.lat, c.lon)
           else null
      end as filter_dist,
      case when v_sort = 'personalized' then (
        w_fresh * (1.0 / (1.0 + extract(epoch from (now() - p.created_at)) / 86400.0))
        + w_follow * case when exists (
            select 1 from public.follow_edges fe
             where fe.follower_id = p_viewer_id and fe.followed_id = p.owner_id
          ) then 1.0 else 0.0 end
        + w_eng * ln(1.0 + coalesce(ps.reaction_count, 0) + coalesce(ps.comment_count, 0))
        + w_geo * case when vc.lat is not null then
            1.0 / (1.0 + public.haversine_km(vc.lat, vc.lon, c.lat, c.lon) / 50.0)
          else 0.0 end
        + w_cat * case when exists (
            select 1 from public.post_reactions pr
            join public.posts px on px.post_id = pr.post_id
           where pr.user_id = p_viewer_id
             and px.category = p.category
           limit 1
          ) then 1.0 else 0.0 end
      ) else null end as score
    from public.posts p
    join public.cities c on c.city_id = p.city
    left join public.post_stats ps on ps.post_id = p.post_id
    left join viewer_city vc on true
    where p.status = any(v_status_set)
      and (p_filter_type is null or p.type = p_filter_type)
      and (p_filter_categories is null or p.category = any(p_filter_categories))
      and (p_filter_item_conditions is null or p.item_condition = any(p_filter_item_conditions))
      and (
        v_search_esc is null
        or p.title ilike '%' || v_search_esc || '%' escape '\'
        or p.description ilike '%' || v_search_esc || '%' escape '\'
        or p.category ilike '%' || v_search_esc || '%' escape '\'
      )
      and (
        p_followers_only is false
        or (p_viewer_id is not null and exists (
          select 1 from public.follow_edges fe
           where fe.follower_id = p_viewer_id and fe.followed_id = p.owner_id
        ))
      )
      and public.is_post_visible_to(p.*, p_viewer_id)
      and (
        p_viewer_id is null
        or not exists (
          select 1 from public.feed_post_hides h
           where h.user_id = p_viewer_id and h.post_id = p.post_id
        )
      )
      and (
        p_viewer_id is null
        or not exists (
          select 1 from public.feed_mute_filters mf
           where mf.user_id = p_viewer_id
             and (
               (mf.filter_kind = 'user' and mf.filter_value = p.owner_id::text)
               or (mf.filter_kind = 'category' and mf.filter_value = p.category)
               or (mf.filter_kind = 'world' and mf.filter_value = p.category)
               or (mf.filter_kind = 'keyword' and (
                 p.title ilike '%' || public.escape_ilike(mf.filter_value) || '%' escape '\'
                 or p.description ilike '%' || public.escape_ilike(mf.filter_value) || '%' escape '\'
               ))
             )
        )
      )
  )
  select r.post_id, r.dist_km, r.score
  from ranked r
  where
    (p_filter_radius_km is null or r.filter_dist is null or r.filter_dist <= p_filter_radius_km)
    and (
      case
        when p_cursor_created_at is null then true
        when v_sort = 'personalized' then
          coalesce(r.score, 0) < coalesce(p_cursor_rank_score, 1e9)
          or (coalesce(r.score, 0) = coalesce(p_cursor_rank_score, 0)
              and r.created_at < p_cursor_created_at)
          or (coalesce(r.score, 0) = coalesce(p_cursor_rank_score, 0)
              and r.created_at = p_cursor_created_at
              and r.post_id < p_cursor_post_id)
        when v_sort = 'newest' then r.created_at < p_cursor_created_at
        when v_sort = 'oldest' then r.created_at > p_cursor_created_at
        when v_sort = 'distance' then
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
    case when v_sort = 'personalized' then r.score end desc nulls last,
    case when v_sort = 'distance' then r.dist_km end asc nulls last,
    case when v_sort = 'oldest' then r.created_at end asc,
    case when v_sort in ('newest', 'distance', 'personalized') then r.created_at end desc,
    r.post_id desc
  limit greatest(1, least(coalesce(p_page_limit, 20), 100));
end;
$$;

grant execute on function public.feed_ranked_ids(
  uuid, text, text[], text[], text, text, double precision,
  text, text, integer, double precision, timestamptz, uuid, text, boolean, double precision
) to anon, authenticated;
