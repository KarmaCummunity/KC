-- Matching · scoring a pair and computing the pairs of a post (docs/SSOT/MATCHING_V2.md)
--
-- All of it is SQL over indexes that already exist: recent posts of the world, full-text
-- tokens, PostGIS distance and the embedding index. Only plain (`standard`) posts are
-- paired here: rides are matched along saved routes by the worlds module (D74), and events,
-- stays, jobs and challenges are joined, not paired.

-- The words of a title as an OR query for the full-text index; null without any word.
create function kc_private.title_tsquery(p_title text)
returns tsquery
language sql
immutable
set search_path = ''
as $$
  select to_tsquery('simple', string_agg(quote_literal(l.lexeme), ' | '))
    from unnest(tsvector_to_array(to_tsvector('simple', coalesce(p_title, '')))) as l (lexeme);
$$;
comment on function kc_private.title_tsquery(text) is 'Full-text query matching any word of the title.';

-- How far apart two posts of a world may be to be paired: twice the world's radius, and at
-- least 30 km. Null for a world where distance does not matter.
create function kc_private.match_distance_limit_m(p_world public.worlds)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select case when p_world.geo_mode <> 'remote'
              then greatest(p_world.default_radius_km * 2, 30)::double precision * 1000 end;
$$;
comment on function kc_private.match_distance_limit_m(public.worlds) is
  'Largest distance in metres at which two posts of the world are paired; null = any.';

-- Scores an offer against a request. Null when the two must never be paired:
--   the same owner · an owner whose account is not active · a block between the owners ·
--   either post not shown to the other owner (not open, "only me", or followers-only
--   without the follow) · the owners declined a pair before · too far apart · neither
--   their words nor their meaning agree (match_weights.min_relevance)
-- Otherwise { score, distance_km, components }: each measurable component is 0..1 and the
-- score is their weighted mean over the components that could be measured.
create function kc_private.match_score_pair(
  p_offer public.posts, p_request public.posts, p_weights kc_private.match_weights, p_world public.worlds)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit_m constant double precision := kc_private.match_distance_limit_m(p_world);
  v_tokens constant text[] := tsvector_to_array(to_tsvector('simple', p_request.title));
  v_distance_m double precision;
  v_text numeric;
  v_vector numeric;
  v_geo numeric;
  v_score numeric;
begin
  if p_offer.owner_id = p_request.owner_id
     or p_offer.status <> 'open' or p_request.status <> 'open'
     or (select count(*) from public.users u
          where u.id in (p_offer.owner_id, p_request.owner_id) and u.is_active) < 2
     or kc_access.is_blocked_between(p_offer.owner_id, p_request.owner_id)
     or not (p_offer.visibility = 'Public' or (p_offer.visibility = 'FollowersOnly' and exists (
               select 1 from public.follows f
                where f.follower_id = p_request.owner_id and f.followed_id = p_offer.owner_id)))
     or not (p_request.visibility = 'Public' or (p_request.visibility = 'FollowersOnly' and exists (
               select 1 from public.follows f
                where f.follower_id = p_offer.owner_id and f.followed_id = p_request.owner_id)))
     or exists (select 1 from kc_private.match_candidates m
                 where m.status = 'declined'
                   and ((m.offer_owner_id = p_offer.owner_id and m.request_owner_id = p_request.owner_id)
                     or (m.offer_owner_id = p_request.owner_id and m.request_owner_id = p_offer.owner_id))) then
    return null;
  end if;

  if p_offer.geo_approx is not null and p_request.geo_approx is not null then
    v_distance_m := extensions.st_distance(p_offer.geo_approx, p_request.geo_approx);
  end if;
  if v_limit_m is null then
    v_geo := 1;
  elsif v_distance_m > v_limit_m then
    return null;
  else
    v_geo := 1 - v_distance_m / v_limit_m;
  end if;

  -- Words: the closer of "the titles look alike" and "the offer mentions what is asked for".
  v_text := greatest(
    extensions.similarity(lower(p_offer.title), lower(p_request.title))::numeric,
    case when cardinality(v_tokens) > 0 then
      (select count(*) from unnest(v_tokens) as t (lexeme)
        where t.lexeme = any (tsvector_to_array(p_offer.search_vector)))::numeric / cardinality(v_tokens)
    else 0 end);
  -- Meaning: cosine similarity, when both posts have their embedding.
  select least(greatest(1 - (o.embedding operator(extensions.<=>) r.embedding), 0), 1)::numeric
    into v_vector
    from public.post_embeddings o, public.post_embeddings r
   where o.post_id = p_offer.id and r.post_id = p_request.id;
  if greatest(v_text, coalesce(v_vector, 0)) < p_weights.min_relevance then
    return null;
  end if;

  select sum(c.weight * c.value) / nullif(sum(c.weight), 0) into v_score
    from (values
      (p_weights.w_category, (p_offer.item_subcategory_id = p_request.item_subcategory_id)::integer::numeric),
      (p_weights.w_text, v_text),
      (p_weights.w_vector, v_vector),
      (p_weights.w_geo, v_geo),
      (p_weights.w_time, (p_offer.time_window && p_request.time_window)::integer::numeric)
    ) as c (weight, value)
   where c.value is not null;

  return jsonb_build_object(
    'score', round(coalesce(v_score, 0), 4),
    'distance_km', round((v_distance_m / 1000)::numeric, 2),
    'components', jsonb_strip_nulls(jsonb_build_object(
      'category', (p_offer.item_subcategory_id = p_request.item_subcategory_id)::integer,
      'text', round(v_text, 4), 'vector', round(v_vector, 4), 'geo', round(v_geo, 4),
      'time', (p_offer.time_window && p_request.time_window)::integer)));
