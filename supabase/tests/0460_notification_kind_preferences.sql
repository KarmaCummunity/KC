-- supabase/tests/0460_notification_kind_preferences.sql | 0460: per-type notification opt-outs
-- (FR-NOTIF-017, KC#1120): the kind predicate, per-key `kinds` merge in the preferences RPC,
-- and match_deliver_pending skipping users who turned match suggestions off.

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

create or replace function pg_temp.mk_item(p_owner uuid, p_dir text, p_title text)
returns uuid language plpgsql as $$
declare v uuid;
begin
  -- Same category and point (Tel Aviv) on both sides so the pair is always scored.
  insert into public.listings (owner_id, world_slug, kind_id, category_id, direction, title, geo, anonymity_level, details)
  values (p_owner, 'items',
          (select kind_id from public.listing_kinds where world_slug = 'items'
             and slug = case when p_dir = 'give' then 'give_item' else 'request_item' end),
          (select category_id from public.categories
            where world_slug = 'items' and parent_id is not null order by sort_order, slug limit 1),
          p_dir, p_title,
          extensions.st_setsrid(extensions.st_makepoint(34.7818, 32.0853), 4326)::extensions.geography, 3,
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

-- ── predicate + grants ──────────────────────────────────────────────────────
do $$
begin
  if not public.notification_kind_enabled(null, 'match_suggested')
     or not public.notification_kind_enabled('{}'::jsonb, 'match_suggested')
     or not public.notification_kind_enabled('{"kinds":{"match_suggested":true}}'::jsonb, 'match_suggested') then
    raise exception 'ASSERT FAILED: a kind must be enabled unless explicitly false';
  end if;
  if public.notification_kind_enabled('{"kinds":{"match_suggested":false}}'::jsonb, 'match_suggested') then
    raise exception 'ASSERT FAILED: explicit false must disable the kind';
  end if;
  if not public.notification_kind_enabled('{"kinds":{"match_suggested":false}}'::jsonb, 'match_accepted') then
    raise exception 'ASSERT FAILED: opting out of one kind must not disable another';
  end if;
  if has_function_privilege('anon', 'public.users_merge_notification_preferences(uuid, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.match_deliver_pending(integer, uuid)', 'execute') then
    raise exception 'ASSERT FAILED: preference merge must stay signed-in only; delivery stays internal';
  end if;
end $$;

-- ── fixtures ────────────────────────────────────────────────────────────────
-- Deterministic delivery: no quiet window, generous cap, every scored pair is notifiable.
update public.matching_settings
   set enabled = true, quiet_start = '00:00', quiet_end = '00:00',
       max_notify_per_user_day = 10, notify_min_score = 0, notify_min_text = 0;

create temp table t (k text primary key, id uuid) on commit drop;

do $$
begin
  perform pg_temp.mk_user('00000000-0000-0000-0000-0000046000a1', 'nk_giver');
  perform pg_temp.mk_user('00000000-0000-0000-0000-0000046000b2', 'nk_optout');
end $$;

-- ── RPC: kinds merge per key, other keys unchanged ─────────────────────────
do $$
declare
  v_me uuid := '00000000-0000-0000-0000-0000046000b2';
  v jsonb;
begin
  perform pg_temp.as_user(v_me);
  v := public.users_merge_notification_preferences(v_me, '{"kinds":{"follow_started":false}}'::jsonb);
  v := public.users_merge_notification_preferences(v_me, '{"kinds":{"match_suggested":false}}'::jsonb);
  if v -> 'kinds' <> '{"follow_started":false,"match_suggested":false}'::jsonb then
    raise exception 'ASSERT FAILED: kinds must merge per key, got %', v -> 'kinds';
  end if;
  v := public.users_merge_notification_preferences(v_me, '{"social":true}'::jsonb);
  if v -> 'kinds' ->> 'match_suggested' is distinct from 'false' or (v ->> 'social')::boolean is not true then
    raise exception 'ASSERT FAILED: a top-level update must keep kinds, got %', v;
  end if;

  begin
    perform public.users_merge_notification_preferences(v_me, '{"kinds":"off"}'::jsonb);
    raise exception 'ASSERT FAILED: a non-object kinds value must be rejected';
  exception when invalid_parameter_value then
    null; -- expected (22023)
  end;

  -- Another user's row is never touched.
  v := public.users_merge_notification_preferences('00000000-0000-0000-0000-0000046000a1',
                                                    '{"kinds":{"match_suggested":false}}'::jsonb);
  if v is not null then
    raise exception 'ASSERT FAILED: the RPC must only write the caller''s row';
  end if;
  perform pg_temp.as_system();
end $$;

-- ── delivery: opted-out side settled silently, other side notified ─────────
do $$
begin
  insert into t values ('req', pg_temp.mk_item('00000000-0000-0000-0000-0000046000b2', 'request', 'Looking for a sofa'));
  insert into t values ('offer', pg_temp.mk_item('00000000-0000-0000-0000-0000046000a1', 'give', 'Grey three seat sofa'));
end $$;

do $$
declare
  v_res jsonb;
  m public.match_candidates;
begin
  perform pg_temp.as_system();
  v_res := public.match_deliver_pending(100, null);
  select * into m from public.match_candidates
   where offer_listing_id = (select id from t where k = 'offer')
     and request_listing_id = (select id from t where k = 'req');
  if not found then
    raise exception 'ASSERT FAILED: fixture pair was not scored';
  end if;

  if m.notified_request_at is null or (m.delivery #>> '{request,opted_out}') is distinct from 'true' then
    raise exception 'ASSERT FAILED: opted-out side must be settled as opted_out (%; %)', v_res, m.delivery;
  end if;
  if m.delivery #> '{request,whatsapp}' is not null then
    raise exception 'ASSERT FAILED: no WhatsApp attempt for an opted-out user: %', m.delivery;
  end if;
  if exists (select 1 from public.notifications_outbox
              where user_id = m.request_owner_id and kind = 'match_suggested') then
    raise exception 'ASSERT FAILED: no in-app/push match alert for an opted-out user';
  end if;

  if m.notified_offer_at is null
     or (select count(*) from public.notifications_outbox
          where user_id = m.offer_owner_id and kind = 'match_suggested'
            and dedupe_key = 'match_cand:' || m.candidate_id::text || ':offer') <> 1 then
    raise exception 'ASSERT FAILED: the side that did not opt out must still be notified (%)', v_res;
  end if;
  if public.match_user_notified_today(m.request_owner_id) <> 0 then
    raise exception 'ASSERT FAILED: opted-out sides must not count toward the daily cap';
  end if;

  -- The insert trigger already delivered inline; re-open the opted-out side so the sweep
  -- path is exercised too and reports it in its result counters.
  update public.match_candidates
     set notified_request_at = null, delivery = delivery - 'request'
   where candidate_id = m.candidate_id;
  v_res := public.match_deliver_pending(100, null);
  if (v_res ->> 'opted_out')::int <> 1 or (v_res ->> 'notified')::int <> 0 then
    raise exception 'ASSERT FAILED: sweep must settle exactly the opted-out side: %', v_res;
  end if;

  -- The match stays visible to the opted-out user ("Matches for you").
  perform pg_temp.as_user(m.request_owner_id);
  set local role authenticated;
  if not exists (select 1 from public.rpc_my_matches(20) x where x.candidate_id = m.candidate_id) then
    raise exception 'ASSERT FAILED: opting out of alerts must not hide the match itself';
  end if;
  reset role;
end $$;

rollback;

\echo '✓ 0460_notification_kind_preferences.sql passed'
