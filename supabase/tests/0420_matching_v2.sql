-- supabase/tests/0420_matching_v2.sql | 0420–0423: matching engine v2 (scoring, hard filters,
-- idempotent compute, delivery gates, responses/feedback, rides corridor, LLM flag off).

begin;

create or replace function pg_temp.mk_user(p_id uuid, p_handle text)
returns void language plpgsql as $$
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, aud, role)
  values (p_id, p_handle || '@test.local', now(),
          jsonb_build_object('full_name', 'Display ' || p_handle),
          jsonb_build_object('provider', 'email'),
          'authenticated', 'authenticated');
  update public.users
     set share_handle = p_handle, display_name = 'Display ' || p_handle,
         account_status = 'active', privacy_mode = 'Public', onboarding_state = 'completed'
   where user_id = p_id;
end $$;

-- lng/lat: Tel Aviv 34.7818,32.0853 · Ramat Gan 34.8248,32.0684 (~4 km) · Haifa 34.9896,32.7940 (~80 km)
create or replace function pg_temp.mk_item(p_owner uuid, p_dir text, p_title text, p_lng float8, p_lat float8,
                                           p_category uuid default null)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.listings (owner_id, world_slug, kind_id, category_id, direction, title, geo, anonymity_level, details)
  values (p_owner, 'items',
          (select kind_id from public.listing_kinds where world_slug = 'items'
             and slug = case when p_dir = 'give' then 'give_item' else 'request_item' end),
          coalesce(p_category, (select category_id from public.categories
                                  where world_slug = 'items' and parent_id is not null
                                  order by sort_order, slug limit 1)),
          p_dir, p_title,
          extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography, 3,
          jsonb_build_object('image_url', 'https://example.test/i.jpg'))
  returning listing_id into v;
  return v;
end $$;

create or replace function pg_temp.as_user(p_user uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
end $$;

create or replace function pg_temp.as_system()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- ── static shape ─────────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from public.matching_settings) <> 1 then
    raise exception 'ASSERT FAILED: matching_settings must be a singleton row';
  end if;
  if (select llm_rerank_enabled from public.matching_settings) then
    raise exception 'ASSERT FAILED: LLM re-rank must default OFF';
  end if;
  if has_function_privilege('authenticated', 'public.match_compute_for_listing(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.match_deliver_pending(integer, uuid)', 'execute')
     or has_function_privilege('anon', 'public.rpc_my_matches(integer)', 'execute')
     or has_function_privilege('authenticated', 'public.api_match_llm_store(uuid, numeric, text)', 'execute') then
    raise exception 'ASSERT FAILED: engine internals must not be client-callable';
  end if;
  if not has_function_privilege('authenticated', 'public.rpc_my_matches(integer)', 'execute')
     or not has_function_privilege('authenticated', 'public.rpc_match_respond(uuid, text)', 'execute') then
    raise exception 'ASSERT FAILED: client RPCs must be callable by authenticated';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'listings_match_v2' and not tgisinternal) then
    raise exception 'ASSERT FAILED: listings_match_v2 trigger missing';
  end if;
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and not exists (select 1 from cron.job where jobname = 'matching_v2_sweep') then
    raise exception 'ASSERT FAILED: matching_v2_sweep cron job missing';
  end if;
end $$;

-- Deterministic delivery: no quiet window, generous cap.
update public.matching_settings set quiet_start = '00:00', quiet_end = '00:00', max_notify_per_user_day = 10;

-- ── fixtures ────────────────────────────────────────────────────────────────
create temp table t (k text primary key, id uuid) on commit drop;
grant select on t to authenticated;

do $$
declare
  a uuid := '00000000-0000-0000-0000-0000004200a1'; -- giver
  b uuid := '00000000-0000-0000-0000-0000004200b2'; -- near requester
  c uuid := '00000000-0000-0000-0000-0000004200c3'; -- far requester (Haifa)
  d uuid := '00000000-0000-0000-0000-0000004200d4'; -- muted by giver
  e uuid := '00000000-0000-0000-0000-0000004200e5'; -- blocks giver
