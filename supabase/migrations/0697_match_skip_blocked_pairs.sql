-- 0697_match_skip_blocked_pairs | TD-263 / #1698 (FR-MOD-009 AC1, D105): cron-driven match and
-- route alerts run without auth.uid(), so enqueue_notification cannot suppress blocked pairs.
-- Drop blocked owners in match_compute / match_score_pair / find_matches; withdraw stale pairs on
-- delivery sweep; skip ride route alerts between a blocked follower and the ride owner.

begin;

-- ── match_score_pair: explicit bilateral block (hard filter) ─────────────────
-- (body from 0667 + blocked reason; see /tmp extract)

create or replace function public.match_score_pair(p_offer public.listings, p_request public.listings)
returns table (eligible boolean, reason text, score numeric, components jsonb, distance_km numeric)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_set   public.matching_settings;
  v_world public.worlds;
  v_w     jsonb;
  g_o     record;
  g_r     record;
  a_o     geography;
  a_r     geography;
  d_km    numeric;
  d2_km   numeric;
  v_rad   numeric;
  s_cat   numeric := 0.5;
  s_geo   numeric := 0.5;
  s_time  numeric := 0.6;
  s_text  numeric := 0;
  s_trust numeric;
  s_fb    numeric;
  w_o     tstzrange;
  w_r     tstzrange;
  c_o     public.categories;
  c_r     public.categories;
  v_dep_h numeric;
  v_total numeric;
  v_txt   jsonb;
  o2      geography;
  r2      geography;
  v_line  geometry;
  v_route numeric;
  f1      float8;
  f2      float8;
  v_req_w tstzrange;
  v_dep_o timestamptz;
