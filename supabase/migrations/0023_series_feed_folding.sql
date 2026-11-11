-- Social · one date of a series in the feed (FR-POST-024 AC11, FR-RIDE-046 AC7; issue #2086)
--
-- A recurring event or ride publishes one ordinary post per day, 30 days ahead, so a daily
-- series put 30 near-identical cards in the main feed. A series is now one card: its
-- soonest open date. The later dates are "folded": reachable from that date ("other
-- dates"), from the rides feed, the map and the publisher's profile, but listed by no feed,
-- world feed or post search (public.feed_page).
--
-- The cost is paid on write, never on read:
--   * `posts.feed_folded` is a plain boolean. A feed page adds `not p.feed_folded` to its
--     candidate condition (leak-proof, so it stays an index condition under row security),
--     and the main feed index leaves folded dates out, so a page never walks over them.
--   * `kc_private.series_refold(series)` recomputes the flag for one series (about 30 rows)
--     when its open dates change: a date is published, moved, expires, is paused, cancelled
--     or deleted. Triggers call it; a nightly job repeats it as a safety net.
--   * A series keeps one place in the feed and takes a new one at most once in 7 days: the
--     date that steps in inherits the place of the date before it, or is published anew
--     when that place is a week old. A weekly event surfaces every week; a daily shift does
--     not jump to the top of the feed every morning.

alter table public.posts add column feed_folded boolean not null default false;
comment on column public.posts.feed_folded is
  'A later date of a recurring series: listed by no feed while an earlier open date of the series stands for it. Written only by kc_private.series_refold and kc_private.series_dates_refold.';

-- The main feed index (20_posts/020_posts.sql) without the folded dates. They are published
-- in nightly batches, so a feed page would otherwise read and discard a run of them.
drop index public.posts_feed_recent_idx;
create index posts_feed_recent_idx on public.posts (published_at desc, id desc)
  where status = 'open' and visibility = 'Public' and not feed_folded;

-- Recomputes which date of a series stands for it in the feeds: its soonest open date is
-- unfolded, every later open date folded. Dates that are not open (ended, paused, closed,
-- cancelled) are not listed by a feed anyway and keep their flag. Safe to call at any time;
-- it writes only the rows whose flag changes.
create function kc_private.series_refold(p_series_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  with dates as materialized (
    -- Every date of the series: a series is either of events or of rides, never both.
    select p.id, d.at, p.status, p.feed_folded, p.published_at
      from (select e.post_id, e.starts_at as at from public.post_event_details e where e.series_id = p_series_id
            union all
            select r.post_id, r.departs_at from public.post_ride_details r where r.series_id = p_series_id) d
      join public.posts p on p.id = d.post_id
  ),
  live as (
    select id, row_number() over (order by at, id) as rn from dates where status = 'open'
  ),
  place as (
    -- When the series last took a place in the feed, if within the last 7 days: the latest
    -- publish time among its dates that have stood for it (the folded ones never have).
    select max(published_at) as taken_at from dates
     where not feed_folded and published_at > now() - interval '7 days'
  )
  update public.posts p
     set feed_folded = (l.rn > 1),
         -- The date stepping in keeps the series' place, or takes a new one after a week.
         published_at = case when p.feed_folded and l.rn = 1
                             then coalesce((select taken_at from place), now())
                             else p.published_at end
    from live l
   where p.id = l.id and p.feed_folded is distinct from (l.rn > 1);
$$;
comment on function kc_private.series_refold(uuid) is
  'Keeps one date of a recurring event or ride in the feeds: the soonest open one. The date stepping in keeps the series'' place, renewed at most once in 7 days.';

-- A post changed status: if it is a date of a series, another date may have to stand for
-- the series (the date was published, ended, was paused, resumed, cancelled or restored).
create function kc_private.posts_refold_series()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_series_id uuid;
begin
  select coalesce(
    (select e.series_id from public.post_event_details e where e.post_id = new.id),
    (select r.series_id from public.post_ride_details r where r.post_id = new.id)) into v_series_id;
  if v_series_id is not null then
    perform kc_private.series_refold(v_series_id);
  end if;
  return null;
end;
$$;
comment on function kc_private.posts_refold_series() is
  'AFTER UPDATE OF status on posts: recomputes which date stands for the post''s series in the feeds.';

-- The refold writes feed_folded and published_at only, so it never fires this trigger again.
create trigger posts_refold_series
  after update of status on public.posts
  for each row when (new.post_type in ('event', 'ride') and old.status is distinct from new.status)
  execute function kc_private.posts_refold_series();

-- A date joined a series, left it, moved in time, or was deleted with its post.
create function kc_private.series_dates_refold()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op <> 'INSERT' and old.series_id is not null then
    perform kc_private.series_refold(old.series_id);
  end if;
  if tg_op <> 'DELETE' and new.series_id is not null
     and (tg_op = 'INSERT' or new.series_id is distinct from old.series_id) then
    perform kc_private.series_refold(new.series_id);
  end if;
  -- A date that left its series is an ordinary post again: nothing stands for it.
  if tg_op = 'UPDATE' and new.series_id is null and old.series_id is not null then
    update public.posts p set feed_folded = false where p.id = new.post_id and p.feed_folded;
  end if;
  return null;
end;
$$;
comment on function kc_private.series_dates_refold() is
  'AFTER INSERT, DELETE or UPDATE of the series or the start on a detail row: recomputes which date stands for the series; a date that left its series is unfolded.';

create trigger post_event_details_series_refold
  after insert or delete or update of series_id, starts_at on public.post_event_details
  for each row execute function kc_private.series_dates_refold();

create trigger post_ride_details_series_refold
  after insert or delete or update of series_id, departs_at on public.post_ride_details
  for each row execute function kc_private.series_dates_refold();

-- Safety net: two dates of one series changing in the same moment (the owner cancels one
-- while another ends) can each miss the other's change. Once a night every running series
-- is recomputed; a series that is already right is not written.
create function kc_private.series_refold_all()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_series_id uuid;
  v_count integer := 0;
begin
  for v_series_id in
    select s.id from public.ride_series s where s.status = 'active'
    union all
    select s.id from public.post_series s where s.status = 'active'
  loop
    perform kc_private.series_refold(v_series_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
comment on function kc_private.series_refold_all() is
  'Recomputes the date in the feeds of every running ride and event series; returns how many series were checked.';

insert into kc_private.scheduled_jobs (name, schedule, command, timeout, alert_after, description) values
  ('series_feed_refold', '45 2 * * *', 'select kc_private.series_refold_all()',
   interval '10 minutes', interval '36 hours',
   'Recurring rides and events: one date of each series in the feeds (safety net of the triggers).');

-- Series that already exist: fold their later dates. Nothing is published anew by this,
-- since no date was folded before.
select kc_private.series_refold(s.id) from public.ride_series s;

-- The feed query of 30_social/080_feed_page.sql, with one added condition (marked 0006).
create or replace function public.feed_page(
  p_cursor jsonb default null,
  p_limit integer default 20,
  p_filters jsonb default '{}'::jsonb
)
returns table (card public.post_card, next_cursor jsonb, distance_m integer)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_viewer constant uuid := (select auth.uid());
  v_f constant jsonb := coalesce(p_filters, '{}'::jsonb);
  v_limit constant integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_search constant boolean := coalesce(v_f ->> 'scope', 'feed') = 'search';
  v_status constant text := coalesce(v_f ->> 'status', 'open');
  v_q constant text := btrim(coalesce(v_f ->> 'q', ''));
  v_as_of constant timestamptz := coalesce((p_cursor ->> 'as_of')::timestamptz, now());
  v_c_k1 constant bigint := (p_cursor ->> 'k1')::bigint;
  v_c_k2 constant bigint := (p_cursor ->> 'k2')::bigint;
  v_c_t constant timestamptz := (p_cursor ->> 't')::timestamptz;
  v_c_id constant uuid := (p_cursor ->> 'id')::uuid;
  v_sort text := coalesce(p_cursor ->> 'sort', v_f ->> 'sort', 'recommended');
  v_followed uuid[];
  v_worlds text[];
  v_active_worlds text[];
  v_muted_users uuid[] := '{}';
  v_muted_words text[] := '{}';
  v_origin extensions.geography;
  v_center extensions.geography;
  v_filter_cities text[];
  v_near_cities text[];
  v_match_ids uuid[];
  v_cfg jsonb;
  v_window bigint;
  v_lo timestamptz;
  v_hi timestamptz := 'infinity';
  v_radius double precision := 5000;
  v_span interval;
  v_where text;
  v_branch text;
  v_from text := '';
  v_k1 text := '0';
  v_k2 text := '0';
  v_extra text := '';
  v_sql text;
  v_page jsonb;
begin
  if v_viewer is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  if v_sort not in ('recommended', 'newest', 'oldest', 'nearest')
     or v_status not in ('open', 'closed', 'all') then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;

  -- The viewer's side of the query, read once.
  v_followed := array(select f.followed_id from public.follows f where f.follower_id = v_viewer);
  select c.location into v_origin from public.cities c
   where c.city_id = coalesce(v_f ->> 'near_city_id',
                              (select u.city_id from public.users u where u.id = v_viewer));
  select c.location into v_center from public.cities c where c.city_id = v_f ->> 'city_id';
  if v_sort = 'nearest' and v_origin is null then
    v_sort := 'newest';
  end if;
  if not v_search then
    v_muted_users := array(select m.muted_user_id from public.feed_mute_filters m
                            where m.user_id = v_viewer and m.filter_kind = 'user');
    v_muted_words := array(select m.keyword from public.feed_mute_filters m
                            where m.user_id = v_viewer and m.filter_kind = 'keyword');
  end if;
  v_worlds := case
    when v_f ->> 'world' is not null then array[v_f ->> 'world']
    when v_search then null
    else array(select w.slug from public.worlds w
                where w.shows_in_main_feed
                  and not exists (select 1 from public.feed_mute_filters m
                                   where m.user_id = v_viewer and m.world_slug = w.slug)) end;

  -- Filters, each added only when asked for, so the plan fits the request. Values travel
  -- as parameters ($n below); the text is assembled from the fixed fragments in this
  -- function only.
  -- 0006: a series is one card in every list this function serves — its date in the feed.
  v_where := ' and p.published_at <= $1 and not p.feed_folded';
  if v_worlds is not null then
    v_where := v_where || ' and p.world_slug = any ($2)';
  end if;
  if not v_search then
    v_where := v_where || ' and not exists (select 1 from public.feed_hides h'
                       || ' where h.user_id = $3 and h.post_id = p.id)';
  end if;
  if v_f ->> 'direction' is not null then
    v_where := v_where || ' and p.direction = $4';
  end if;
  if jsonb_typeof(v_f -> 'item_subcategory_ids') = 'array' then
    v_where := v_where || ' and p.item_subcategory_id = any ($5)';
  end if;
  if v_center is not null and v_f ->> 'radius_km' is not null then
    v_filter_cities := array(
      select c.city_id from public.cities c
       where extensions.st_dwithin(c.location, v_center, (v_f ->> 'radius_km')::double precision * 1000));
    v_where := v_where || ' and p.city_id = any ($6)';
  elsif v_f ->> 'city_id' is not null then
    v_where := v_where || ' and p.city_id = $8';
  end if;
  if char_length(v_q) >= 2 then
    v_match_ids := kc_access.post_ids_matching_text(v_q, v_status <> 'open');
    v_where := v_where || ' and p.id = any ($9)';
  end if;
  if v_f ->> 'audience' = 'following' then
    v_where := v_where || ' and p.owner_id = any ($10)';
  end if;
  if cardinality(v_muted_users) > 0 then
    v_where := v_where || ' and p.owner_id <> all ($11)';
  end if;
  if cardinality(v_muted_words) > 0 then
    v_where := v_where || ' and not exists (select 1 from unnest($12) w (word) where position(w.word'
                       || ' in lower(p.title || '' '' || coalesce(p.description, ''''))) > 0)';
  end if;

  -- Sort-specific parts: the range that bounds the candidates, and the two leading keys.
  if v_sort = 'recommended' then
    select coalesce(jsonb_object_agg(c.config_key, c.value), '{}'::jsonb) into v_cfg
      from public.feed_ranking_config c;
    v_window := (coalesce((v_cfg ->> 'window_hours')::numeric, 24) * 3600)::bigint;
    v_active_worlds := array(select distinct p.world_slug from public.posts p where p.owner_id = v_viewer);
    v_span := make_interval(secs => v_window);
    -- First page: the window holding as_of. Later pages: from the cursor's window down.
    v_lo := to_timestamp(coalesce(v_c_k1, floor(extract(epoch from v_as_of) / v_window)::bigint) * v_window);
    v_hi := to_timestamp((v_c_k1 + 1) * v_window);
    v_where := v_where || ' and p.published_at >= $13 and p.published_at < coalesce($14, ''infinity'')';
    v_k1 := 'floor(extract(epoch from p.published_at) / $16)::bigint';
    v_k2 := 'round(100 * ($17 * (p.owner_id = any ($10))::integer'
         || ' + $18 * (p.world_slug = any ($19))::integer'
         || ' + $20 * coalesce(w.geo_weight / (1 + extensions.st_distance(p.geo_approx, $21) / 25000), 0)'
         || ' + $22 * greatest(coalesce(p.urgency_level, 0) / 3.0,'
         || '                  (p.expires_at <= $1 + interval ''48 hours'')::integer)'
         || ' + $23 * (coalesce(s.comments_count, 0) = 0)::integer))::bigint';
    v_from := ' join public.worlds w on w.slug = p.world_slug'
           || ' left join public.post_stats s on s.post_id = p.id';
  elsif v_sort = 'nearest' then
    v_radius := greatest(v_radius, -coalesce(v_c_k2, 0) + 1);
    v_where := v_where || ' and p.city_id = any ($15)';
    v_k2 := '-floor(extensions.st_distance(pc.location, $21))::bigint';
    v_from := ' join public.cities pc on pc.city_id = p.city_id';
    -- Only rows strictly inside the radius are ranked: a tie group is never split by it.
    v_extra := ' and -c.k2 < $7';
  elsif v_sort = 'newest' then
    if p_cursor is not null then
      v_where := v_where || ' and (p.published_at, p.id) < ($26, $27)';
    end if;
    v_extra := ' order by p.published_at desc, p.id desc limit $28';
  else
    v_k2 := '-(extract(epoch from p.published_at) * 1000000)::bigint';
    if p_cursor is not null then
      v_where := v_where || ' and (p.published_at > $26 or (p.published_at = $26 and p.id < $27))';
    end if;
    v_extra := ' order by p.published_at, p.id desc limit $28';
  end if;

  -- Candidate streams, one per partial index: public open posts, public delivered posts,
  -- and followers-only posts of the viewer and of the people they follow.
  v_branch := '(select p.* from public.posts p where /*audience*/' || v_where
           || case when v_sort in ('newest', 'oldest') then v_extra else '' end || ')';
  v_sql := concat_ws(' union all ',
    case when v_status <> 'closed' then
      replace(v_branch, '/*audience*/', 'p.status = ''open'' and p.visibility = ''Public''') end,
    case when v_status <> 'open' then
      replace(v_branch, '/*audience*/', 'p.status = ''closed_delivered'' and p.visibility = ''Public''') end,
    replace(v_branch, '/*audience*/', 'p.visibility = ''FollowersOnly'' and p.owner_id = any ($10 || $3) and '
      || case v_status when 'open' then 'p.status = ''open'''
                       when 'closed' then 'p.status = ''closed_delivered'''
                       else 'p.status in (''open'', ''closed_delivered'')' end));
  v_sql := 'select coalesce(jsonb_agg(to_jsonb(r)), ''[]''::jsonb) from ('
        || 'select c.id, c.t, c.k1, c.k2 from ('
        || 'select p.id, p.published_at as t, ' || v_k1 || ' as k1, ' || v_k2 || ' as k2'
        || ' from (' || v_sql || ') p' || v_from || ') c'
        || ' where ($27 is null or (c.k1, c.k2, c.t, c.id) < ($24, $25, $26, $27))'
        || case when v_sort = 'nearest' then v_extra else '' end
        || ' order by c.k1 desc, c.k2 desc, c.t desc, c.id desc limit $28) r';

  loop
    if v_sort = 'nearest' then
      v_near_cities := array(select c.city_id from public.cities c
                              where extensions.st_dwithin(c.location, v_origin, v_radius));
    end if;
    execute v_sql into v_page using
      v_as_of, v_worlds, v_viewer, v_f ->> 'direction',                                   -- $1-$4
      array(select jsonb_array_elements_text(v_f -> 'item_subcategory_ids'))::uuid[],     -- $5
      v_filter_cities, v_radius, v_f ->> 'city_id', v_match_ids,                          -- $6-$9
      v_followed, v_muted_users, v_muted_words, v_lo, v_hi, v_near_cities, v_window,      -- $10-$16
      coalesce((v_cfg ->> 'follow_affinity')::numeric, 1),                                -- $17
      coalesce((v_cfg ->> 'active_world')::numeric, 0.5), v_active_worlds,                -- $18-$19
      coalesce((v_cfg ->> 'distance')::numeric, 1), v_origin,                             -- $20-$21
      coalesce((v_cfg ->> 'urgency')::numeric, 0.75),                                     -- $22
      coalesce((v_cfg ->> 'no_response')::numeric, 0.25),                                 -- $23
      v_c_k1, v_c_k2, v_c_t, v_c_id, v_limit;                                             -- $24-$28
    -- A full page is final. Otherwise widen the range fourfold, down to the first post
    -- ever published / out to the whole globe, and rank again.
    exit when jsonb_array_length(v_page) >= v_limit
      or v_sort in ('newest', 'oldest')
      or (v_sort = 'recommended' and v_lo < timestamptz '2020-01-01')
      or (v_sort = 'nearest' and v_radius > 2.1e7);
    v_span := v_span * 4;
    v_lo := v_lo - v_span;
    v_radius := v_radius * 4;
  end loop;

  return query
  select c,
         jsonb_build_object('sort', v_sort, 'as_of', v_as_of, 'k1', r.k1, 'k2', r.k2, 't', r.t, 'id', r.id),
         case when v_sort = 'nearest' then (-r.k2)::integer end
    from jsonb_to_recordset(v_page) as r (id uuid, t timestamptz, k1 bigint, k2 bigint)
    join public.post_cards(array(select (e ->> 'id')::uuid from jsonb_array_elements(v_page) e)) c
      on c.id = r.id
   order by r.k1 desc, r.k2 desc, r.t desc, r.id desc;
end;
$$;
comment on function public.feed_page(jsonb, integer, jsonb) is
  'One page of the main feed, a world feed or post search, as cards, with keyset paging.';