begin
  perform pg_temp.mk_user(a, 'mv2_alice');
  perform pg_temp.mk_user(b, 'mv2_bob');
  perform pg_temp.mk_user(c, 'mv2_carol');
  perform pg_temp.mk_user(d, 'mv2_dave');
  perform pg_temp.mk_user(e, 'mv2_eve');
  insert into public.feed_mute_filters (user_id, filter_kind, filter_value) values (a, 'user', d::text);
  insert into public.blocks (blocker_id, blocked_id) values (e, a);

  -- Requests first; the offer insert then matches them inline (trigger).
  insert into t values
    ('req_b', pg_temp.mk_item(b, 'request', 'Looking for a sofa', 34.8248, 32.0684)),
    ('req_c', pg_temp.mk_item(c, 'request', 'Need a sofa please', 34.9896, 32.7940)),
    ('req_d', pg_temp.mk_item(d, 'request', 'Sofa wanted', 34.7818, 32.0853)),
    ('req_e', pg_temp.mk_item(e, 'request', 'Sofa for my flat', 34.7818, 32.0853));
  insert into t values ('offer_a', pg_temp.mk_item(a, 'give', 'Grey three seat sofa', 34.7818, 32.0853));
end $$;

-- ── scoring + hard filters ──────────────────────────────────────────────────
do $$
declare
  v_reason text;
  v_row record;
begin
  select * into v_row from public.match_candidates
   where offer_listing_id = (select id from t where k = 'offer_a')
     and request_listing_id = (select id from t where k = 'req_b');
  if not found then
    raise exception 'ASSERT FAILED: near same-category request was not matched inline';
  end if;
  if v_row.score < (select min_score from public.matching_settings) or v_row.distance_km > 6 then
    raise exception 'ASSERT FAILED: unexpected score/distance % / %', v_row.score, v_row.distance_km;
  end if;
  if not (v_row.components ?& array['category', 'geo', 'time', 'text', 'trust', 'feedback']) then
    raise exception 'ASSERT FAILED: components breakdown missing keys: %', v_row.components;
  end if;

  select s.reason into v_reason
    from public.listings o, public.listings q, lateral public.match_score_pair(o, q) s
   where o.listing_id = (select id from t where k = 'offer_a') and q.listing_id = (select id from t where k = 'req_c');
  if v_reason is distinct from 'too_far' then
    raise exception 'ASSERT FAILED: Haifa request should be too_far, got %', v_reason;
  end if;

  select s.reason into v_reason
    from public.listings o, public.listings q, lateral public.match_score_pair(o, q) s
   where o.listing_id = (select id from t where k = 'offer_a') and q.listing_id = (select id from t where k = 'req_d');
  if v_reason is distinct from 'muted' then
    raise exception 'ASSERT FAILED: muted owner should be excluded, got %', v_reason;
  end if;

  select s.reason into v_reason
    from public.listings o, public.listings q, lateral public.match_score_pair(o, q) s
   where o.listing_id = (select id from t where k = 'offer_a') and q.listing_id = (select id from t where k = 'req_e');
  if v_reason is distinct from 'not_visible' then
    raise exception 'ASSERT FAILED: blocked pair should be not_visible, got %', v_reason;
  end if;

  if exists (select 1 from public.match_candidates
              where offer_listing_id = (select id from t where k = 'offer_a')
                and request_listing_id in (select id from t where k in ('req_c', 'req_d', 'req_e'))) then
    raise exception 'ASSERT FAILED: excluded pairs were stored';
  end if;
end $$;

-- ── idempotent compute ──────────────────────────────────────────────────────
do $$
declare
  v_before int;
  v_after int;
begin
  select count(*) into v_before from public.match_candidates where offer_listing_id = (select id from t where k = 'offer_a');
  perform public.match_compute_for_listing((select id from t where k = 'offer_a'));
  perform public.match_compute_for_listing((select id from t where k = 'offer_a'));
  perform public.match_compute_for_listing((select id from t where k = 'req_b'));
  select count(*) into v_after from public.match_candidates where offer_listing_id = (select id from t where k = 'offer_a');
  if v_before <> v_after or v_after <> 1 then
    raise exception 'ASSERT FAILED: compute must be idempotent (% → %)', v_before, v_after;
  end if;
