-- supabase/tests/0454_admin_match_quality.sql | 0454: admin match-quality metrics (KC#1122):
-- access control, window clamp, and per-world precision / chat / completion math, measured as
-- deltas over a baseline so seed data cannot skew the assertions.

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

-- ── access control ──────────────────────────────────────────────────────────
do $$
begin
  if has_function_privilege('anon', 'public.admin_match_quality(integer)', 'execute') then
    raise exception 'ASSERT FAILED: anon must not execute admin_match_quality';
  end if;
end $$;

update public.matching_settings
   set enabled = true, quiet_start = '00:00', quiet_end = '00:00',
       max_notify_per_user_day = 10, notify_min_score = 0, notify_min_text = 0;

create temp table t (k text primary key, id uuid) on commit drop;
create temp table baseline on commit drop as select * from public.match_candidates where false;

do $$
begin
  perform pg_temp.mk_user('00000000-0000-0000-0000-0000045400a1', 'mq_giver');
  perform pg_temp.mk_user('00000000-0000-0000-0000-0000045400b2', 'mq_taker');
  perform pg_temp.mk_user('00000000-0000-0000-0000-0000045400c3', 'mq_quiet_giver');
  perform pg_temp.mk_user('00000000-0000-0000-0000-0000045400d4', 'mq_quiet_taker');
  perform pg_temp.mk_user('00000000-0000-0000-0000-0000045400e5', 'mq_admin');
  insert into public.admin_role_grants (user_id, role) values ('00000000-0000-0000-0000-0000045400e5', 'moderator');
  -- Both owners of the second pair opted out of match alerts (0460): never "notified".
  update public.users
     set notification_preferences = notification_preferences || '{"kinds":{"match_suggested":false}}'::jsonb
   where user_id in ('00000000-0000-0000-0000-0000045400c3', '00000000-0000-0000-0000-0000045400d4');
end $$;

do $$
begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000045400b2');
  begin
    perform * from public.admin_match_quality(30);
    raise exception 'ASSERT FAILED: a non-admin must be refused';
  exception when insufficient_privilege then
    null; -- expected (42501)
  end;
  perform pg_temp.as_system();
end $$;

-- Baseline (as admin) before the fixture pairs exist.
create temp table before_q on commit drop as select * from public.admin_match_quality(30) where false;
do $$
begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000045400e5');
  insert into before_q select * from public.admin_match_quality(30);
  perform pg_temp.as_system();
end $$;

-- ── fixtures: alerted pair (accept + chat + handoff) and a fully opted-out pair ──
do $$
declare
  v_a uuid := '00000000-0000-0000-0000-0000045400a1';
  v_b uuid := '00000000-0000-0000-0000-0000045400b2';
  v_chat uuid;
  m public.match_candidates;
begin
  insert into t values ('req', pg_temp.mk_item(v_b, 'request', 'Looking for a sofa'));
  insert into t values ('offer', pg_temp.mk_item(v_a, 'give', 'Grey three seat sofa'));
  insert into t values ('q_req', pg_temp.mk_item('00000000-0000-0000-0000-0000045400d4', 'request', 'Need a bookshelf'));
  insert into t values ('q_offer', pg_temp.mk_item('00000000-0000-0000-0000-0000045400c3', 'give', 'Wooden bookshelf'));

  select * into m from public.match_candidates
   where offer_listing_id = (select id from t where k = 'offer')
     and request_listing_id = (select id from t where k = 'req');
  if m.notified_offer_at is null or m.notified_request_at is null then
    raise exception 'ASSERT FAILED: fixture pair should be alerted on both sides (%)', m.delivery;
  end if;

  if not exists (select 1 from public.match_candidates
                  where offer_listing_id = (select id from t where k = 'q_offer')
                    and request_listing_id = (select id from t where k = 'q_req')
                    and (delivery #>> '{offer,opted_out}') = 'true'
                    and (delivery #>> '{request,opted_out}') = 'true') then
    raise exception 'ASSERT FAILED: the opted-out fixture pair must exist and be settled as opted_out';
  end if;

  -- One accept and one decline → precision 0.5 on this pair.
  update public.match_candidates
     set request_response = 'accepted', request_responded_at = now(),
         offer_response = 'declined', offer_responded_at = now()
   where candidate_id = m.candidate_id;

  insert into public.chats (participant_a, participant_b)
  values (least(v_a, v_b), greatest(v_a, v_b))
  returning chat_id into v_chat;
  insert into public.messages (chat_id, sender_id, kind, body, status, delivered_at)
  values (v_chat, v_b, 'user', 'Is it still available?', 'delivered', now());

  insert into public.giving_handoffs (listing_id, owner_id, recipient_id, world_slug, status, handed_over_at)
  values ((select id from t where k = 'offer'), v_a, v_b, 'items', 'handed_over', now());
end $$;

-- ── metrics ─────────────────────────────────────────────────────────────────
do $$
declare
  b record;
  a record;
begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000045400e5');
  select coalesce(sum(notified_pairs), 0) n, coalesce(sum(responses), 0) r, coalesce(sum(accepted), 0) acc,
         coalesce(sum(chat_pairs), 0) c, coalesce(sum(completed_pairs), 0) d
    into b from before_q where world_slug = 'items';
  select notified_pairs n, responses r, accepted acc, chat_pairs c, completed_pairs d,
         precision_proxy, chat_rate, completion_rate
    into a from public.admin_match_quality(30) where world_slug = 'items';

  if a.n - b.n <> 1 then
    raise exception 'ASSERT FAILED: exactly one new notified pair expected (opted-out pair excluded): % → %', b.n, a.n;
  end if;
  if a.r - b.r <> 2 or a.acc - b.acc <> 1 then
    raise exception 'ASSERT FAILED: responses/accepted deltas off: %/% → %/%', b.r, b.acc, a.r, a.acc;
  end if;
  if a.c - b.c <> 1 or a.d - b.d <> 1 then
    raise exception 'ASSERT FAILED: chat/completion deltas off: %/% → %/%', b.c, b.d, a.c, a.d;
  end if;
  if a.precision_proxy <> round(a.acc::numeric / a.r, 4)
     or a.chat_rate <> round(a.c::numeric / a.n, 4)
     or a.completion_rate <> round(a.d::numeric / a.n, 4) then
    raise exception 'ASSERT FAILED: rates must equal their ratios: %', a;
  end if;
  if exists (select 1 from public.admin_match_quality(30) x
              where x.world_slug not in ('items', 'food', 'rides', 'knowledge')
                and (x.completed_pairs is not null or x.completion_rate is not null)) then
    raise exception 'ASSERT FAILED: completion must be null for worlds without giving handoffs';
  end if;
  -- The window is clamped, so out-of-range arguments still answer.
  perform * from public.admin_match_quality(0);
  perform * from public.admin_match_quality(100000);
  perform pg_temp.as_system();
end $$;

rollback;

\echo '✓ 0454_admin_match_quality.sql passed'
