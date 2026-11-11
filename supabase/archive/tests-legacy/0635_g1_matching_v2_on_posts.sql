-- supabase/tests/0635_g1_matching_v2_on_posts.sql | 0635 (G1 step 6a-6c, issue #1671): matching v2
-- reads the post of a post-owned listing (listing_record_of).
--
-- The oracles are the pre-0635 bodies (match_compute_for_listing 0425, match_run_sweep 0423,
-- rpc_match_refresh_mine 0422), copied verbatim as pg_temp functions (the sweep and the refresh call
-- the oracle compute). These functions write, so each run starts from empty match tables, takes a
-- snapshot of match_candidates (pairs, owners, scores, components, distances, statuses) and
-- match_listing_state (candidate counts, errors) as ordered JSON text, and is rolled back; the old
-- and the new run must leave the same snapshot. Shapes: post-owned ride offer and request (create
-- RPC), listing-sourced ride offer and request (direct inserts), an items post and an items request.
-- Stages: created, a post-owned offer held for moderation, paused source and candidate, a fulfilled
-- offer, and a post-owned request whose post diverges from its listing (passengers), which only the
-- new bodies see — the proof that the overlay is read.
-- Runs in a rolled-back transaction.

begin;

create temp table personas as
select kc_test.create_user('m6_driver_a') as driver_a,
       kc_test.create_user('m6_driver_b') as driver_b,
       kc_test.create_user('m6_rider_a')  as rider_a,
       kc_test.create_user('m6_rider_b')  as rider_b,
       kc_test.create_user('m6_giver')    as giver,
       kc_test.create_user('m6_seeker')   as seeker;

-- Listings committed by earlier test files share one transaction's now(), and the sweep orders by
-- created_at with no tiebreaker under a batch limit: break the ties (a microsecond apart, keeping
-- the order of distinct times) so the old and the new sweep pick the same batch.
update public.listings l
   set created_at = l.created_at - r.n * interval '1 microsecond'
  from (select listing_id, row_number() over (partition by created_at order by listing_id) - 1 as n
          from public.listings) r
 where l.listing_id = r.listing_id and r.n > 0;

create temp table fx (name text primary key, listing_id uuid);
grant all on fx to public;

/** The route both rides share, with a departure p_in from now. */
create function pg_temp.ride(p_in interval, p_extra jsonb)
returns jsonb
language sql
as $$ select kc_test.ride_route_tlv_jlm() || jsonb_build_object('departs_at', kc_test.iso_in(p_in)) || p_extra $$;
grant execute on function pg_temp.ride(interval, jsonb) to public;

-- ── Fixture ─────────────────────────────────────────────────────────────────────────────────
do $$
declare
  p personas;
  v_post uuid;
begin
  select * into p from personas;
  perform kc_test.act_as(p.driver_a);
  insert into fx values ('owned_offer', public.create_marketplace_listing(
    p_kind_id => kc_test.listing_kind_id('rides', 'ride_offer'), p_title => 'Tel Aviv to Jerusalem',
    p_details => pg_temp.ride(interval '3 hours', '{"seats_available": 3}'), p_city_id => 'tel-aviv'));
  perform kc_test.act_as(p.rider_a);
  insert into fx values ('owned_request', public.create_marketplace_listing(
    p_kind_id => kc_test.listing_kind_id('rides', 'ride_request'), p_title => 'Need a ride to Jerusalem',
    p_details => pg_temp.ride(interval '3 hours 20 minutes', '{"passengers": 1}'), p_city_id => 'tel-aviv'));
  insert into fx values ('direct_offer', kc_test.create_listing(p.driver_b, 'rides', 'ride_offer', 'give',
    'Driving to Jerusalem', pg_temp.ride(interval '3 hours 10 minutes', '{"seats_available": 2}')));
  insert into fx values ('direct_request', kc_test.create_listing(p.rider_b, 'rides', 'ride_request', 'request',
    'Ride to Jerusalem please', pg_temp.ride(interval '3 hours 30 minutes', '{"passengers": 1}')));

  perform kc_test.act_as(p.giver);
  insert into public.posts (owner_id, type, title, category, city, street, street_number, item_condition)
  values (p.giver, 'Give', 'Grey sofa', 'Furniture', 'tel-aviv', 'Herzl', '1', 'Good')
  returning post_id into v_post;
  insert into fx select 'items_post', listing_id from public.listings where legacy_post_id = v_post;
  insert into fx values ('items_request', kc_test.create_listing(p.seeker, 'items', 'request_item', 'request',
    'Grey sofa needed', '{}'::jsonb));
  update public.listings set category_id = (select category_id from public.listings l join fx using (listing_id) where fx.name = 'items_post')
   where listing_id = (select listing_id from fx where name = 'items_request');
end $$;

-- ── Oracles: the pre-0635 bodies ────────────────────────────────────────────────────────────────

create function pg_temp.old_compute(p_listing_id uuid)
returns integer
language plpgsql
volatile
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
      from cand x
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
        cross join lateral public.match_score_pair(o, r) s
       where m2.status = 'suggested'
         and m2.computed_at < v_started
         and m2.offer_response is null and m2.request_response is null
         and (m2.offer_listing_id = p_listing_id or m2.request_listing_id = p_listing_id)
    ) x
   where m.candidate_id = x.candidate_id;

  insert into public.match_listing_state (listing_id, computed_at, candidates)
  values (p_listing_id, now(), v_n)
  on conflict (listing_id) do update set computed_at = now(), candidates = v_n, last_error = null;

  return v_n;