begin
  eligible := false;
  score := 0;
  components := '{}'::jsonb;
  distance_km := null;

  select * into v_set from public.matching_settings where id;

  -- ── hard filters ─────────────────────────────────────────────────────────────
  if p_offer.listing_id is null or p_request.listing_id is null then
    reason := 'missing'; return next; return;
  end if;
  if p_offer.world_slug <> p_request.world_slug
     or not (p_offer.world_slug = any (coalesce(v_set.worlds, array['items','food','rides','time','knowledge']))) then
    reason := 'world'; return next; return;
  end if;
  if p_offer.direction <> 'give' or p_request.direction <> 'request' then
    reason := 'direction'; return next; return;
  end if;
  if p_offer.owner_id = p_request.owner_id then
    reason := 'same_owner'; return next; return;
  end if;
  if p_offer.status <> 'open' or p_request.status <> 'open'
     or p_offer.moderation_status <> 'published' or p_request.moderation_status <> 'published'
     or coalesce(p_offer.expires_at, 'infinity') <= now()
     or coalesce(p_request.expires_at, 'infinity') <= now() then
    reason := 'not_open'; return next; return;
  end if;
  if p_offer.anonymity_level = 1 or p_request.anonymity_level = 1 then
    reason := 'operator_only'; return next; return;
  end if;
  if not public.is_active_member(p_offer.owner_id) or not public.is_active_member(p_request.owner_id) then
    reason := 'inactive_owner'; return next; return;
  end if;
  if not public.is_listing_visible_to(p_offer, p_request.owner_id)
     or not public.is_listing_visible_to(p_request, p_offer.owner_id) then
    reason := 'not_visible'; return next; return;
  end if;
  if public.match_user_mutes_listing(p_request.owner_id, p_offer)
     or public.match_user_mutes_listing(p_offer.owner_id, p_request) then
    reason := 'muted'; return next; return;
  end if;
  if public.match_owners_declined(p_offer.owner_id, p_request.owner_id) then
    reason := 'declined_before'; return next; return;
  end if;
  if public.is_blocked(p_offer.owner_id, p_request.owner_id) then
    reason := 'blocked'; return next; return;
  end if;
  if p_offer.world_slug = 'rides' and p_offer.details ? 'seats_available'
     and coalesce((p_offer.details ->> 'seats_available')::int, 0)
         < greatest(coalesce((p_request.details ->> 'passengers')::int, 1), 1) then
    reason := 'no_seats'; return next; return;
  end if;

  select * into v_world from public.worlds where slug = p_offer.world_slug;
  v_w := coalesce(v_set.weights -> p_offer.world_slug, v_set.weights -> 'default');

  -- ── category ────────────────────────────────────────────────────────────────
  if p_offer.category_id is not null and p_request.category_id is not null then
    if p_offer.category_id = p_request.category_id then
      s_cat := 1.0;
    else
      select * into c_o from public.categories where category_id = p_offer.category_id;
      select * into c_r from public.categories where category_id = p_request.category_id;
      if c_o.parent_id is not null and c_o.parent_id = c_r.parent_id
         and exists (select 1 from public.categories p where p.category_id = c_o.parent_id and p.parent_id is not null) then
        s_cat := 0.7;
      else
        s_cat := 0.1;
      end if;
    end if;
  end if;

  -- ── text (0424: head noun + keyword overlap, Hebrew-aware) ───────────────────
  v_txt := public.match_text_score(p_offer.title, p_offer.summary, p_request.title, p_request.summary);
  s_text := (v_txt ->> 'text')::numeric;

  if p_offer.world_slug in ('items', 'food') then
    if s_cat <= 0.1 and s_text < 0.3 then
      reason := 'category_mismatch'; return next; return;
    end if;
    -- Same category is not enough: the requested thing must be what is offered.
    if (v_txt ->> 'head')::numeric < 0.5 and (v_txt ->> 'trgm')::numeric < 0.5 then
      reason := 'text_mismatch'; return next; return;
    end if;
  end if;

  -- ── geo ─────────────────────────────────────────────────────────────────────
  select * into g_o from public.effective_geo(p_offer, p_offer.owner_id);
  select * into g_r from public.effective_geo(p_request, p_request.owner_id);
  a_o := public.match_listing_anchor(p_offer);
  a_r := public.match_listing_anchor(p_request);
  v_rad := greatest(coalesce(g_o.radius_km, 25), coalesce(g_r.radius_km, 25), 1);

  if a_o is not null and a_r is not null then
    d_km := round((st_distance(a_o, a_r) / 1000.0)::numeric, 2);
    distance_km := d_km;
    if p_offer.world_slug = 'rides' then
      o2 := public.match_listing_dest(p_offer);
      r2 := public.match_listing_dest(p_request);
      if o2 is not null and r2 is not null and st_distance(a_o, o2) > 1000 then
        v_route := (st_distance(a_o, o2) / 1000.0)::numeric;
        v_rad := least(25, greatest(8, 0.15 * v_route));
        v_line := st_makeline(a_o::geometry, o2::geometry);
        d_km := round((st_distance(v_line::geography, a_r) / 1000.0)::numeric, 2);
        d2_km := (st_distance(v_line::geography, r2) / 1000.0)::numeric;
        distance_km := d_km;
        if d_km > v_rad or d2_km > v_rad then
          reason := 'too_far'; return next; return;
        end if;
        f1 := st_linelocatepoint(v_line, a_r::geometry);
        f2 := st_linelocatepoint(v_line, r2::geometry);
        if f1 >= f2 then
          reason := 'wrong_direction'; return next; return;
        end if;
        s_geo := greatest(0, 1 - ((d_km + d2_km) / 2) / v_rad);
      else
        v_rad := least(v_rad, 25);
        if d_km > v_rad then
          reason := 'too_far'; return next; return;
        end if;
        s_geo := greatest(0, 1 - d_km / v_rad);
      end if;
    elsif coalesce(g_o.geo_mode, 'local') = 'remote' and coalesce(g_r.geo_mode, 'local') = 'remote' then
      s_geo := greatest(0.3, 1 - d_km / v_rad);
    else
      if d_km > v_rad then
        reason := 'too_far'; return next; return;
      end if;
      s_geo := greatest(0, 1 - d_km / v_rad);
    end if;
  end if;

  -- ── time ────────────────────────────────────────────────────────────────────
  w_o := public.match_listing_window(p_offer);
  w_r := public.match_listing_window(p_request);
  if p_offer.world_slug = 'rides' and p_offer.details ? 'departs_at'
     and (p_request.details ? 'departs_at' or (p_request.origin = 'native' and w_r is not null)) then
    v_dep_o := (p_offer.details ->> 'departs_at')::timestamptz;
    v_req_w := case when p_request.origin = 'native' and w_r is not null
                        and upper(w_r) - lower(w_r) > interval '1 hour' then w_r end;
    if v_req_w is not null and v_dep_o <@ v_req_w then
      v_dep_h := 0;
    elsif v_req_w is not null then
      v_dep_h := least(abs(extract(epoch from (v_dep_o - lower(v_req_w)))),
                       abs(extract(epoch from (v_dep_o - upper(v_req_w))))) / 3600.0;
    else
      v_dep_h := abs(extract(epoch from (v_dep_o - (p_request.details ->> 'departs_at')::timestamptz))) / 3600.0;
    end if;
    if v_dep_h > 3 then
      reason := 'time_mismatch'; return next; return;
    end if;
    s_time := case when v_dep_h <= 0.5 then 1 else greatest(0, 1 - (v_dep_h - 0.5) / 2.5) end;
  elsif w_o is not null and w_r is not null then
    if not (w_o && w_r) then
      reason := 'time_mismatch'; return next; return;
    end if;
    s_time := 1.0;
  end if;

  -- ── trust + feedback ────────────────────────────────────────────────────────
  s_trust := (public.match_user_trust(p_offer.owner_id) + public.match_user_trust(p_request.owner_id)) / 2;
  if v_world.requires_verification
     and not exists (select 1 from public.users u where u.user_id = p_offer.owner_id and u.verified_at is not null) then
    s_trust := s_trust * 0.6;
  end if;
  s_fb := 0.5 + 0.25 * (public.match_user_feedback(p_offer.owner_id, p_offer.world_slug)
                        + public.match_user_feedback(p_request.owner_id, p_offer.world_slug));

  v_total := coalesce((v_w ->> 'category')::numeric, 0) * s_cat
           + coalesce((v_w ->> 'geo')::numeric, 0) * s_geo
           + coalesce((v_w ->> 'time')::numeric, 0) * s_time
           + coalesce((v_w ->> 'text')::numeric, 0) * s_text
           + coalesce((v_w ->> 'trust')::numeric, 0) * s_trust
           + coalesce((v_w ->> 'feedback')::numeric, 0) * s_fb;

  eligible := true;
  reason := null;
  score := round(least(1, greatest(0, v_total)), 4);
  components := jsonb_build_object(
    'category', round(s_cat, 3), 'geo', round(s_geo, 3), 'time', round(s_time, 3),
    'text', round(s_text::numeric, 3), 'trust', round(s_trust, 3), 'feedback', round(s_fb, 3),
    'head', (v_txt ->> 'head')::numeric, 'overlap', (v_txt ->> 'overlap')::numeric,
    'weights', v_w
  );
  return next;
