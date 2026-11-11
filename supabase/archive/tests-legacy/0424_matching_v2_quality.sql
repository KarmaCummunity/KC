-- supabase/tests/0424_matching_v2_quality.sql | 0424–0427: Hebrew-aware text scoring, text-gated
-- items matching + notify floor, rides route corridor / direction / window / seats, kc-dev
-- cleanup guard. Hebrew literals are U&-escaped (source scan); the readable form is in comments.

begin;

create or replace function pg_temp.mk_user(p_id uuid, p_handle text)
returns void language plpgsql as $$
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, aud, role)
  values (p_id, p_handle || '@test.local', now(), jsonb_build_object('full_name', p_handle),
          jsonb_build_object('provider', 'email'), 'authenticated', 'authenticated');
  update public.users
     set share_handle = p_handle, display_name = p_handle,
         account_status = 'active', privacy_mode = 'Public', onboarding_state = 'completed'
   where user_id = p_id;
end $$;

create or replace function pg_temp.mk_item(p_owner uuid, p_dir text, p_title text, p_summary text default null)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.listings (owner_id, world_slug, kind_id, category_id, direction, title, summary, geo, anonymity_level, details)
  values (p_owner, 'items',
          (select kind_id from public.listing_kinds where world_slug = 'items'
             and slug = case when p_dir = 'give' then 'give_item' else 'request_item' end),
          (select category_id from public.categories where world_slug = 'items' and parent_id is not null
            order by sort_order, slug limit 1),
          p_dir, p_title, p_summary,
          extensions.st_setsrid(extensions.st_makepoint(34.7818, 32.0853), 4326)::extensions.geography, 3,
          jsonb_build_object('image_url', 'https://example.test/i.jpg'))
  returning listing_id into v;
  return v;
end $$;

-- The official city whose centre is nearest a point (test fixtures speak in coordinates).
create or replace function pg_temp.nearest_city(p_lat float8, p_lng float8)
returns text language sql stable as $$
  select city_id from public.cities
   where lat is not null and lon is not null
   order by (lat - p_lat) ^ 2 + (lon - p_lng) ^ 2
   limit 1;
$$;

create or replace function pg_temp.mk_ride(p_owner uuid, p_dir text, p_title text,
                                           o_lng float8, o_lat float8, d_lng float8, d_lat float8,
                                           p_dep timestamptz, p_window tstzrange default null,
                                           p_seats int default null, p_passengers int default null)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.listings (owner_id, world_slug, kind_id, direction, title, details, anonymity_level, time_window)
  values (p_owner, 'rides',
          (select kind_id from public.listing_kinds where world_slug = 'rides'
             and slug = case when p_dir = 'give' then 'ride_offer' else 'ride_request' end),
          p_dir, p_title,
          -- Ride places must be official (D71, 0512): each end is the city nearest the given point,
          -- and the canonical-places trigger stores that city's own coordinates.
          jsonb_strip_nulls(jsonb_build_object(
                             'origin_place_kind', 'city', 'origin_place_id', pg_temp.nearest_city(o_lat, o_lng),
                             'dest_place_kind', 'city', 'dest_place_id', pg_temp.nearest_city(d_lat, d_lng),
                             'departs_at', p_dep, 'seats_available', p_seats, 'passengers', p_passengers)),
          3, p_window)
  returning listing_id into v;
  return v;
end $$;

create or replace function pg_temp.reason(p_offer uuid, p_request uuid)
returns text language sql as $$
  select coalesce(s.reason, 'ELIGIBLE')
    from public.listings o, public.listings q, lateral public.match_score_pair(o, q) s
   where o.listing_id = p_offer and q.listing_id = p_request;
$$;

update public.matching_settings set quiet_start = '00:00', quiet_end = '00:00', max_notify_per_user_day = 50;

-- ── tokenizer / stems ───────────────────────────────────────────────────────
do $$
declare
  v jsonb;