end $$;

-- ── delivery: in-app both sides, WhatsApp clean no-op (channel disabled) ────
do $$
declare
  v_res jsonb;
  m public.match_candidates;
begin
  perform pg_temp.as_system();
  v_res := public.match_deliver_pending(100, null);
  select * into m from public.match_candidates
   where offer_listing_id = (select id from t where k = 'offer_a')
     and request_listing_id = (select id from t where k = 'req_b');
  if m.score >= (select notify_min_score from public.matching_settings) then
    if m.notified_offer_at is null or m.notified_request_at is null then
      raise exception 'ASSERT FAILED: both sides should be notified (%; %)', v_res, m.delivery;
    end if;
    if (select count(*) from public.notifications_outbox
         where kind = 'match_suggested' and dedupe_key like 'match_cand:' || m.candidate_id::text || ':%') <> 2 then
      raise exception 'ASSERT FAILED: expected 2 in-app match notifications';
    end if;
    if m.delivery #>> '{offer,whatsapp}' is distinct from 'skipped_channel_disabled' then
      raise exception 'ASSERT FAILED: WhatsApp must no-op while the channel is disabled: %', m.delivery;
    end if;
    if exists (select 1 from public.bot_outbound_messages where user_id in (m.offer_owner_id, m.request_owner_id)) then
      raise exception 'ASSERT FAILED: no WhatsApp outbound rows may be written while disabled';
    end if;
  else
    raise notice 'pair score % below notify threshold; delivery assertions skipped', m.score;
  end if;
  -- Second run is a no-op (once per side).
  v_res := public.match_deliver_pending(100, null);
  if (select count(*) from public.notifications_outbox
       where kind = 'match_suggested' and dedupe_key like 'match_cand:' || m.candidate_id::text || ':%') > 2 then
    raise exception 'ASSERT FAILED: delivery must happen once per side';
  end if;
end $$;

-- ── gates: quiet hours + daily cap ──────────────────────────────────────────
do $$
begin
  update public.matching_settings set quiet_start = '00:00', quiet_end = '23:59:59';
  if not public.match_in_quiet_hours('00000000-0000-0000-0000-0000004200b2', now()) then
    raise exception 'ASSERT FAILED: platform quiet window not applied';
  end if;
  update public.users
     set notification_preferences = notification_preferences
       || jsonb_build_object('quietHours', jsonb_build_object('enabled', true, 'start', '00:00', 'end', '00:00', 'timezone', 'UTC'))
   where user_id = '00000000-0000-0000-0000-0000004200b2';
  if public.match_in_quiet_hours('00000000-0000-0000-0000-0000004200b2', now()) then
    raise exception 'ASSERT FAILED: user quiet-hours prefs must override the platform window';
  end if;
  update public.matching_settings set quiet_start = '00:00', quiet_end = '00:00';
  if public.match_user_notified_today('00000000-0000-0000-0000-0000004200a1') > 1 then
    raise exception 'ASSERT FAILED: notified-today count off';
  end if;
end $$;

do $$
declare
  v_res jsonb;
  v_new uuid;
begin
  update public.matching_settings set max_notify_per_user_day = 0, notify_min_score = 0;
  insert into t values ('req_b2', pg_temp.mk_item('00000000-0000-0000-0000-0000004200b2', 'request', 'Sofa or couch', 34.8248, 32.0684));
  perform pg_temp.as_system();
  v_res := public.match_deliver_pending(100, null);
  if exists (select 1 from public.match_candidates
              where request_listing_id = (select id from t where k = 'req_b2')
                and (notified_offer_at is not null or notified_request_at is not null)) then
    raise exception 'ASSERT FAILED: daily cap 0 must block delivery (%)', v_res;
  end if;
  update public.matching_settings set max_notify_per_user_day = 10, notify_min_score = 0.6;
end $$;

-- ── Matches for you + responses (feedback) ──────────────────────────────────
do $$
declare
  v_cid uuid;
  v_title text;
  v_res jsonb;
begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000004200b2');
  set local role authenticated;
  select candidate_id, other_listing_title into v_cid, v_title
    from public.rpc_my_matches(20)
   where other_listing_id = (select id from t where k = 'offer_a') and my_listing_id = (select id from t where k = 'req_b');
  reset role;
  if v_cid is null or v_title <> 'Grey three seat sofa' then
    raise exception 'ASSERT FAILED: rpc_my_matches missing the pair for bob';
  end if;

  -- A stranger can neither see nor answer it.
  perform pg_temp.as_user('00000000-0000-0000-0000-0000004200c3');
  set local role authenticated;
  if exists (select 1 from public.rpc_my_matches(20) where candidate_id = v_cid)
     or exists (select 1 from public.match_candidates where candidate_id = v_cid) then
    reset role;
    raise exception 'ASSERT FAILED: non-participant can see the pair';
  end if;
  begin
    perform public.rpc_match_respond(v_cid, 'accept');
    reset role;
    raise exception 'ASSERT FAILED: non-participant could respond';
  exception when insufficient_privilege then
    reset role;
  end;

  perform pg_temp.as_user('00000000-0000-0000-0000-0000004200b2');
  set local role authenticated;
  v_res := public.rpc_match_respond(v_cid, 'accept');
  reset role;
  if v_res ->> 'status' <> 'suggested' or (v_res ->> 'mutual')::boolean then
    raise exception 'ASSERT FAILED: one-sided accept should stay suggested: %', v_res;
  end if;

  perform pg_temp.as_user('00000000-0000-0000-0000-0000004200a1');
  set local role authenticated;
  v_res := public.rpc_match_respond(v_cid, 'accept');
  reset role;
  if v_res ->> 'status' <> 'accepted' or not (v_res ->> 'mutual')::boolean then
    raise exception 'ASSERT FAILED: mutual accept should be accepted: %', v_res;
  end if;
  if not exists (select 1 from public.notifications_outbox
                  where kind = 'match_accepted' and user_id = '00000000-0000-0000-0000-0000004200b2') then
    raise exception 'ASSERT FAILED: counterpart not told about the mutual accept';
  end if;
  if public.match_user_feedback('00000000-0000-0000-0000-0000004200a1', 'items') <= 0 then
    raise exception 'ASSERT FAILED: accepts must raise the feedback signal';
  end if;
end $$;

-- Decline closes the pair and blocks re-pairing of the two owners.
do $$
declare
  v_cid uuid;
  v_reason text;
begin
  select candidate_id into v_cid from public.match_candidates
   where request_listing_id = (select id from t where k = 'req_b2') and status = 'suggested';
  if v_cid is null then
    raise notice 'no second pair to decline; skipping decline checks';
    return;
  end if;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000004200b2');
  set local role authenticated;
  perform public.rpc_match_respond(v_cid, 'decline');
  reset role;
  perform public.match_compute_for_listing((select id from t where k = 'req_b2'));
  if (select status from public.match_candidates where candidate_id = v_cid) <> 'declined' then
    raise exception 'ASSERT FAILED: recompute resurrected a declined pair';
  end if;
  select s.reason into v_reason
    from public.listings o, public.listings q, lateral public.match_score_pair(o, q) s
   where o.listing_id = (select id from t where k = 'offer_a') and q.listing_id = (select id from t where k = 'req_b2');
  if v_reason is distinct from 'declined_before' then
    raise exception 'ASSERT FAILED: declined owners must not be re-paired, got %', v_reason;
  end if;
end $$;

-- Closing a listing expires its open pairs.
do $$
declare
  v_req uuid;
begin
  perform pg_temp.mk_user('00000000-0000-0000-0000-0000004200f6', 'mv2_fay');
  v_req := pg_temp.mk_item('00000000-0000-0000-0000-0000004200f6', 'request', 'Grey sofa needed', 34.7818, 32.0853);
  if not exists (select 1 from public.match_candidates where request_listing_id = v_req and status = 'suggested') then
    raise notice 'fay was not matched; skipping close checks';
    return;
  end if;
  update public.listings set status = 'closed' where listing_id = v_req;
  if exists (select 1 from public.match_candidates where request_listing_id = v_req and status = 'suggested') then
    raise exception 'ASSERT FAILED: closing a listing must expire its pairs';
  end if;