end;
$$;

revoke all on function public.match_score_pair(public.listings, public.listings) from public, anon, authenticated;
grant execute on function public.match_score_pair(public.listings, public.listings) to service_role;

create or replace function public.effective_geo(
  p_listing public.listings,
  p_viewer uuid default auth.uid()
)
returns table (
  geo_mode text,
  radius_km numeric,
  geo_weight numeric,
  anchor_geo extensions.geography
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_world public.worlds;
  v_prefs public.user_geo_prefs;
begin
  select * into v_world from public.worlds w where w.slug = p_listing.world_slug;

  if p_viewer is not null then
    select * into v_prefs from public.user_geo_prefs u where u.user_id = p_viewer;
  end if;

  geo_mode := coalesce(
    p_listing.geo_mode_override,
    v_prefs.geo_mode,
    v_world.geo_mode,
    'local'
  );

  radius_km := coalesce(
    p_listing.max_radius_km_override,
    v_prefs.default_radius_km,
    v_world.default_radius_km,
    25.00
  );

  geo_weight := coalesce(
    p_listing.geo_weight_override,
    v_prefs.geo_weight,
    v_world.geo_weight,
    1.000
  );

  anchor_geo := coalesce(
    p_listing.geo,
    v_prefs.home_geo,
    public.listing_geo_from_city(p_listing.city_id)
  );

  return next;
end;
$$;
revoke all on function public.match_score_pair(public.listings, public.listings) from public, anon, authenticated;
grant execute on function public.match_score_pair(public.listings, public.listings) to service_role;

-- ── match_compute_for_listing: prefilter blocked owners in the scan ───────

create or replace function public.match_compute_for_listing(p_listing_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_set     public.matching_settings;
  v_src     public.listings;
  v_world   public.worlds;
  v_anchor  geography;
  v_rad_m   double precision;
  v_started timestamptz := clock_timestamp();
  v_n       integer := 0;
begin
  select * into v_set from public.matching_settings where id;
  if not coalesce(v_set.enabled, false) then
    return 0;
  end if;

  select * into v_src from public.listings where listing_id = p_listing_id;
  if not found then
    return 0;
  end if;
  if v_src.origin = 'native' and v_src.legacy_post_id is not null then                -- 0635
    select * into v_src from public.listing_record_of(v_src); -- 0635: a post-owned listing is read from its post
  end if;                                                                               -- 0635

  if v_src.status <> 'open' or v_src.moderation_status <> 'published'
     or not (v_src.world_slug = any (v_set.worlds)) or v_src.anonymity_level = 1 then
    update public.match_candidates
       set status = 'expired'
     where status = 'suggested'
       and (offer_listing_id = p_listing_id or request_listing_id = p_listing_id);
    insert into public.match_listing_state (listing_id, computed_at, candidates)
    values (p_listing_id, now(), 0)
    on conflict (listing_id) do update set computed_at = now(), candidates = 0, last_error = null;
    return 0;
  end if;

  select * into v_world from public.worlds where slug = v_src.world_slug;
  v_anchor := public.match_listing_anchor(v_src);
  -- Index prefilter radius: generous (world default x2, min 30 km); exact cut is in the scorer.
  v_rad_m := greatest(coalesce(v_world.default_radius_km, 25) * 2, 30) * 1000.0;

  with cand as (
    select c
      from public.listings c
     where c.world_slug = v_src.world_slug
       and c.direction <> v_src.direction
       and c.owner_id <> v_src.owner_id
       and not public.is_blocked(v_src.owner_id, c.owner_id)
       and c.status = 'open'
       and c.moderation_status = 'published'
       and c.anonymity_level > 1
       and (c.expires_at is null or c.expires_at > now())
       and (
         v_anchor is null
         or coalesce(v_world.geo_mode, 'local') = 'remote'
         or c.geo is null
         or v_src.world_slug = 'rides'
         or st_dwithin(c.geo, v_anchor, v_rad_m)
       )
     order by c.created_at desc
     limit v_set.scan_limit
  ),
  -- 0635: the scan above stays on the listing's columns (its indexes); each candidate is then read
  -- 0635: from its post when it is post-owned.
  cand_rec as (                                         -- 0635
    select r as c from cand x cross join lateral public.listing_record_of(x.c) r -- 0635
  ),
  -- Cheap pre-score (category / title trigram / distance) so only the best few pay for the
  -- full scorer (visibility, mutes, trust, feedback lookups).
  pre as (
    select x.c,
           case when v_src.world_slug = 'rides' then
             -- origin + destination proximity + departure gap
             0.35 * case when v_anchor is null or public.match_listing_anchor(x.c) is null then 0.5
                         else greatest(0, 1 - st_distance(public.match_listing_anchor(x.c), v_anchor) / 100000.0) end
             + 0.35 * case when public.match_listing_dest(v_src) is null or public.match_listing_dest(x.c) is null then 0.5
                           else greatest(0, 1 - st_distance(public.match_listing_dest(x.c), public.match_listing_dest(v_src)) / 100000.0) end
             + 0.30 * case when not ((x.c).details ? 'departs_at' and v_src.details ? 'departs_at') then 0.5
                           else greatest(0, 1 - abs(extract(epoch from (((x.c).details ->> 'departs_at')::timestamptz
                                                                    - (v_src.details ->> 'departs_at')::timestamptz))) / 43200.0) end
           else
             (case when (x.c).category_id = v_src.category_id then 1.0
                   when (x.c).category_id is null or v_src.category_id is null then 0.5
                   else 0.2 end) * 0.3
             + greatest(similarity(lower((x.c).title), lower(v_src.title)),
                        word_similarity(lower(v_src.title), lower((x.c).title)),
                        word_similarity(lower((x.c).title), lower(v_src.title))) * 0.4
             + case when v_anchor is null or public.match_listing_anchor(x.c) is null then 0.15
                    else greatest(0, 1 - st_distance(public.match_listing_anchor(x.c), v_anchor) / v_rad_m) * 0.3
               end
           end as pre_score
      from cand_rec x -- 0635
     order by 2 desc
     limit greatest(v_set.max_candidates_per_listing * 5, 50)
  ),
  scored as (
    select (x.c).listing_id as cid, (x.c).owner_id as cowner, s.*
      from pre x
      cross join lateral public.match_score_pair(
        case when v_src.direction = 'give' then v_src else x.c end,
        case when v_src.direction = 'give' then x.c else v_src end
      ) s
  ),
  top as (
    select * from scored
     where eligible and score >= v_set.min_score
     order by score desc, cid
     limit v_set.max_candidates_per_listing
  ),
  up as (
    insert into public.match_candidates as m (
      offer_listing_id, request_listing_id, offer_owner_id, request_owner_id, world_slug,
      score, components, distance_km, computed_at
    )
    select case when v_src.direction = 'give' then v_src.listing_id else t.cid end,
           case when v_src.direction = 'give' then t.cid else v_src.listing_id end,
           case when v_src.direction = 'give' then v_src.owner_id else t.cowner end,
           case when v_src.direction = 'give' then t.cowner else v_src.owner_id end,
           v_src.world_slug, t.score, t.components, t.distance_km, clock_timestamp()
      from top t
    on conflict (offer_listing_id, request_listing_id) do update
       set score = excluded.score,
           components = excluded.components,
           distance_km = excluded.distance_km,
           computed_at = excluded.computed_at,
           status = case when m.status in ('expired', 'withdrawn') then 'suggested' else m.status end
     where m.status not in ('accepted', 'declined')
    returning 1
  )
  select count(*) into v_n from up;

  -- 0635: only when such pairs exist, so a listing without any does not plan the re-score.
  if exists (select 1 from public.match_candidates m2                                  -- 0635
              where m2.status = 'suggested' and m2.computed_at < v_started             -- 0635
                and (m2.offer_listing_id = p_listing_id or m2.request_listing_id = p_listing_id)) then -- 0635
    -- Unanswered pairs of this listing that were not refreshed: re-score them (a pair may sit
    -- outside this listing's top N but inside the other's); withdraw the ones that no longer
    -- qualify and refresh the score of the rest.
    update public.match_candidates m
       set status = case when x.eligible and x.score >= v_set.min_score then m.status else 'withdrawn' end,
           score = case when x.eligible then x.score else m.score end,
           components = case when x.eligible then x.components else m.components end,
           distance_km = case when x.eligible then x.distance_km else m.distance_km end,
           computed_at = clock_timestamp()
      from (
        select m2.candidate_id, s.eligible, s.score, s.components, s.distance_km
          from public.match_candidates m2
          join public.listings o on o.listing_id = m2.offer_listing_id
          join public.listings r on r.listing_id = m2.request_listing_id
          cross join lateral public.listing_record_of(o) ro                     -- 0635: the records
          cross join lateral public.listing_record_of(r) rr                     -- 0635
          cross join lateral public.match_score_pair(ro, rr) s                  -- 0635
         where m2.status = 'suggested'
           and m2.computed_at < v_started
           and m2.offer_response is null and m2.request_response is null
           and (m2.offer_listing_id = p_listing_id or m2.request_listing_id = p_listing_id)
      ) x
     where m.candidate_id = x.candidate_id;
  end if; -- 0635

  insert into public.match_listing_state (listing_id, computed_at, candidates)
  values (p_listing_id, now(), v_n)
  on conflict (listing_id) do update set computed_at = now(), candidates = v_n, last_error = null;

  return v_n;
end;
$$;


-- ── find_matches (v1 operator path): skip blocked owners ───────────────────

create or replace function public.find_matches(
  p_listing_id uuid,
  p_limit int default 20,
  p_viewer uuid default auth.uid()
)
returns table (
  candidate_listing_id uuid,
  score numeric,
  vector_score numeric,
  fts_score numeric,
  geo_score numeric,
  trust_score numeric,
  match_status text
)
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_src public.listings;
  v_run uuid;
  v_lim int := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_w record;
  v_is_op boolean;
begin
  if p_viewer is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;

  select * into v_src from public.listings where listing_id = p_listing_id;
  if not found then
    raise exception 'listing_not_found' using errcode = 'P0002';
  end if;

  v_is_op := public.is_listing_operator(p_viewer);
  if v_src.owner_id <> p_viewer and not v_is_op then
    raise exception 'not_listing_owner' using errcode = '42501';
  end if;

  if v_src.world_slug = 'romantic_matchmaking' then
    return;
  end if;

  if v_src.world_slug = 'rides' and v_src.legacy_ride_id is not null then
    return query
    select l.listing_id,
           1.0::numeric,
           0.5::numeric, 0.5::numeric, 0.9::numeric, 0.5::numeric,
           case when l.anonymity_level = 1 or v_src.anonymity_level = 1
                then 'operator_queue' else 'suggested' end
      from public.ride_listings_find_matches(v_src.legacy_ride_id, 12, v_lim) r
      join public.listings l on l.legacy_ride_id = r.ride_id
     where public.is_listing_visible_to(l, p_viewer)
       and ((l.anonymity_level > 1 and v_src.anonymity_level > 1) or v_is_op);
    return;
  end if;

  select * into v_w from public.resolve_match_weights(v_src.world_slug, p_viewer) limit 1;

  insert into public.match_runs (source_listing_id, triggered_by)
  values (p_listing_id, p_viewer)
  returning run_id into v_run;

  drop table if exists pg_temp._find_match_ranked;
  execute $sql$
    create temp table pg_temp._find_match_ranked on commit drop as
    with src as (select * from public.listings where listing_id = $1),
    geo_src as (select g.* from src s, lateral public.effective_geo(s, $2) g),
    candidates as (
      select c.* from public.listings c cross join src s
       where c.listing_id <> s.listing_id
         and c.world_slug = s.world_slug
         and c.direction <> s.direction
         and not public.is_blocked(s.owner_id, c.owner_id)
         and c.status = 'open' and c.moderation_status = 'published'
         and public.is_listing_visible_to(c, $2)
    ),
    scored as (
      select c.listing_id as cid,
        case when s.embedding is not null and c.embedding is not null
          then greatest(0, 1 - (s.embedding <=> c.embedding)) else 0.5 end as v_score,
        coalesce(ts_rank(c.search_vector, plainto_tsquery('simple', coalesce(s.title, ''))), 0) as f_score,
        coalesce((
          select case when gs.anchor_geo is null or gc.anchor_geo is null then 0.5
            when extensions.st_distance(gs.anchor_geo, gc.anchor_geo) / 1000.0
                 <= greatest(gs.radius_km, gc.radius_km, 1)
              then greatest(0, 1 - (extensions.st_distance(gs.anchor_geo, gc.anchor_geo) / 1000.0)
                / greatest(gs.radius_km, gc.radius_km, 1)) * ((gs.geo_weight + gc.geo_weight) / 2)
            else 0 end
          from geo_src gs, lateral public.effective_geo(c, $2) gc
        ), 0.5) as g_score,
        coalesce(ts.trust_score, 0.5) as t_score,
        case when c.anonymity_level = 1 or s.anonymity_level = 1 then 'operator_queue' else 'suggested' end as st
      from candidates c cross join src s
      left join public.listing_owner_trust_score ts on ts.user_id = c.owner_id
    )
    select cid,
      ($3 * v_score + $4 * f_score + $5 * g_score + $6 * t_score) as total,
      v_score, f_score, g_score, t_score, st
    from scored
  $sql$
  using p_listing_id, p_viewer,
    coalesce(v_w.w_vector, 0.350), coalesce(v_w.w_fts, 0.250),
    coalesce(v_w.w_geo, 0.250), coalesce(v_w.w_trust, 0.150);

  insert into public.listing_matches (run_id, listing_id, candidate_listing_id, score, status)
  select v_run, least(p_listing_id, cid), greatest(p_listing_id, cid), total, st
    from pg_temp._find_match_ranked
  on conflict (listing_id, candidate_listing_id) do update
    set score = excluded.score, status = excluded.status, run_id = excluded.run_id;

  update public.match_runs
     set finished_at = now(),
         stats = jsonb_build_object('stored', (select count(*) from pg_temp._find_match_ranked))
   where run_id = v_run;

  return query
  select cid, total::numeric, v_score::numeric, f_score::numeric,
         g_score::numeric, t_score::numeric, st::text
    from pg_temp._find_match_ranked
   where st = 'suggested' or v_is_op
   order by total desc
   limit v_lim;
end;
$$;


-- ── match_deliver_pending: withdraw blocked pairs (no session for enqueue) ─

create or replace function public.match_deliver_pending(p_limit integer default 200, p_listing_id uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_set      public.matching_settings;
  v_actor    uuid := auth.uid();
  r          record;
  v_side     text;
  v_user     uuid;
  v_own      public.listings;
  v_other    public.listings;
  v_inapp    uuid;
  v_wa       text;
  v_label_he text;
  v_label_en text;
  v_sent     integer := 0;
  v_deferred integer := 0;
  v_capped   integer := 0;
  v_opted    integer := 0;
  v_blocked  integer := 0;
begin
  select * into v_set from public.matching_settings where id;
  if not coalesce(v_set.enabled, false) then
    return jsonb_build_object('skipped', 'disabled');
  end if;

  for r in
    select m.*
      from public.match_candidates m
      join public.listings o on o.listing_id = m.offer_listing_id
      join public.listings q on q.listing_id = m.request_listing_id
     where m.status = 'suggested'
       and m.score >= v_set.notify_min_score
       and (m.world_slug = 'rides' or coalesce((m.components ->> 'text')::numeric, 0) >= v_set.notify_min_text)
       and (m.notified_offer_at is null or m.notified_request_at is null)
       and greatest(o.created_at, q.created_at) > now() - make_interval(hours => v_set.notify_max_age_hours)
       and (p_listing_id is null or p_listing_id in (m.offer_listing_id, m.request_listing_id))
       and not public.is_blocked(m.offer_owner_id, m.request_owner_id)
     order by m.score desc, m.computed_at desc
     limit greatest(coalesce(p_limit, 200), 1)
     for update of m skip locked
  loop
    if public.is_blocked(r.offer_owner_id, r.request_owner_id) then
      update public.match_candidates
         set status = 'withdrawn', computed_at = clock_timestamp()
       where candidate_id = r.candidate_id and status = 'suggested';
      v_blocked := v_blocked + 1;
      continue;
    end if;

    foreach v_side in array array['offer', 'request'] loop
      if v_side = 'offer' then
        continue when r.notified_offer_at is not null or r.offer_response is not null;
        v_user := r.offer_owner_id;
        select * into v_own from public.listings where listing_id = r.offer_listing_id;
        select * into v_other from public.listings where listing_id = r.request_listing_id;
      else
        continue when r.notified_request_at is not null or r.request_response is not null;
        v_user := r.request_owner_id;
        select * into v_own from public.listings where listing_id = r.request_listing_id;
        select * into v_other from public.listings where listing_id = r.offer_listing_id;
      end if;

      continue when v_actor is not null and v_user = v_actor;

      if not public.notification_kind_enabled(
           (select u.notification_preferences from public.users u where u.user_id = v_user),
           'match_suggested') then
        update public.match_candidates
           set notified_offer_at   = case when v_side = 'offer' then now() else notified_offer_at end,
               notified_request_at = case when v_side = 'request' then now() else notified_request_at end,
               delivery = delivery || jsonb_build_object(v_side, jsonb_build_object('opted_out', true, 'at', now()))
         where candidate_id = r.candidate_id;
        v_opted := v_opted + 1;
        continue;
      end if;

      if public.match_in_quiet_hours(v_user) then
        v_deferred := v_deferred + 1;
        continue;
      end if;
      if public.match_user_notified_today(v_user) >= v_set.max_notify_per_user_day then
        v_capped := v_capped + 1;
        continue;
      end if;

      select w.label_he, w.label_en into v_label_he, v_label_en from public.worlds w where w.slug = r.world_slug;

      v_inapp := public.enqueue_notification(
        v_user, 'social', 'match_suggested',
        'notifications.matchSuggestedTitle', 'notifications.matchSuggestedBody',
        jsonb_build_object('otherTitle', left(v_other.title, 80), 'myTitle', left(v_own.title, 80),
                           'worldHe', coalesce(v_label_he, r.world_slug), 'worldEn', coalesce(v_label_en, r.world_slug)),
        jsonb_build_object('candidate_id', r.candidate_id, 'listing_id', v_own.listing_id, 'route', '/matches',
                           'params', jsonb_build_object('id', r.candidate_id::text)),
        'match_cand:' || r.candidate_id::text || ':' || v_side,
        false
      );

      v_wa := public.match_whatsapp_send(
        v_user, 'match_found_v1',
        jsonb_build_object('candidate_id', r.candidate_id, 'world', r.world_slug, 'role', v_side,
                           'world_label_he', coalesce(v_label_he, r.world_slug),
                           'world_label_en', coalesce(v_label_en, r.world_slug))
      );

      if v_side = 'offer' then
        update public.match_candidates
           set notified_offer_at = now(),
               delivery = delivery || jsonb_build_object('offer', jsonb_build_object(
                 'inapp', v_inapp is not null, 'whatsapp', v_wa, 'at', now()))
         where candidate_id = r.candidate_id;
      else
        update public.match_candidates
           set notified_request_at = now(),
               delivery = delivery || jsonb_build_object('request', jsonb_build_object(
                 'inapp', v_inapp is not null, 'whatsapp', v_wa, 'at', now()))
         where candidate_id = r.candidate_id;
      end if;
      v_sent := v_sent + 1;
    end loop;
  end loop;

  return jsonb_build_object('notified', v_sent, 'deferred_quiet_hours', v_deferred, 'capped', v_capped,
                            'opted_out', v_opted, 'withdrawn_blocked', v_blocked);
end;
$$;

revoke all on function public.match_deliver_pending(integer, uuid) from public, anon, authenticated;
grant execute on function public.match_deliver_pending(integer, uuid) to service_role;

-- ── ride_route_alert_deliver (0623 body + block gate) ─────────────────────

create or replace function public.ride_route_alert_deliver(p_route_id uuid, p_listing_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alert public.ride_route_alerts;
  v_post public.posts;
  v_ride public.ride_post_details;
  v_departs timestamptz;
  v_quiet_end timestamptz;
  v_status text;
begin
  select * into v_alert from public.ride_route_alerts
   where route_id = p_route_id and listing_id = p_listing_id and status = 'pending' for update skip locked;
  if not found then return null; end if;
  select * into v_post from public.posts where post_id = public.post_id_of_listing(p_listing_id);
  select * into v_ride from public.ride_post_details where post_id = v_post.post_id;
  v_departs := v_ride.departs_at;

  if public.is_blocked(v_alert.user_id, v_post.owner_id) then
    update public.ride_route_alerts set status = 'skipped', delivered_at = now()
     where route_id = p_route_id and listing_id = p_listing_id;
    return 'skipped';
  end if;

  if v_post.status is distinct from 'open' or v_departs is null or v_departs <= now() then
    v_status := 'skipped';
  elsif (select count(*) from public.ride_route_alerts a
          where a.user_id = v_alert.user_id and a.status = 'sent'
            and a.delivered_at >= date_trunc('day', now() at time zone 'Asia/Jerusalem') at time zone 'Asia/Jerusalem') >= 10 then
    v_status := 'capped';
  else
    v_quiet_end := public.ride_quiet_window_end(v_alert.user_id);
    if v_quiet_end is not null and v_departs >= v_quiet_end then return 'pending'; end if;
    perform public.enqueue_notification(
      v_alert.user_id, 'critical', 'ride_route_match',
      'notifications.rideRouteMatchTitle', 'notifications.rideRouteMatchBody',
      jsonb_build_object(
        'origin', coalesce(v_ride.origin_label, ''),
        'dest', coalesce(v_ride.dest_label, ''),
        'when', to_char(v_departs at time zone 'Asia/Jerusalem', 'DD/MM HH24:MI')),
      jsonb_build_object('route', '/(tabs)/donations/marketplace/[listingId]',
                         'params', jsonb_build_object('listingId', p_listing_id::text)),
      'ride_route_match:' || v_alert.user_id::text || ':' || p_listing_id::text,
      true);
    v_status := 'sent';
  end if;

  update public.ride_route_alerts set status = v_status, delivered_at = now()
   where route_id = p_route_id and listing_id = p_listing_id;
  return v_status;
end;
$$;

revoke all on function public.ride_route_alert_deliver(uuid, uuid) from public, anon, authenticated;

commit;