begin
  -- "searching: the big sofas" -> stop word and gender slash dropped, prefix + plural stemmed
  if not (public.match_token_stems(U&'\05D4\05E1\05E4\05D5\05EA') && public.match_token_stems(U&'\05E1\05E4\05D4')) then
    raise exception 'ASSERT FAILED: prefix+plural stems (hasapot ~ sapa)';
  end if;
  if not (public.match_token_stems(U&'\05DB\05D9\05E1\05D0\05D5\05EA') && public.match_token_stems(U&'\05DB\05D9\05E1\05D0')) then
    raise exception 'ASSERT FAILED: plural -ot stems (kisaot ~ kise)';
  end if;
  if not (U&'\05E2\05E6\05D9\05E6' = any (public.match_text_tokens(U&'\05E2\05E6\05D9\05E5'))) or not (public.match_token_in(U&'\05E2\05E6\05D9\05E6\05D9\05DD', array[U&'\05E2\05E6\05D9\05E6'])) then
    raise exception 'ASSERT FAILED: final letters folded (atsits ~ atsitsim)';
  end if;
  if public.match_text_tokens(U&'[e2e 2026-10-17T21:01] \05DE\05D7\05E4\05E9/\05EA \05DE\05D3\05E3 \05E1\05E4\05E8\05D9\05DD') <> array[U&'\05DE\05D3\05E4', U&'\05E1\05E4\05E8\05D9\05DE'] then
    raise exception 'ASSERT FAILED: e2e tag / stop words / gender slash not dropped: %',
      public.match_text_tokens(U&'[e2e 2026-10-17T21:01] \05DE\05D7\05E4\05E9/\05EA \05DE\05D3\05E3 \05E1\05E4\05E8\05D9\05DD');
  end if;
  if public.match_text_heads(U&'\05E1\05E4\05D4 \05D0\05D5 \05DB\05D5\05E8\05E1\05D0') <> array[U&'\05E1\05E4\05D4', U&'\05DB\05D5\05E8\05E1\05D0']
     or public.match_text_heads('Sofa for my flat') <> array['sofa']
     or public.match_text_heads('Grey three seat sofa') <> array['sofa'] then
    raise exception 'ASSERT FAILED: head nouns (he first / en last / alternatives)';
  end if;

  -- books (offer) vs book SHELF (request): offer head only a modifier of the request -> 0.25
  v := public.match_text_score(U&'\05E1\05E4\05E8\05D9 \05E7\05E8\05D9\05D0\05D4 \05DC\05D9\05DC\05D3\05D9\05DD', null, U&'\05DE\05D7\05E4\05E9/\05EA \05DE\05D3\05E3 \05E1\05E4\05E8\05D9\05DD', null);
  if (v ->> 'head')::numeric <> 0.25 then
    raise exception 'ASSERT FAILED: books vs bookshelf head should be 0.25: %', v;
  end if;
  v := public.match_text_score(U&'\05E1\05E4\05E8\05D9 \05E7\05E8\05D9\05D0\05D4 \05DC\05D9\05DC\05D3\05D9\05DD', null, U&'\05DE\05D7\05E4\05E9/\05EA: \05E1\05E4\05E8\05D9\05DD \05DC\05D9\05DC\05D3\05D9\05DD', null);
  if (v ->> 'head')::numeric <> 1 or (v ->> 'text')::numeric < 0.8 then
    raise exception 'ASSERT FAILED: books vs books should be a head match: %', v;
  end if;
  v := public.match_text_score(U&'\05DB\05D5\05E8\05E1\05D0', null, U&'\05E1\05E4\05D4 \05D0\05D5 \05DB\05D5\05E8\05E1\05D0', null);
  if (v ->> 'head')::numeric <> 1 then
    raise exception 'ASSERT FAILED: alternative head (sofa OR armchair) missed: %', v;
  end if;
end $$;

-- ── items: text gate + notify floor ─────────────────────────────────────────
create temp table t (k text primary key, id uuid) on commit drop;

do $$
declare
  a uuid := '00000000-0000-0000-0000-0000004240a1';
  b uuid := '00000000-0000-0000-0000-0000004240b2';
  c uuid := '00000000-0000-0000-0000-0000004240c3';
