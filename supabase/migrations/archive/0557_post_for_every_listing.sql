-- 0557_post_for_every_listing.sql | G1 step 3b-pre (ADR-006, D19, D-217): a post for every
-- listing of a handoff world, and feed exposure as a flag of its own.
--
-- Until now a listing got its post only when it was meant to appear in the main feed: a world
-- with `worlds.feed_mirror`, and for a recurring ride only its soonest upcoming occurrence
-- (FR-RIDE-046, 0531). A knowledge offer got one only when its owner shared it. That made
-- "exists as a post" and "shows in the feed" one thing, and left open, bookable listings — a
-- later occurrence of a recurring ride, an unshared knowledge offer — without a post, so no handoff
-- record could hang on them (step 3b finding).
--
-- This step separates the two:
--   * `posts.feed_hidden` — the post exists (detail, handoffs, chat anchors) but is not listed in
--     the main feed. The signed-in feed view, the ranked feed RPC, the new-post broadcast and the
--     personal activity log all honour it; the app's simple feed query filters on it too.
--   * every published open native listing gets a post the moment it is published; it is hidden
--     when its world is not feed-mirrored or when 0531 says the occurrence waits. Sharing to the
--     feed and the recurring-ride sweep expose it (and a hidden post exposed later is broadcast as
--     a new post then).
--   * a backfill creates the missing posts, hidden, for the listings that are open today.
--
-- `listing_feed_mirror_upsert` gains `p_feed_hidden` (default false = expose); an upsert never
-- hides a post that is already exposed. Additive and idempotent: no row or column is removed.

begin;

-- ── 1. The flag ───────────────────────────────────────────────────────────────────────────────

alter table public.posts
  add column if not exists feed_hidden boolean not null default false;

comment on column public.posts.feed_hidden is
  'G1 (0557): the post exists but is not listed in the main feed — a listing of a world without feed_mirror, or a later occurrence of a recurring ride (0531). Detail, handoffs and chat still reach it.';

-- ── 2. The signed-in feed view: hides, mutes, and now the flag (0417, 0522, 0551) ────────────

create or replace view public.feed_visible_posts
with (security_invoker = true) as
select p.*
  from public.posts p
 where not p.feed_hidden
   and not exists (
         select 1
           from public.feed_post_hides h
          where h.user_id = (select auth.uid())
            and h.post_id = p.post_id
       )
   and not exists (
         select 1
           from public.feed_mute_filters mf
          where mf.user_id = (select auth.uid())
            and (
              (mf.filter_kind = 'user' and mf.filter_value = p.owner_id::text)
              or (mf.filter_kind in ('category', 'world') and mf.filter_value = p.category)
              or (mf.filter_kind = 'keyword' and (
                p.title ilike '%' || public.escape_ilike(mf.filter_value) || '%' escape '\'
                or coalesce(p.description, '') ilike '%' || public.escape_ilike(mf.filter_value) || '%' escape '\'
              ))
            )
       );

revoke all on public.feed_visible_posts from public, anon;
grant select on public.feed_visible_posts to authenticated;

-- ── 3. The mirror upsert learns whether the post is listed (0466, 0522, 0551) ─────────────────

drop function if exists public.listing_feed_mirror_upsert(public.listings);

create or replace function public.listing_feed_mirror_upsert(p_listing public.listings, p_feed_hidden boolean default false)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post_id     uuid;
  v_inserted    boolean := false;
  v_type        text := case when p_listing.direction = 'request' then 'Request' else 'Give' end;
  v_direction   text := case when p_listing.direction = 'request' then 'request' else 'offer' end;
  v_status      text := public.listing_feed_mirror_status(p_listing);
  v_visibility  text := public.anonymity_level_to_visibility(p_listing.anonymity_level);
  v_title       text := left(p_listing.title, 80);
  v_description text := left(coalesce(nullif(trim(p_listing.summary), ''), p_listing.details ->> 'description'), 500);
  v_world       text := p_listing.world_slug;
  v_post_type   text := case when p_listing.world_slug = 'rides' then 'ride' else 'standard' end;
  v_details     jsonb := coalesce(p_listing.details, '{}'::jsonb);
  v_category    text;
  v_condition   text;
  v_city        text;