end;
$$;

create function pg_temp.old_sweep(p_batch integer default null)
returns jsonb
language plpgsql
volatile
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
    from public.listings o, public.listings q
   where m.status = 'suggested'
     and o.listing_id = m.offer_listing_id
     and q.listing_id = m.request_listing_id
     and (o.status <> 'open' or q.status <> 'open'
          or coalesce(o.expires_at, 'infinity') <= now()
          or coalesce(q.expires_at, 'infinity') <= now());
  get diagnostics v_expired = row_count;

  for r in
    select l.listing_id
      from public.listings l
      left join public.match_listing_state st on st.listing_id = l.listing_id
     where l.status = 'open'
       and l.moderation_status = 'published'
       and l.anonymity_level > 1
       and l.world_slug = any (v_set.worlds)
       and (l.expires_at is null or l.expires_at > now())
       and (st.listing_id is null
            or st.computed_at < l.updated_at
            or st.computed_at < now() - make_interval(hours => v_set.recompute_after_hours))
     order by st.computed_at nulls first, l.created_at desc
     limit coalesce(p_batch, v_set.sweep_batch)
  loop
    begin
      v_pairs := v_pairs + pg_temp.old_compute(r.listing_id);
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

create function pg_temp.old_refresh()
returns integer
language plpgsql
volatile
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
      from public.listings l
      left join public.match_listing_state st on st.listing_id = l.listing_id
     where l.owner_id = v_uid
       and l.status = 'open'
       and (st.computed_at is null or st.computed_at < now() - interval '10 minutes')
     order by l.created_at desc
     limit 20
  loop
    v_n := v_n + pg_temp.old_compute(r.listing_id);
  end loop;
  return v_n;
end;
$$;

/** match_candidates and match_listing_state, without ids and timestamps, as ordered JSON text. */
create function pg_temp.snap()
returns text
language sql
as $$
  select coalesce((select jsonb_agg(jsonb_build_object(
            'offer', m.offer_listing_id, 'request', m.request_listing_id, 'offer_owner', m.offer_owner_id,
            'request_owner', m.request_owner_id, 'world', m.world_slug, 'score', m.score, 'components', m.components,
            'distance', m.distance_km, 'status', m.status, 'notified', m.notified_offer_at is not null or m.notified_request_at is not null)
            order by m.offer_listing_id, m.request_listing_id)
           from public.match_candidates m), '[]'::jsonb)::text
      || ' | ' ||
      coalesce((select jsonb_agg(jsonb_build_object('listing', s.listing_id, 'candidates', s.candidates, 'error', s.last_error)
                order by s.listing_id)
           from public.match_listing_state s), '[]'::jsonb)::text;
