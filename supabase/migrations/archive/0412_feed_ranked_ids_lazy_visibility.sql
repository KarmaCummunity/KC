-- 0412_feed_ranked_ids_lazy_visibility | perf: feed_ranked_ids walks an ordered
-- stream and checks visibility / hides / mutes lazily.
--
-- kc-dev before (602 posts): personalized 413 ms, followers-only 153 ms. Causes:
-- is_post_visible_to + hide/mute NOT EXISTS evaluated for every candidate before
-- the sort, plus a per-row EXISTS(post_reactions JOIN posts) for the category
-- interest term and a per-row follow_edges EXISTS.
-- Now: follow set and reacted categories are hoisted into arrays once; the ordered
-- candidate stream is consumed through a cursor and the expensive checks run until
-- page_limit rows are accepted. Ordering, filters and the cursor contract are
-- unchanged except that newest/oldest now tie-break on post_id (previously posts
-- sharing a created_at could be skipped across pages).
-- The newest fast path still reads kc_private.feed_open_posts_mv; personalized and
-- distance (without a text query) now score from it too and fetch live rows lazily.

begin;

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
#variable_conflict use_column
declare
  v_center_lat double precision;
  v_center_lon double precision;
  v_filter_lat double precision;
  v_filter_lon double precision;
  v_status_set text[];
  v_search_esc text;
  v_sort text;
  v_use_mv boolean := false;
  w_fresh double precision;
  w_follow double precision;
  w_eng double precision;
  w_geo double precision;
  w_cat double precision;
  v_lim integer := greatest(1, least(coalesce(p_page_limit, 20), 100));
  v_n integer := 0;
  v_cur refcursor;
  r record;
  v_followed uuid[] := '{}'::uuid[];
  v_cats text[] := '{}'::text[];
  v_vc_lat double precision;
  v_vc_lon double precision;
  v_post public.posts;
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

  v_use_mv := v_sort = 'newest'
    and v_search_esc is null
    and coalesce(p_followers_only, false) = false
    and p_filter_radius_km is null
    and p_filter_center_city is null;


  if p_viewer_id is not null then
    -- Hoisted out of the per-row score/filter (was one EXISTS per post).
    v_followed := coalesce(array(
      select fe.followed_id from public.follow_edges fe where fe.follower_id = p_viewer_id
    ), '{}'::uuid[]);
    if v_sort = 'personalized' then
      v_cats := coalesce(array(
        select distinct px.category
          from public.post_reactions pr
          join public.posts px on px.post_id = pr.post_id
         where pr.user_id = p_viewer_id
      ), '{}'::text[]);
      select c.lat, c.lon into v_vc_lat, v_vc_lon
        from public.users u
        join public.cities c on c.city_id = u.city
       where u.user_id = p_viewer_id;
    end if;
  end if;

  if v_use_mv then
    -- Newest fast path: walk feed_open_posts_mv_open_newest_idx in order.
    open v_cur for
      select p as prow, p.post_id as pid, null::double precision as dist, null::double precision as score
        from kc_private.feed_open_posts_mv fm
        join public.posts p on p.post_id = fm.post_id
        join public.cities c on c.city_id = fm.city
       where fm.status = any(v_status_set)
         and (p_filter_type is null or fm.type = p_filter_type)
         and (p_filter_categories is null or fm.category = any(p_filter_categories))
         and (p_filter_item_conditions is null or fm.item_condition = any(p_filter_item_conditions))
         and (
           p_cursor_created_at is null
           or (fm.created_at, fm.post_id) < (p_cursor_created_at, p_cursor_post_id)
         )
       order by fm.created_at desc, fm.post_id desc;
  elsif v_sort in ('personalized', 'distance') and v_search_esc is null then
    -- Ranked sorts must score every candidate before ordering. Scoring reads the
    -- RLS-free feed_open_posts_mv; the live posts row (RLS + current status) is
    -- fetched lazily in the loop below, only for rows that reach the page.
    open v_cur for
      select q.prow, q.pid, q.dist, q.score
        from (
          select
            null::public.posts as prow,
            fm.post_id as pid,
            fm.created_at as cat,
            case when v_sort = 'distance'
                 then public.haversine_km(v_center_lat, v_center_lon, c.lat, c.lon)
            end as dist,
            case when v_filter_lat is not null
                 then public.haversine_km(v_filter_lat, v_filter_lon, c.lat, c.lon)
            end as filter_dist,
            case when v_sort = 'personalized' then (
              w_fresh * (1.0 / (1.0 + extract(epoch from (now() - fm.created_at)) / 86400.0))
              + w_follow * case when fm.owner_id = any(v_followed) then 1.0 else 0.0 end
              + w_eng * ln(1.0 + fm.reaction_count + fm.comment_count)
              + w_geo * case when v_vc_lat is not null then
                  1.0 / (1.0 + public.haversine_km(v_vc_lat, v_vc_lon, c.lat, c.lon) / 50.0)
                else 0.0 end
              + w_cat * case when fm.category = any(v_cats) then 1.0 else 0.0 end
            )::double precision end as score
          from kc_private.feed_open_posts_mv fm
          join public.cities c on c.city_id = fm.city
          where fm.status = any(v_status_set)
            and (p_filter_type is null or fm.type = p_filter_type)
            and (p_filter_categories is null or fm.category = any(p_filter_categories))
            and (p_filter_item_conditions is null or fm.item_condition = any(p_filter_item_conditions))
            and (coalesce(p_followers_only, false) = false or fm.owner_id = any(v_followed))
        ) q
       where (p_filter_radius_km is null or q.filter_dist is null or q.filter_dist <= p_filter_radius_km)
         and (
           case
             when p_cursor_created_at is null then true
             when v_sort = 'personalized' then
               coalesce(q.score, 0) < coalesce(p_cursor_rank_score, 1e9)
               or (coalesce(q.score, 0) = coalesce(p_cursor_rank_score, 0)
                   and (q.cat, q.pid) < (p_cursor_created_at, p_cursor_post_id))
             else
               coalesce(q.dist, 1e9) > coalesce(p_cursor_distance, -1)
               or (coalesce(q.dist, 1e9) = coalesce(p_cursor_distance, -1)
                   and q.cat < p_cursor_created_at)
               or (coalesce(q.dist, 1e9) = coalesce(p_cursor_distance, -1)
                   and q.cat = p_cursor_created_at
                   and q.pid > p_cursor_post_id)
           end
         )
       order by
         case when v_sort = 'personalized' then q.score end desc nulls last,
         case when v_sort = 'distance' then q.dist end asc nulls last,
         q.cat desc,
         q.pid desc;
  else
    open v_cur for
      select q.prow, q.pid, q.dist, q.score
        from (
          select
            p as prow,
            p.post_id as pid,
            p.created_at as cat,
            case when v_sort = 'distance'
                 then public.haversine_km(v_center_lat, v_center_lon, c.lat, c.lon)
            end as dist,
            case when v_filter_lat is not null
                 then public.haversine_km(v_filter_lat, v_filter_lon, c.lat, c.lon)
            end as filter_dist,
            case when v_sort = 'personalized' then (
              w_fresh * (1.0 / (1.0 + extract(epoch from (now() - p.created_at)) / 86400.0))
              + w_follow * case when p.owner_id = any(v_followed) then 1.0 else 0.0 end
              + w_eng * ln(1.0 + coalesce(ps.reaction_count, 0) + coalesce(ps.comment_count, 0))
              + w_geo * case when v_vc_lat is not null then
                  1.0 / (1.0 + public.haversine_km(v_vc_lat, v_vc_lon, c.lat, c.lon) / 50.0)
                else 0.0 end
              + w_cat * case when p.category = any(v_cats) then 1.0 else 0.0 end
            )::double precision end as score
          from public.posts p
          join public.cities c on c.city_id = p.city
          left join public.post_stats ps on ps.post_id = p.post_id
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
            and (coalesce(p_followers_only, false) = false or p.owner_id = any(v_followed))
        ) q
       where (p_filter_radius_km is null or q.filter_dist is null or q.filter_dist <= p_filter_radius_km)
         and (
           case
             when p_cursor_created_at is null then true
             when v_sort = 'personalized' then
               coalesce(q.score, 0) < coalesce(p_cursor_rank_score, 1e9)
               or (coalesce(q.score, 0) = coalesce(p_cursor_rank_score, 0)
                   and (q.cat, q.pid) < (p_cursor_created_at, p_cursor_post_id))
             when v_sort = 'newest' then (q.cat, q.pid) < (p_cursor_created_at, p_cursor_post_id)
             when v_sort = 'oldest' then (q.cat, q.pid) > (p_cursor_created_at, p_cursor_post_id)
             when v_sort = 'distance' then
               coalesce(q.dist, 1e9) > coalesce(p_cursor_distance, -1)
               or (coalesce(q.dist, 1e9) = coalesce(p_cursor_distance, -1)
                   and q.cat < p_cursor_created_at)
               or (coalesce(q.dist, 1e9) = coalesce(p_cursor_distance, -1)
                   and q.cat = p_cursor_created_at
                   and q.pid > p_cursor_post_id)
             else true
           end
         )
       order by
         case when v_sort = 'personalized' then q.score end desc nulls last,
         case when v_sort = 'distance' then q.dist end asc nulls last,
         case when v_sort = 'oldest' then q.cat end asc,
         case when v_sort = 'oldest' then q.pid end asc,
         case when v_sort in ('newest', 'distance', 'personalized') then q.cat end desc,
         q.pid desc;
  end if;

  -- Visibility, hides and mutes are checked lazily on the ordered stream, so they
  -- run for ~page_limit rows instead of for every candidate post.
  loop
    fetch v_cur into r;
    exit when not found;
    if (r.prow).post_id is null then
      select p.* into v_post
        from public.posts p
       where p.post_id = r.pid and p.status = any(v_status_set);
      continue when not found;
    else
      v_post := r.prow;
    end if;
    continue when not public.is_post_visible_to(v_post, p_viewer_id);
    if p_viewer_id is not null then
      continue when exists (
        select 1 from public.feed_post_hides h
         where h.user_id = p_viewer_id and h.post_id = r.pid
      );
      continue when exists (
        select 1 from public.feed_mute_filters mf
         where mf.user_id = p_viewer_id
           and (
             (mf.filter_kind = 'user' and mf.filter_value = v_post.owner_id::text)
             or (mf.filter_kind in ('category', 'world') and mf.filter_value = v_post.category)
             or (mf.filter_kind = 'keyword' and (
               v_post.title ilike '%' || public.escape_ilike(mf.filter_value) || '%' escape '\'
               or v_post.description ilike '%' || public.escape_ilike(mf.filter_value) || '%' escape '\'
             ))
           )
      );
    end if;
    post_id := r.pid;
    distance_km := r.dist;
    rank_score := r.score;
    return next;
    v_n := v_n + 1;
    exit when v_n >= v_lim;
  end loop;
  close v_cur;
end;
$$;

commit;