begin
  select c.legacy_post_category into v_category
    from public.categories c
   where c.category_id = p_listing.category_id;
  if v_category is null or v_category not in (
    'Furniture', 'Clothing', 'Books', 'Toys', 'BabyGear', 'Kitchen', 'Sports', 'Electronics', 'Tools', 'Other'
  ) then
    v_category := 'Other';
  end if;
  if v_type = 'Give' then
    v_condition := case lower(p_listing.details ->> 'item_condition')
      when 'new' then 'New'
      when 'like_new' then 'LikeNew'
      when 'likenew' then 'LikeNew'
      when 'good' then 'Good'
      when 'fair' then 'Fair'
      else null
    end;
  end if;
  v_city := coalesce(
    p_listing.city_id,
    (select u.city from public.users u where u.user_id = p_listing.owner_id),
    'tel-aviv'
  );

  select p.post_id into v_post_id
    from public.posts p
   where p.listing_id = p_listing.listing_id;

  if v_post_id is null then
    insert into public.posts (
      owner_id, listing_id, listing_world_slug, type, status, visibility, title, description,
      category, city, street, street_number, location_display_level, item_condition, created_at,
      world_slug, direction, post_type, expires_at, details, category_id, geo, time_window,
      urgency_level, external_body_id, beneficiary_org_id, feed_hidden
    ) values (
      p_listing.owner_id, p_listing.listing_id, v_world, v_type, v_status, v_visibility, v_title,
      v_description, v_category, v_city, 'Marketplace', '1', 'CityOnly', v_condition,
      coalesce(p_listing.published_at, p_listing.created_at),
      v_world, v_direction, v_post_type, p_listing.expires_at, v_details, p_listing.category_id,
      p_listing.geo, p_listing.time_window, p_listing.urgency_level, p_listing.external_body_id,
      p_listing.beneficiary_org_id, p_feed_hidden
    )
    returning post_id into v_post_id;
    v_inserted := true;
    insert into public.listing_feed_posts (listing_id, post_id)
    values (p_listing.listing_id, v_post_id)
    on conflict (listing_id) do nothing;
  else
    -- An exposed post stays exposed: `p_feed_hidden = true` means "keep as it is", never "hide".
    update public.posts p
       set type               = v_type,
           status             = v_status,
           visibility         = v_visibility,
           title              = v_title,
           description        = v_description,
           category           = v_category,
           city               = v_city,
           item_condition     = v_condition,
           listing_world_slug = v_world,
           world_slug         = v_world,
           direction          = v_direction,
           post_type          = v_post_type,
           expires_at         = p_listing.expires_at,
           details            = v_details,
           category_id        = p_listing.category_id,
           geo                = p_listing.geo,
           time_window        = p_listing.time_window,
           urgency_level      = p_listing.urgency_level,
           external_body_id   = p_listing.external_body_id,
           beneficiary_org_id = p_listing.beneficiary_org_id,
           feed_hidden        = (p.feed_hidden and p_feed_hidden)
     where p.post_id = v_post_id
       and (p.type, p.status, p.visibility, p.title, p.description, p.category, p.city,
            p.item_condition, p.listing_world_slug, p.world_slug, p.direction, p.post_type,
            p.expires_at, p.details, p.category_id, p.geo::text, p.time_window, p.urgency_level,
            p.external_body_id, p.beneficiary_org_id, p.feed_hidden)
           is distinct from
           (v_type, v_status, v_visibility, v_title, v_description, v_category, v_city,
            v_condition, v_world, v_world, v_direction, v_post_type,
            p_listing.expires_at, v_details, p_listing.category_id, p_listing.geo::text,
            p_listing.time_window, p_listing.urgency_level,
            p_listing.external_body_id, p_listing.beneficiary_org_id, (p.feed_hidden and p_feed_hidden));
  end if;

  perform public.listing_feed_mirror_sync_media(p_listing.listing_id, v_post_id);
  if v_post_type = 'ride' and to_regproc('public.ride_post_details_upsert') is not null then
    perform public.ride_post_details_upsert(v_post_id, v_details);
  end if;
  if v_inserted and to_regproc('public.post_handoffs_sync_listing') is not null then
    perform public.post_handoffs_sync_listing(p_listing.listing_id);
  end if;
  return v_post_id;
end;
$$;

comment on function public.listing_feed_mirror_upsert(public.listings, boolean) is
  'G1: creates or refreshes the post of a listing; p_feed_hidden = true keeps a new post out of the main feed and leaves an exposed post exposed (0557).';

revoke all on function public.listing_feed_mirror_upsert(public.listings, boolean) from public, anon, authenticated;
grant execute on function public.listing_feed_mirror_upsert(public.listings, boolean) to service_role;

