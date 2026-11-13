-- 0421_matching_v2_engine | Scoring + compute for matching v2.
--
-- match_score_pair(offer, request) applies hard filters, then scores six 0..1 components:
--   category  same category 1 · sibling (non-root parent) 0.7 · unknown 0.5 · different 0.1
--   geo       PostGIS distance vs effective radius (effective_geo, owner prefs); rides use
--             origin↔origin + destination↔destination; 'remote' worlds never cut on distance
--   time      overlapping time windows (rides: departure within 6h); one side open-ended 0.6
--   text      pg_trgm similarity of titles / summaries (Hebrew-safe, no stemming)
--   trust     both owners' combined trust (handoff + match ratings) + verified bonus
--   feedback  both owners' accept/decline tendency in this world (accept/decline feeds back)
-- Hard filters: same world, opposite direction, both open + published + unexpired, active
-- owners, each listing visible to the other owner (blocks, followers-only, operator-only),
-- no mutes/hides either way, no earlier decline between the two owners, geo radius, time
-- overlap, ride seats left, items/food category mismatch without textual overlap.

begin;

create or replace function public.match_listing_anchor(p_listing public.listings)
returns extensions.geography
language sql
stable
security definer
set search_path = public, extensions
as $$
  select case
    when p_listing.details ? 'origin_lat' and p_listing.details ? 'origin_lng' then
      st_setsrid(st_makepoint((p_listing.details ->> 'origin_lng')::float8,
                              (p_listing.details ->> 'origin_lat')::float8), 4326)::geography
    else coalesce(p_listing.geo, public.listing_geo_from_city(p_listing.city_id))
  end;
$$;

create or replace function public.match_listing_dest(p_listing public.listings)
returns extensions.geography
language sql
stable
security definer
set search_path = public, extensions
as $$
  select case
    when p_listing.details ? 'dest_lat' and p_listing.details ? 'dest_lng' then
      st_setsrid(st_makepoint((p_listing.details ->> 'dest_lng')::float8,
                              (p_listing.details ->> 'dest_lat')::float8), 4326)::geography
    when p_listing.details ? 'dest_city_id' then
      public.listing_geo_from_city(p_listing.details ->> 'dest_city_id')
    else null
  end;
$$;

create or replace function public.match_listing_window(p_listing public.listings)
returns tstzrange
language sql
stable
set search_path = public
as $$
  select coalesce(
    p_listing.time_window,
    case when p_listing.details ? 'departs_at' then
      tstzrange((p_listing.details ->> 'departs_at')::timestamptz,
                (p_listing.details ->> 'departs_at')::timestamptz + interval '1 hour', '[)')
    end
  );
$$;