begin
  perform pg_temp.mk_user(a, 'mq_amir');
  perform pg_temp.mk_user(b, 'mq_bat');
  perform pg_temp.mk_user(c, 'mq_chen');
  insert into t values
    ('shelf_req', pg_temp.mk_item(b, 'request', U&'[e2e 2026-10-17T21:01] \05DE\05D7\05E4\05E9/\05EA \05DE\05D3\05E3 \05E1\05E4\05E8\05D9\05DD')),
    ('books_req', pg_temp.mk_item(c, 'request', U&'\05DE\05D7\05E4\05E9/\05EA: \05E1\05E4\05E8\05D9\05DD \05DC\05D9\05DC\05D3\05D9\05DD')),
    ('sofa_req',  pg_temp.mk_item(c, 'request', U&'\05E1\05E4\05D4 \05EA\05DC\05EA \05DE\05D5\05E9\05D1\05D9\05EA')),
    ('books_off', pg_temp.mk_item(a, 'give', U&'\05E1\05E4\05E8\05D9 \05E7\05E8\05D9\05D0\05D4 \05DC\05D9\05DC\05D3\05D9\05DD', U&'\05DB-30 \05E1\05E4\05E8\05D9\05DD \05D1\05E2\05D1\05E8\05D9\05EA')),
    -- living-room set; "sofa" only in the summary -> head 0.5, little overlap -> below notify floor
    ('lounge_off', pg_temp.mk_item(a, 'give', U&'\05E1\05DC\05D5\05DF: \05E9\05D5\05DC\05D7\05DF \05E7\05E4\05D4', U&'\05DB\05D5\05DC\05DC \05E1\05E4\05D4'));
end $$;

do $$
begin
  if pg_temp.reason((select id from t where k = 'books_off'), (select id from t where k = 'shelf_req')) <> 'text_mismatch' then
    raise exception 'ASSERT FAILED: books <-> bookshelf must be text_mismatch, got %',
      pg_temp.reason((select id from t where k = 'books_off'), (select id from t where k = 'shelf_req'));
  end if;
  if exists (select 1 from public.match_candidates where request_listing_id = (select id from t where k = 'shelf_req')) then
    raise exception 'ASSERT FAILED: bookshelf request must have no candidates';
  end if;
  if not exists (select 1 from public.match_candidates
                  where offer_listing_id = (select id from t where k = 'books_off')
                    and request_listing_id = (select id from t where k = 'books_req')) then
    raise exception 'ASSERT FAILED: books <-> books was not matched';
  end if;
  if pg_temp.reason((select id from t where k = 'lounge_off'), (select id from t where k = 'sofa_req')) <> 'ELIGIBLE' then
    raise exception 'ASSERT FAILED: lounge set with a sofa should stay eligible (in-app), got %',
      pg_temp.reason((select id from t where k = 'lounge_off'), (select id from t where k = 'sofa_req'));
  end if;
end $$;

do $$
declare
  v_low  public.match_candidates;
  v_good public.match_candidates;
begin
  update public.matching_settings set notify_min_score = 0, min_score = 0;
  perform public.match_compute_for_listing((select id from t where k = 'sofa_req'));
  perform public.match_compute_for_listing((select id from t where k = 'books_req'));
  perform public.match_deliver_pending(100, null);
  select * into v_low from public.match_candidates
   where offer_listing_id = (select id from t where k = 'lounge_off') and request_listing_id = (select id from t where k = 'sofa_req');
  select * into v_good from public.match_candidates
   where offer_listing_id = (select id from t where k = 'books_off') and request_listing_id = (select id from t where k = 'books_req');
  if v_low.candidate_id is null or (v_low.components ->> 'text')::numeric >= 0.5 then
    raise exception 'ASSERT FAILED: expected a low-text lounge/sofa pair, got %', v_low.components;
  end if;
  if v_low.notified_request_at is not null or v_low.notified_offer_at is not null then
    raise exception 'ASSERT FAILED: pair below notify_min_text must not notify';
  end if;
  if v_good.notified_request_at is null then
    raise exception 'ASSERT FAILED: strong text pair should notify';
  end if;
  update public.matching_settings set notify_min_score = 0.6, min_score = 0.45;
end $$;

-- ── rides: corridor, direction, window, seats ───────────────────────────────
-- lng/lat: Tel Aviv 34.7818,32.0853 · Herzliya 34.8447,32.1663 · Netanya 34.8532,32.3215 · Haifa 34.9896,32.7940
do $$
declare
  d   uuid := '00000000-0000-0000-0000-0000004240d4';
  e   uuid := '00000000-0000-0000-0000-0000004240e5';
  dep timestamptz := date_trunc('hour', now()) + interval '2 days';
  v_off uuid; v_enroute uuid; v_rev uuid; v_win uuid; v_late uuid; v_crowd uuid;
  v_row public.match_candidates;