$$;
grant execute on function pg_temp.snap() to public;

/** One run of the old (oracle) or new bodies from empty match tables; its snapshot; rolled back. */
create function pg_temp.run(p_old boolean, p_kind text)
returns text
language plpgsql
as $$
declare
  v text := '';
  r record;
  p personas;
begin
  select * into p from personas;
  begin
    delete from public.match_candidates;
    delete from public.match_listing_state;
    perform set_config('request.jwt.claims', '', true);
    if p_kind = 'compute' then
      for r in select listing_id from fx order by name loop
        if p_old then perform pg_temp.old_compute(r.listing_id);
        else perform public.match_compute_for_listing(r.listing_id); end if;
      end loop;
    elsif p_kind = 'sweep' then
      v := case when p_old then pg_temp.old_sweep(null) else public.match_run_sweep(null) end::text;
    else
      for r in select unnest(array[p.driver_a, p.driver_b, p.rider_a, p.rider_b, p.giver, p.seeker]) as u loop
        perform kc_test.act_as(r.u);
        v := v || (case when p_old then pg_temp.old_refresh() else public.rpc_match_refresh_mine() end)::text || ',';
      end loop;
    end if;
    v := v || ' | ' || pg_temp.snap();
    raise exception using errcode = 'P0001', message = 'kc_oracle_rollback';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'kc_oracle_rollback' then raise; end if;
  end;
  return v;
end $$;
grant execute on function pg_temp.run(boolean, text) to public;

/** The old and the new bodies leave the same tables, for compute, sweep and refresh. */
create function pg_temp.assert_same(p_stage text)
returns void
language plpgsql
as $$
declare
  v_kind text;
begin
  foreach v_kind in array array['compute', 'sweep', 'refresh'] loop
    perform kc_test.assert_eq(pg_temp.run(false, v_kind), pg_temp.run(true, v_kind), format('%s: %s', p_stage, v_kind));
  end loop;
end $$;
grant execute on function pg_temp.assert_same(text) to public;

-- ── Stages ──────────────────────────────────────────────────────────────────────────────────
do $$
declare
  p personas;
  v_snap text;
begin
  if not exists (select 1 from pg_trigger where tgname = 'posts_sync_listing') then
    perform kc_test.assert_true(true, 'matching v2 sync test skipped after sync triggers dropped (0666)');
    return;
  end if;
  select * into p from personas;
  v_snap := pg_temp.run(false, 'compute');
  perform kc_test.assert_true(position((select listing_id from fx where name = 'owned_request')::text in v_snap) > 0
    and v_snap like '%"status": "suggested"%', 'the fixture matches: the comparisons are not empty');
  perform pg_temp.assert_same('created');

  update public.listings set moderation_status = 'pending_review' where listing_id = (select listing_id from fx where name = 'owned_offer');
  perform pg_temp.assert_same('a post-owned offer held');
  update public.listings set moderation_status = 'published' where listing_id = (select listing_id from fx where name = 'owned_offer');

  perform kc_test.act_as(p.rider_a);
  perform public.pause_my_listing((select listing_id from fx where name = 'owned_request'));
  perform kc_test.act_as(p.driver_b);
  perform public.pause_my_listing((select listing_id from fx where name = 'direct_offer'));
  perform pg_temp.assert_same('a post-owned request and a listing-sourced offer paused');

  perform kc_test.act_as(p.rider_a);
  perform public.resume_my_listing((select listing_id from fx where name = 'owned_request'));
  perform kc_test.act_as(p.driver_b);
  perform public.resume_my_listing((select listing_id from fx where name = 'direct_offer'));
  perform kc_test.act_as(p.driver_a);
  perform public.fulfill_my_listing((select listing_id from fx where name = 'owned_offer'));
  perform pg_temp.assert_same('resumed, a post-owned offer fulfilled');