-- Viewer's #985 mutes / hides applied to a listing (user, world/category, keyword, hidden post).
create or replace function public.match_user_mutes_listing(p_user uuid, p_listing public.listings)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
           select 1
             from public.feed_mute_filters mf
             left join public.categories c on c.category_id = p_listing.category_id
            where mf.user_id = p_user
              and (
                (mf.filter_kind = 'user' and mf.filter_value = p_listing.owner_id::text)
                or (mf.filter_kind in ('world', 'category')
                    and mf.filter_value in (p_listing.world_slug,
                                            coalesce(c.slug, ''),
                                            coalesce(c.legacy_post_category, '')))
                or (mf.filter_kind = 'keyword' and (
                      p_listing.title ilike '%' || public.escape_ilike(mf.filter_value) || '%' escape '\'
                      or coalesce(p_listing.summary, '') ilike '%' || public.escape_ilike(mf.filter_value) || '%' escape '\'))
              )
         )
      or (p_listing.legacy_post_id is not null and exists (
           select 1 from public.feed_post_hides h
            where h.user_id = p_user and h.post_id = p_listing.legacy_post_id));
$$;

create or replace function public.match_user_trust(p_user uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select least(1.0,
           coalesce((select t.combined_trust_score from public.giving_user_trust_score t
                      where t.user_id = p_user), 0.5)
           + case when exists (select 1 from public.users u
                                where u.user_id = p_user and u.verified_at is not null)
                  then 0.15 else 0 end)::numeric;
$$;

-- Accept/decline tendency in a world, -1..1 (Laplace-smoothed; 0 with no history).
create or replace function public.match_user_feedback(p_user uuid, p_world text)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  with r as (
    select case when m.offer_owner_id = p_user then m.offer_response else m.request_response end as resp
      from public.match_candidates m
     where m.world_slug = p_world
       and (m.offer_owner_id = p_user or m.request_owner_id = p_user)
  )
  select ((count(*) filter (where resp = 'accepted') - count(*) filter (where resp = 'declined'))::numeric
          / (count(*) filter (where resp is not null) + 2))
    from r;
$$;

create or replace function public.match_owners_declined(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.match_candidates m
     where m.status = 'declined'
       and ((m.offer_owner_id = p_a and m.request_owner_id = p_b)
         or (m.offer_owner_id = p_b and m.request_owner_id = p_a))
  );
$$;

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
  if p_offer.world_slug = 'rides' and p_offer.details ? 'seats_available'
     and coalesce((p_offer.details ->> 'seats_available')::int, 0) <= 0 then
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

  -- ── text ────────────────────────────────────────────────────────────────────
  s_text := greatest(
    similarity(lower(p_offer.title), lower(p_request.title)),
    word_similarity(lower(p_request.title), lower(p_offer.title || ' ' || coalesce(p_offer.summary, ''))),
    word_similarity(lower(p_offer.title), lower(p_request.title || ' ' || coalesce(p_request.summary, '')))
  );

  if p_offer.world_slug in ('items', 'food') and s_cat <= 0.1 and s_text < 0.3 then
    reason := 'category_mismatch'; return next; return;
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
      -- Corridor: both ends within 25 km (or the radius if tighter).
      v_rad := least(v_rad, 25);
      if public.match_listing_dest(p_offer) is not null and public.match_listing_dest(p_request) is not null then
        d2_km := (st_distance(public.match_listing_dest(p_offer), public.match_listing_dest(p_request)) / 1000.0)::numeric;
      else
        d2_km := null;
      end if;
      if d_km > v_rad or coalesce(d2_km, 0) > v_rad then
        reason := 'too_far'; return next; return;
      end if;
      s_geo := greatest(0, 1 - ((d_km + coalesce(d2_km, v_rad / 2)) / 2) / v_rad);
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
  if p_offer.world_slug = 'rides' and p_offer.details ? 'departs_at' and p_request.details ? 'departs_at' then
    v_dep_h := abs(extract(epoch from ((p_offer.details ->> 'departs_at')::timestamptz
                                       - (p_request.details ->> 'departs_at')::timestamptz)) / 3600.0);
    if v_dep_h > 6 then
      reason := 'time_mismatch'; return next; return;
    end if;
    s_time := greatest(0, 1 - v_dep_h / 6);
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
    'weights', v_w
  );
  return next;
end;
$$;

comment on function public.match_score_pair(public.listings, public.listings) is
  'Matching v2: hard filters + weighted 0..1 score for an offer/request pair. Internal (no client grant).';

-- Compute (idempotent) the top candidates for one listing and upsert them.
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
  -- Cheap pre-score (category / title trigram / distance) so only the best few pay for the
  -- full scorer (visibility, mutes, trust, feedback lookups).
  pre as (
    select x.c,
           (case when (x.c).category_id = v_src.category_id then 1.0
                 when (x.c).category_id is null or v_src.category_id is null then 0.5
                 else 0.2 end) * 0.4
           + similarity(lower((x.c).title), lower(v_src.title)) * 0.3
           + case when v_anchor is null or public.match_listing_anchor(x.c) is null then 0.15
                  else greatest(0, 1 - st_distance(public.match_listing_anchor(x.c), v_anchor) / v_rad_m) * 0.3
             end as pre_score
      from cand x
     order by 2 desc
     limit greatest(v_set.max_candidates_per_listing * 3, 30)
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

  -- Unanswered pairs of this listing that were not refreshed: withdraw only if they are no
  -- longer eligible (a pair may sit outside this listing's top N but inside the other's).
  update public.match_candidates m
     set status = 'withdrawn'
   where m.status = 'suggested'
     and m.computed_at < v_started
     and m.offer_response is null and m.request_response is null
     and (m.offer_listing_id = p_listing_id or m.request_listing_id = p_listing_id)
     and not exists (
       select 1
         from public.listings o, public.listings r,
              lateral public.match_score_pair(o, r) s
        where o.listing_id = m.offer_listing_id
          and r.listing_id = m.request_listing_id
          and s.eligible and s.score >= v_set.min_score
     );

  insert into public.match_listing_state (listing_id, computed_at, candidates)
  values (p_listing_id, now(), v_n)
  on conflict (listing_id) do update set computed_at = now(), candidates = v_n, last_error = null;

  return v_n;
end;
$$;

comment on function public.match_compute_for_listing(uuid) is
  'Matching v2: idempotent upsert of the top-N scored candidates for a listing. Service/cron only.';

revoke all on function public.match_listing_anchor(public.listings) from public, anon, authenticated;
revoke all on function public.match_listing_dest(public.listings) from public, anon, authenticated;
revoke all on function public.match_listing_window(public.listings) from public, anon, authenticated;
revoke all on function public.match_user_mutes_listing(uuid, public.listings) from public, anon, authenticated;
revoke all on function public.match_user_trust(uuid) from public, anon, authenticated;
revoke all on function public.match_user_feedback(uuid, text) from public, anon, authenticated;
revoke all on function public.match_owners_declined(uuid, uuid) from public, anon, authenticated;
revoke all on function public.match_score_pair(public.listings, public.listings) from public, anon, authenticated;
revoke all on function public.match_compute_for_listing(uuid) from public, anon, authenticated;
grant execute on function public.match_score_pair(public.listings, public.listings) to service_role;
grant execute on function public.match_compute_for_listing(uuid) to service_role;

commit;