-- Whether a listing's post is listed in the main feed: the world mirrors into the feed and, for a
-- recurring ride, this is the soonest upcoming occurrence (0531).
create or replace function public.listing_feed_hidden(p_listing public.listings)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (select 1 from public.worlds w where w.slug = p_listing.world_slug and w.feed_mirror)
      or public.ride_series_feed_waits(p_listing);
$$;

revoke all on function public.listing_feed_hidden(public.listings) from public, anon, authenticated;
grant execute on function public.listing_feed_hidden(public.listings) to service_role;

-- ── 4. Every published open listing gets its post (0466, 0531, 0554) ─────────────────────────

create or replace function public.listings_feed_mirror_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mirrored boolean;
begin
  if new.origin <> 'native' then
    return new;
  end if;

  -- A post-sourced listing (0554): the post is the record, the listing syncs back to it.
  if new.legacy_post_id is not null then
    begin
      perform public.post_sync_from_listing(new);
    exception when others then
      raise warning 'post_sync_from_listing: listing % not synced: % (%)', new.listing_id, sqlerrm, sqlstate;
    end;
    return new;
  end if;

  select exists (select 1 from public.posts p where p.listing_id = new.listing_id)
    into v_mirrored;

  -- Without a post yet, a published open listing gets one — listed in the feed when its world
  -- mirrors there and, for a recurring ride, when it is the soonest occurrence; hidden otherwise.
  if not v_mirrored and (new.moderation_status <> 'published' or new.status <> 'open') then
    return new;
  end if;

  begin
    perform public.listing_feed_mirror_upsert(
      new,
      case when v_mirrored then true else public.listing_feed_hidden(new) end);
  exception when others then
    raise warning 'listing_feed_mirror: listing % not mirrored: % (%)', new.listing_id, sqlerrm, sqlstate;
  end;
  return new;
end;
$$;

revoke all on function public.listings_feed_mirror_sync() from public, anon, authenticated;

-- ── 5. The recurring-ride sweep exposes the next occurrence's post (0531) ─────────────────────

create or replace function public.ride_series_sweep()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := public.ride_series_materialize(null);
  v_next public.listings;
begin
  -- Request occurrences whose departure passed: expired, not closed, so no karma or handoff.
  update public.listings
     set status = 'expired', updated_at = now()
   where world_slug = 'rides'
     and direction = 'request'
     and status = 'open'
     and details ? 'ride_series'
     and expires_at is not null
     and expires_at <= now();

  -- The soonest upcoming occurrence of every series is listed in the feed: its post is
  -- exposed (created if it is somehow missing); the later occurrences keep their hidden posts.
  for v_next in
    select distinct on (l.details -> 'ride_series' ->> 'id') l.*
      from public.listings l
      join public.worlds w on w.slug = l.world_slug and w.feed_mirror
     where l.world_slug = 'rides'
       and l.details ? 'ride_series'
       and l.status = 'open'
       and l.moderation_status = 'published'
       and (l.details ->> 'departs_at')::timestamptz > now()
     order by l.details -> 'ride_series' ->> 'id', (l.details ->> 'departs_at')::timestamptz
  loop
    if not exists (select 1 from public.posts p where p.listing_id = v_next.listing_id and not p.feed_hidden) then
      begin
        perform public.listing_feed_mirror_upsert(v_next, false);
      exception when others then
        raise warning 'ride_series_sweep: occurrence % not mirrored: % (%)', v_next.listing_id, sqlerrm, sqlstate;
      end;
    end if;
  end loop;
  return v_count;
end;
$$;

comment on function public.ride_series_sweep() is
  'Every 10 min: materializes recurring rides, expires departed request occurrences, exposes the next occurrence''s post in the main feed (FR-RIDE-046, 0557).';

revoke all on function public.ride_series_sweep() from public, anon, authenticated;
grant execute on function public.ride_series_sweep() to service_role;

-- ── 6. The feed surfaces that react to a new post skip a hidden one (0044, 0416) ─────────────

drop trigger if exists tg_posts_feed_new_post_broadcast on public.posts;
create trigger tg_posts_feed_new_post_broadcast
  after insert on public.posts
  for each row when (not new.feed_hidden)
  execute function public.posts_feed_new_post_broadcast();