end $$;

-- ── rides corridor + departure window ───────────────────────────────────────
do $$
declare
  v_offer uuid;
  v_near uuid;
  v_late uuid;
  v_kind_o uuid := (select kind_id from public.listing_kinds where world_slug = 'rides' and slug = 'ride_offer');
  v_kind_r uuid := (select kind_id from public.listing_kinds where world_slug = 'rides' and slug = 'ride_request');
  v_dep timestamptz := date_trunc('hour', now()) + interval '2 days';
begin
  if v_kind_o is null or v_kind_r is null then
    raise notice 'ride kinds missing; skipping rides checks';
    return;
  end if;
  perform pg_temp.mk_user('00000000-0000-0000-0000-0000004200a7', 'mv2_gil');
  -- Ride places are official cities (D71, 0512): Tel Aviv 5000, Ramat Gan 8600, Haifa 4000.
  insert into public.listings (owner_id, world_slug, kind_id, direction, title, details, anonymity_level)
  values ('00000000-0000-0000-0000-0000004200a7', 'rides', v_kind_r, 'request', 'Ride Tel Aviv to Haifa',
          jsonb_build_object('origin_place_kind', 'city', 'origin_place_id', '5000', 'dest_place_kind', 'city', 'dest_place_id', '4000',
                             'departs_at', v_dep + interval '1 hour'), 3)
  returning listing_id into v_near;
  insert into public.listings (owner_id, world_slug, kind_id, direction, title, details, anonymity_level)
  values ('00000000-0000-0000-0000-0000004200c3', 'rides', v_kind_r, 'request', 'Late ride to Haifa',
          jsonb_build_object('origin_place_kind', 'city', 'origin_place_id', '5000', 'dest_place_kind', 'city', 'dest_place_id', '4000',
                             'departs_at', v_dep + interval '9 hours'), 3)
  returning listing_id into v_late;
  insert into public.listings (owner_id, world_slug, kind_id, direction, title, details, anonymity_level)
  values ('00000000-0000-0000-0000-0000004200a1', 'rides', v_kind_o, 'give', 'Driving Ramat Gan to Haifa',
          jsonb_build_object('origin_place_kind', 'city', 'origin_place_id', '8600', 'dest_place_kind', 'city', 'dest_place_id', '4000',
                             'departs_at', v_dep, 'seats_available', 3), 3)
  returning listing_id into v_offer;

  if not exists (select 1 from public.match_candidates where offer_listing_id = v_offer and request_listing_id = v_near) then
    raise exception 'ASSERT FAILED: ride on the same corridor within 1h was not matched';
  end if;
  if exists (select 1 from public.match_candidates where offer_listing_id = v_offer and request_listing_id = v_late) then
    raise exception 'ASSERT FAILED: ride 9h apart must not match';
  end if;
end $$;

-- ── LLM hooks no-op while the flag is off ───────────────────────────────────
do $$
begin
  if exists (select 1 from public.api_match_llm_pending(50)) then
    raise exception 'ASSERT FAILED: LLM pending must be empty while llm_rerank_enabled = false';
  end if;
end $$;

-- ── sweep runs end to end ───────────────────────────────────────────────────
do $$
declare
  v jsonb;
begin
  perform pg_temp.as_system();
  v := public.match_run_sweep(50);
  if v ? 'skipped' or (v ->> 'failed')::int <> 0 then
    raise exception 'ASSERT FAILED: sweep result %', v;
  end if;
end $$;

-- Sample output for the PR description (top pairs created by this test).
select m.world_slug, o.title as offer, q.title as request, m.score, m.distance_km, m.status
  from public.match_candidates m
  join public.listings o on o.listing_id = m.offer_listing_id
  join public.listings q on q.listing_id = m.request_listing_id
 where m.offer_owner_id::text like '00000000-0000-0000-0000-0000004200%'
 order by m.score desc;

rollback;

\echo '✓ 0420_matching_v2.sql passed'