end $$;

-- ── The overlay is read: a post that diverges from its listing ──────────────────────────────
/** Whether a compute run's snapshot holds the pair (p_offer, p_request). */
create function pg_temp.has_pair(p_snap text, p_offer uuid, p_request uuid)
returns boolean
language sql
as $$
  select exists (select 1 from jsonb_array_elements(split_part(p_snap, ' | ', 2)::jsonb) e
                  where e ->> 'offer' = p_offer::text and e ->> 'request' = p_request::text);
$$;

do $$
declare
  v_offer uuid := (select listing_id from fx where name = 'direct_offer');
  v_request uuid := (select listing_id from fx where name = 'owned_request');
  v_old text;
  v_new text;
begin
  if not exists (select 1 from pg_trigger where tgname = 'posts_sync_listing') then
    perform kc_test.assert_true(true, 'matching v2 sync test skipped after sync triggers dropped (0666)');
    return;
  end if;
  perform kc_test.assert_true(pg_temp.has_pair(pg_temp.run(false, 'compute'), v_offer, v_request), 'the offer and the request match');
  -- The post asks for 5 seats; its listing still says 1 (written with the sync off).
  if exists (select 1 from pg_trigger where tgname = 'posts_sync_listing') then
    alter table public.posts disable trigger posts_sync_listing;
  end if;
  update public.posts set details = details || '{"passengers": 5}'
   where post_id = public.post_id_of_listing(v_request);
  if exists (select 1 from pg_trigger where tgname = 'posts_sync_listing') then
    alter table public.posts enable trigger posts_sync_listing;
  end if;
  perform kc_test.assert_eq(
    (select (details ->> 'passengers') from public.listings where listing_id = v_request), '1', 'the listing still asks for 1');
  v_old := pg_temp.run(true, 'compute');
  v_new := pg_temp.run(false, 'compute');
  perform kc_test.assert_true(pg_temp.has_pair(v_old, v_offer, v_request), 'the listing-only read still pairs them (2 seats for 1)');
  perform kc_test.assert_true(not pg_temp.has_pair(v_new, v_offer, v_request), 'the post''s 5 passengers do not fit 2 seats');
end $$;

-- ── The helper ──────────────────────────────────────────────────────────────────────────────
do $$
declare
  l public.listings;
  r public.listings;
begin
  if not exists (select 1 from pg_trigger where tgname = 'posts_sync_listing') then
    perform kc_test.assert_true(true, 'matching v2 helper test skipped after sync triggers dropped (0666)');
    return;
  end if;
  select * into l from public.listings where listing_id = (select listing_id from fx where name = 'items_post');
  perform kc_test.assert_eq((select rec::text from public.listing_record_of(l) rec), l::text, 'an items listing comes back unchanged');
  select * into l from public.listings where listing_id = (select listing_id from fx where name = 'direct_request');
  perform kc_test.assert_eq((select rec::text from public.listing_record_of(l) rec), l::text, 'a listing-sourced listing comes back unchanged');
  select * into l from public.listings where listing_id = (select listing_id from fx where name = 'owned_offer');
  select * into r from public.listing_record_of(l);
  perform kc_test.assert_eq(r.status, 'closed', 'a fulfilled post reads as a closed listing');
  perform kc_test.assert_eq(r.title, l.title, 'the title stays the listing''s');
  update public.listings set moderation_status = 'pending_review' where listing_id = l.listing_id;
  select * into l from public.listings where listing_id = l.listing_id;
  perform kc_test.assert_eq((select r2.status from public.listing_record_of(l) r2), l.status, 'during a hold the listing keeps its status');
  perform kc_test.assert_true(not has_function_privilege('authenticated', 'public.listing_record_of(public.listings)', 'execute'),
    'the helper is internal');
  perform kc_test.assert_row_count('select 1 from public.listing_record_of(null::public.listings)', 1, 'it returns exactly one row');
end $$;

rollback;
\echo '✓ 0635_g1_matching_v2_on_posts.sql passed'