end;
$$;
comment on function kc_private.match_score_pair(public.posts, public.posts, kc_private.match_weights, public.worlds) is
  'Score and components of an offer and request pair, or null when they must not be paired.';

-- Recomputes the pairs of one post and returns how many it holds afterwards.
--   candidates   the newest opposite posts of the world within reach, posts sharing a word
--                with the title, and the posts nearest in meaning — then scored and the
--                best kept (settings: scan_limit, min_score, max_candidates_per_post)
--   upsert       a pair nobody answered is re-scored; an answered pair is never touched
--   expiry       unanswered pairs the run did not keep, and every open pair of a post
--                that is no longer on the air, become `expired`
-- Safe to repeat: the same input gives the same rows.
create function kc_private.match_compute_for_post(p_post_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outer_role constant text := coalesce(current_setting('kc.fsm_role', true), '');
  v_run_at constant timestamptz := clock_timestamp();
  v_settings kc_private.matching_settings;
  v_post public.posts;
  v_weights kc_private.match_weights;
  v_world public.worlds;
  v_embedding extensions.vector;
  v_is_offer boolean;
  v_live boolean;
  v_kept integer := 0;
begin
  select s.* into v_settings from kc_private.matching_settings s;
  select p.* into v_post from public.posts p where p.id = p_post_id;
  if not found or not v_settings.enabled then
    return 0;
  end if;
  v_live := v_post.status = 'open' and v_post.post_type = 'standard';
  v_is_offer := v_post.direction = 'offer';
  perform set_config('kc.fsm_role', 'system', true);

  if v_live then
    select w.* into v_weights from kc_private.match_weights w
     where w.world_slug in (v_post.world_slug, '') order by (w.world_slug <> '') desc limit 1;
    select w.* into v_world from public.worlds w where w.slug = v_post.world_slug;
    select e.embedding into v_embedding from public.post_embeddings e where e.post_id = p_post_id;

    with pool as (
      (select c.id from public.posts c
        where c.status = 'open' and c.world_slug = v_post.world_slug
          and (v_post.geo_approx is null or kc_private.match_distance_limit_m(v_world) is null
               or extensions.st_dwithin(c.geo_approx, v_post.geo_approx, kc_private.match_distance_limit_m(v_world)))
        order by c.published_at desc
        limit v_settings.scan_limit)
      union
      (select c.id from public.posts c
        where c.status = 'open' and c.search_vector @@ kc_private.title_tsquery(v_post.title)
        order by c.published_at desc
        limit 100)
      union
      (select e.post_id from public.post_embeddings e
        where v_embedding is not null
        order by e.embedding operator(extensions.<=>) v_embedding
        limit 100)
    ), scored as (
      select c.id as other_post_id, c.owner_id as other_owner_id, s.pair
        from pool
        join public.posts c on c.id = pool.id
       cross join lateral (
         select case when v_is_offer then kc_private.match_score_pair(v_post, c, v_weights, v_world)
                     else kc_private.match_score_pair(c, v_post, v_weights, v_world) end as pair) s
       where c.world_slug = v_post.world_slug and c.post_type = 'standard'
         and c.direction <> v_post.direction
         and (s.pair ->> 'score')::numeric >= v_settings.min_score
       order by (s.pair ->> 'score')::numeric desc, c.id
       limit v_settings.max_candidates_per_post
    )
    insert into kc_private.match_candidates as m (
      offer_post_id, request_post_id, offer_owner_id, request_owner_id, world_slug,
      score, components, distance_km, computed_at)
    select case when v_is_offer then v_post.id else s.other_post_id end,
           case when v_is_offer then s.other_post_id else v_post.id end,
           case when v_is_offer then v_post.owner_id else s.other_owner_id end,
           case when v_is_offer then s.other_owner_id else v_post.owner_id end,
           v_post.world_slug, (s.pair ->> 'score')::numeric, s.pair -> 'components',
           (s.pair ->> 'distance_km')::numeric, v_run_at
      from scored s
    on conflict on constraint match_candidates_pair_key do update
      set score = excluded.score, components = excluded.components,
          distance_km = excluded.distance_km, computed_at = excluded.computed_at, status = 'suggested'
      where m.status in ('suggested', 'expired')
        and m.offer_response is null and m.request_response is null;
    get diagnostics v_kept = row_count;
  end if;

  update kc_private.match_candidates m
     set status = 'expired'
   where (m.offer_post_id = p_post_id or m.request_post_id = p_post_id)
     and m.status = 'suggested'
     and (not v_live
          or (m.offer_response is null and m.request_response is null and m.computed_at < v_run_at));
  perform set_config('kc.fsm_role', v_outer_role, true);

  insert into kc_private.match_state as s (post_id, computed_at, candidates)
  values (p_post_id, v_run_at, v_kept)
  on conflict (post_id) do update
    set computed_at = excluded.computed_at, candidates = excluded.candidates, last_error = null;
  return v_kept;
end;
$$;
comment on function kc_private.match_compute_for_post(uuid) is
  'Recomputes the matching pairs of one post; returns the number of live pairs it holds.';