begin
  perform pg_temp.mk_user(d, 'mq_dor');
  perform pg_temp.mk_user(e, 'mq_eden');
  v_enroute := pg_temp.mk_ride(e, 'request', 'Herzliya to Haifa', 34.8447, 32.1663, 34.9896, 32.7940, dep + interval '20 minutes');
  v_rev     := pg_temp.mk_ride(e, 'request', 'Haifa to Herzliya', 34.9896, 32.7940, 34.8447, 32.1663, dep);
  v_win     := pg_temp.mk_ride(e, 'request', 'Netanya to Haifa, flexible', 34.8532, 32.3215, 34.9896, 32.7940,
                               dep + interval '2 hours', tstzrange(dep + interval '1 hour', dep + interval '4 hours'));
  v_late    := pg_temp.mk_ride(e, 'request', 'Netanya to Haifa, evening', 34.8532, 32.3215, 34.9896, 32.7940,
                               dep + interval '8 hours', tstzrange(dep + interval '7 hours', dep + interval '9 hours'));
  v_crowd   := pg_temp.mk_ride(e, 'request', 'Four of us to Haifa', 34.8447, 32.1663, 34.9896, 32.7940, dep, null, null, 4);
  v_off     := pg_temp.mk_ride(d, 'give', 'Tel Aviv to Haifa', 34.7818, 32.0853, 34.9896, 32.7940, dep, null, 2);

  if pg_temp.reason(v_off, v_enroute) <> 'ELIGIBLE' then
    raise exception 'ASSERT FAILED: en-route rider (Herzliya->Haifa) should match TA->Haifa, got %', pg_temp.reason(v_off, v_enroute);
  end if;
  select * into v_row from public.match_candidates where offer_listing_id = v_off and request_listing_id = v_enroute;
  if v_row.candidate_id is null or v_row.score < 0.6 then
    raise exception 'ASSERT FAILED: en-route rider should be a strong inline match, got %', v_row.score;
  end if;
  if pg_temp.reason(v_off, v_rev) <> 'wrong_direction' then
    raise exception 'ASSERT FAILED: reverse direction expected, got %', pg_temp.reason(v_off, v_rev);
  end if;
  if pg_temp.reason(v_off, v_win) <> 'ELIGIBLE' then
    raise exception 'ASSERT FAILED: departure 1h before a flexible window should match, got %', pg_temp.reason(v_off, v_win);
  end if;
  if pg_temp.reason(v_off, v_late) <> 'time_mismatch' then
    raise exception 'ASSERT FAILED: window 7h later must be time_mismatch, got %', pg_temp.reason(v_off, v_late);
  end if;
  if pg_temp.reason(v_off, v_crowd) <> 'no_seats' then
    raise exception 'ASSERT FAILED: 4 passengers vs 2 seats must be no_seats, got %', pg_temp.reason(v_off, v_crowd);
  end if;
end $$;

-- ── kc-dev cleanup is guarded ───────────────────────────────────────────────
do $$
begin
  if not public.kc_dev_is_e2e_title('[e2e 2026-10-17T21:01] x') or not public.kc_dev_is_e2e_title('e2e-smoke-title')
     or public.kc_dev_is_e2e_title('my e2e notes') then
    raise exception 'ASSERT FAILED: e2e title detection';
  end if;
  if public.kc_dev_is_seeded() then
    raise notice 'kc-dev seed present; skipping the not-seeded guard check';
  elsif public.kc_dev_cleanup_e2e_listings() ->> 'skipped' is distinct from 'not_kc_dev' then
    raise exception 'ASSERT FAILED: cleanup must no-op without the kc-dev seed';
  end if;
  if has_function_privilege('authenticated', 'public.kc_dev_cleanup_e2e_listings(interval)', 'execute')
     or has_function_privilege('authenticated', 'public.match_text_score(text, text, text, text)', 'execute') then
    raise exception 'ASSERT FAILED: new internals must not be client-callable';
  end if;
end $$;

select m.world_slug, o.title as offer, q.title as request, m.score,
       m.components ->> 'text' as text, m.components ->> 'head' as head, m.distance_km
  from public.match_candidates m
  join public.listings o on o.listing_id = m.offer_listing_id
  join public.listings q on q.listing_id = m.request_listing_id
 where m.offer_owner_id::text like '00000000-0000-0000-0000-0000004240%'
 order by m.score desc;

rollback;
