-- 0635_g1_matching_v2_on_posts | G1 step 6a-6c (ADR-006, D-214, issue #1671): matching v2 reads the
-- post of a post-owned listing.
--
--   1. listing_record_of (new, internal, inlinable SQL)  a listing row as its record says: for a
--      post-owned listing (origin 'native' with legacy_post_id: food, rides, housing, time since
--      0554) the post's world,
--      kind, direction (`offer` → `give`), category, details, geo, time window, urgency, expiry,
--      availability, moderation, publication and radius, and its status in the listing's words
--      (listing_status_for_post) — the listing's own status during a moderation hold, whose post
--      status is folded (0628), as 0629 does. Title, summary, city, owner, anonymity level and the
--      timestamps stay the listing's (see 0630 on posts made post-owned by the 0554 backfill). Every
--      other shape comes back unchanged.
--   2. match_compute_for_listing (0425)  the source and every scored candidate are read through 1
--      (a lateral join the planner inlines); the candidate scan stays on the listing's columns and
--      indexes. The pairs it re-scores are read through 1 as well, and only looked up when the
--      listing has such pairs.
--   3. match_run_sweep (0423)  expires and selects listings on their record — the same rule as 1,
--      written as joins on posts so both statements stay set-based.
--   4. rpc_match_refresh_mine (0422)  selects the caller's open listings on their record.
-- match_score_pair (0425) is unchanged: it receives the rows of 1. While post and listing are in
-- step (both syncs write the overlaid fields on every change) the pairs, scores, ranks and states
-- are the same as before, which the test proves with the pre-0635 bodies as oracles. Bodies are the
-- latest definitions copied verbatim; changed lines carry `-- 0635`. Names, arguments, return
-- types and grants are unchanged.

begin;

-- ── 1. A listing as its record says ─────────────────────────────────────────────────────────────
-- An inlinable SQL function (no SECURITY DEFINER, no SET; set-returning, used in FROM as
-- `cross join lateral public.listing_record_of(l) r`), so the planner turns the post lookup into
-- a join instead of a call per row. Its select list is the listings row in column order: a column
-- added to listings must be added here too.
drop function if exists public.listing_record_of(public.listings);
create function public.listing_record_of(p_listing public.listings)
returns setof public.listings
language sql
stable
as $$
  select
         p_listing.listing_id as listing_id,
         p_listing.owner_id as owner_id,
         case when po.post_id is null then p_listing.world_slug else po.world_slug end as world_slug,
         case when po.post_id is null then p_listing.kind_id else coalesce(po.kind_id, p_listing.kind_id) end as kind_id,
         case when po.post_id is null then p_listing.category_id else po.category_id end as category_id,
         case when po.post_id is null then p_listing.direction else case when po.direction = 'request' then 'request' else 'give' end end as direction,
         case when po.post_id is not null and po.moderation_status = 'published'
              then public.listing_status_for_post(po.status) else p_listing.status end as status,
         p_listing.visibility as visibility,
         p_listing.anonymity_level as anonymity_level,
         p_listing.title as title,
         p_listing.summary as summary,
         case when po.post_id is null then p_listing.geo else po.geo end as geo,
         p_listing.city_id as city_id,
         case when po.post_id is null then p_listing.time_window else po.time_window end as time_window,
         case when po.post_id is null then p_listing.expires_at else po.expires_at end as expires_at,
         case when po.post_id is null then p_listing.details else po.details end as details,
         p_listing.external_body_id as external_body_id,
         p_listing.origin as origin,
         p_listing.canonical_id as canonical_id,
         p_listing.legacy_post_id as legacy_post_id,
         p_listing.legacy_ride_id as legacy_ride_id,
         case when po.post_id is null then p_listing.moderation_status else po.moderation_status end as moderation_status,
         case when po.post_id is null then p_listing.published_at else po.published_at end as published_at,
         p_listing.created_at as created_at,
         p_listing.updated_at as updated_at,
         p_listing.embedding as embedding,
         p_listing.embedding_model as embedding_model,
         p_listing.geo_mode_override as geo_mode_override,
         case when po.post_id is null then p_listing.max_radius_km_override else po.max_radius_km_override end as max_radius_km_override,
         p_listing.geo_weight_override as geo_weight_override,
         p_listing.search_vector as search_vector,
         case when po.post_id is null then p_listing.urgency_level else coalesce(po.urgency_level, p_listing.urgency_level) end as urgency_level,
         case when po.post_id is null then p_listing.availability_status else po.availability_status end as availability_status,
         p_listing.beneficiary_org_id as beneficiary_org_id
    from (values (1)) as one (x)
    left join public.posts po
      on po.post_id = p_listing.legacy_post_id
     and p_listing.origin = 'native';
$$;

comment on function public.listing_record_of(public.listings) is
  'G1 (0635): a listing row as its record says — the post''s world, kind, direction, category, details, geo, time window, urgency, expiry, availability, moderation, publication, radius and status (listing words; the listing''s own during a hold) for a post-owned listing; any other listing unchanged. Inlinable SQL; one row.';

revoke all on function public.listing_record_of(public.listings) from public, anon, authenticated;
grant execute on function public.listing_record_of(public.listings) to service_role;

-- ── 2. match_compute_for_listing (0425) ─────────────────────────────────────────────────────────
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

revoke all on function public.match_compute_for_listing(uuid) from public, anon, authenticated;
grant execute on function public.match_compute_for_listing(uuid) to service_role;

-- ── 3. match_run_sweep (0423) ───────────────────────────────────────────────────────────────────
create or replace function public.match_run_sweep(p_batch integer default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_set      public.matching_settings;
  v_expired  integer := 0;
  v_done     integer := 0;
  v_failed   integer := 0;
  v_pairs    integer := 0;
  v_delivery jsonb;
  r          record;
begin
  select * into v_set from public.matching_settings where id;
  if not coalesce(v_set.enabled, false) then
    return jsonb_build_object('skipped', 'disabled');
  end if;

  update public.match_candidates m
     set status = 'expired'
    from public.listings o
    -- 0635: each side's record, as listing_record_of reads it, written as joins so the sweep
    -- 0635: stays set-based (status in the listing's words, the listing's own during a hold).
    left join public.posts op on op.post_id = o.legacy_post_id and o.origin = 'native',  -- 0635
         public.listings q
    left join public.posts qp on qp.post_id = q.legacy_post_id and q.origin = 'native'   -- 0635
   where m.status = 'suggested'
     and o.listing_id = m.offer_listing_id
     and q.listing_id = m.request_listing_id
     and ((case when op.post_id is not null and op.moderation_status = 'published'          -- 0635
                then public.listing_status_for_post(op.status) else o.status end) <> 'open'  -- 0635
          or (case when qp.post_id is not null and qp.moderation_status = 'published'       -- 0635
                   then public.listing_status_for_post(qp.status) else q.status end) <> 'open' -- 0635
          or coalesce(case when op.post_id is null then o.expires_at else op.expires_at end, 'infinity') <= now() -- 0635
          or coalesce(case when qp.post_id is null then q.expires_at else qp.expires_at end, 'infinity') <= now()); -- 0635
  get diagnostics v_expired = row_count;

  for r in
    select l.listing_id
      from public.listings l
      -- 0635: the record (listing_record_of's rule as a join, so the selection stays set-based)
      left join public.posts p on p.post_id = l.legacy_post_id and l.origin = 'native'    -- 0635
      left join public.match_listing_state st on st.listing_id = l.listing_id
     where (case when p.post_id is not null and p.moderation_status = 'published'           -- 0635
                 then public.listing_status_for_post(p.status) else l.status end) = 'open'   -- 0635
       and (case when p.post_id is null then l.moderation_status else p.moderation_status end) = 'published' -- 0635
       and l.anonymity_level > 1
       and (case when p.post_id is null then l.world_slug else p.world_slug end) = any (v_set.worlds) -- 0635
       and coalesce(case when p.post_id is null then l.expires_at else p.expires_at end, 'infinity') > now() -- 0635
       and (st.listing_id is null
            or st.computed_at < l.updated_at
            or st.computed_at < now() - make_interval(hours => v_set.recompute_after_hours))
     order by st.computed_at nulls first, l.created_at desc
     limit coalesce(p_batch, v_set.sweep_batch)
  loop
    begin
      v_pairs := v_pairs + public.match_compute_for_listing(r.listing_id);
      v_done := v_done + 1;
    exception when others then
      v_failed := v_failed + 1;
      insert into public.match_listing_state (listing_id, computed_at, candidates, last_error)
      values (r.listing_id, now(), 0, left(sqlerrm, 500))
      on conflict (listing_id) do update set computed_at = now(), last_error = left(excluded.last_error, 500);
    end;
  end loop;

  v_delivery := public.match_deliver_pending(500, null);

  return jsonb_build_object('expired', v_expired, 'computed', v_done, 'failed', v_failed,
                            'pairs', v_pairs, 'delivery', v_delivery);
end;
$$;

revoke all on function public.match_run_sweep(integer) from public, anon, authenticated;
grant execute on function public.match_run_sweep(integer) to service_role;

-- ── 4. rpc_match_refresh_mine (0422) ────────────────────────────────────────────────────────────
create or replace function public.rpc_match_refresh_mine()
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_n   integer := 0;
  r     record;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;
  for r in
    select l.listing_id
      from public.listings ll                                                            -- 0635
      cross join lateral public.listing_record_of(ll) l                                  -- 0635: the record
      left join public.match_listing_state st on st.listing_id = l.listing_id
     where ll.owner_id = v_uid -- 0635: the owner's listings first (the post's owner is the same)
       and l.status = 'open'
       and (st.computed_at is null or st.computed_at < now() - interval '10 minutes')
     order by l.created_at desc
     limit 20
  loop
    v_n := v_n + public.match_compute_for_listing(r.listing_id);
  end loop;
  return v_n;
end;
$$;

revoke all on function public.rpc_match_refresh_mine() from public, anon;
grant execute on function public.rpc_match_refresh_mine() to authenticated;

commit;