-- A hidden post that is exposed later (shared, or its ride's turn came) is new to the feed then.
drop trigger if exists tg_posts_feed_exposed_broadcast on public.posts;
create trigger tg_posts_feed_exposed_broadcast
  after update of feed_hidden on public.posts
  for each row when (old.feed_hidden and not new.feed_hidden)
  execute function public.posts_feed_new_post_broadcast();

drop trigger if exists posts_personal_activity_after_insert on public.posts;
create trigger posts_personal_activity_after_insert
  after insert on public.posts
  for each row when (not new.feed_hidden)
  execute function public.posts_personal_activity_after_insert();

-- ── 7. The ranked feed skips hidden posts (0529 body, one line added) ────────────────────────

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
  p_cursor_rank_score double precision default null,
  p_filter_worlds text[] default null,
  p_filter_subcategories text[] default null
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
         and (p_filter_worlds is null or coalesce(p.listing_world_slug, 'items') = any(p_filter_worlds))
         and (
           p_filter_subcategories is null
           or (
             p.listing_id is not null
             and exists (
               select 1 from public.listings l
               join public.categories cat on cat.category_id = l.category_id
               where l.listing_id = p.listing_id
                 and cat.slug = any(p_filter_subcategories)
             )
           )
           or (
             p.listing_id is null
             and exists (
               select 1 from public.categories cat
               where cat.world_slug = 'items'
                 and cat.legacy_post_category = p.category
                 and cat.slug = any(p_filter_subcategories)
             )
           )
         )
         and (
           p_cursor_created_at is null
           or (fm.created_at, fm.post_id) < (p_cursor_created_at, p_cursor_post_id)
         )
       order by fm.created_at desc, fm.post_id desc;
  elsif v_sort in ('personalized', 'distance') and v_search_esc is null then
    open v_cur for
      select q.prow, q.pid, q.dist, q.score
        from (
          select
            p as prow,
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
          join public.posts p on p.post_id = fm.post_id
          join public.cities c on c.city_id = fm.city
          where fm.status = any(v_status_set)
            and (p_filter_type is null or fm.type = p_filter_type)
            and (p_filter_categories is null or fm.category = any(p_filter_categories))
            and (p_filter_item_conditions is null or fm.item_condition = any(p_filter_item_conditions))
            and (p_filter_worlds is null or coalesce(p.listing_world_slug, 'items') = any(p_filter_worlds))
            and (
              p_filter_subcategories is null
              or (
                p.listing_id is not null
                and exists (
                  select 1 from public.listings l
                  join public.categories cat on cat.category_id = l.category_id
                  where l.listing_id = p.listing_id
                    and cat.slug = any(p_filter_subcategories)
                )
              )
              or (
                p.listing_id is null
                and exists (
                  select 1 from public.categories cat
                  where cat.world_slug = 'items'
                    and cat.legacy_post_category = p.category
                    and cat.slug = any(p_filter_subcategories)
                )
              )
            )
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
            and (p_filter_worlds is null or coalesce(p.listing_world_slug, 'items') = any(p_filter_worlds))
            and (
              p_filter_subcategories is null
              or (
                p.listing_id is not null
                and exists (
                  select 1 from public.listings l
                  join public.categories cat on cat.category_id = l.category_id
                  where l.listing_id = p.listing_id
                    and cat.slug = any(p_filter_subcategories)
                )
              )
              or (
                p.listing_id is null
                and exists (
                  select 1 from public.categories cat
                  where cat.world_slug = 'items'
                    and cat.legacy_post_category = p.category
                    and cat.slug = any(p_filter_subcategories)
                )
              )
            )
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
    -- A post that exists for a listing kept out of the main feed (0557) is not listed.
    continue when coalesce(v_post.feed_hidden, false);
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

revoke all on function public.feed_ranked_ids(
  uuid, text, text[], text[], text, text, double precision,
  text, text, integer, double precision, timestamptz, uuid, text, boolean, double precision,
  text[], text[]
) from public;

grant execute on function public.feed_ranked_ids(
  uuid, text, text[], text[], text, text, double precision,
  text, text, integer, double precision, timestamptz, uuid, text, boolean, double precision,
  text[], text[]
) to anon, authenticated, service_role;

-- ── 8. Backfill: a hidden post for every published open listing that has none ────────────────

do $$
declare
  l public.listings;
  v_n int := 0;
begin
  for l in
    select li.* from public.listings li
     where li.origin = 'native'
       and li.legacy_post_id is null
       and li.moderation_status = 'published'
       and li.status = 'open'
       and not exists (select 1 from public.posts p where p.listing_id = li.listing_id)
     order by li.created_at
  loop
    begin
      perform public.listing_feed_mirror_upsert(l, public.listing_feed_hidden(l));
      v_n := v_n + 1;
    exception when others then
      raise warning '0557 backfill: listing % skipped: % (%)', l.listing_id, sqlerrm, sqlstate;
    end;
  end loop;
  raise notice '0557: % listing(s) received a post', v_n;
end $$;

commit;
