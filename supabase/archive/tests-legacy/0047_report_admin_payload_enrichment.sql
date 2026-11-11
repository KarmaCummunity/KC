-- supabase/tests/0047_report_admin_payload_enrichment.sql
-- Tests for FR-MOD-001 AC4 + FR-MOD-005 AC3.
-- Verifies:
--   1. report_received system_payload has link_target + target_preview for post/user/chat.
--   2. chat→user mapping resolves the OTHER participant (both directions).
--   3. is_support_thread reports yield link_target=null.
--   4. target_type='none' produces no link_target / target_preview.
--   5. Threshold breach (3 distinct reporters) produces a single auto_removed
--      system message with the same enriched payload structure.
--   6. Regression: only ONE system message per report (the obsolete 0013 trigger
--      is gone — no duplicate kind='report' message).
--
-- Tests create their own users/posts/chats with random UUIDs so they don't
-- collide with seed data and can re-run without cleanup.

create or replace function pg_temp.assert(p_cond boolean, p_msg text)
returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'ASSERT FAILED: %', p_msg; end if;
end $$;

create or replace function pg_temp.mk_user(p_handle text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    id, email, email_confirmed_at,
    raw_user_meta_data, raw_app_meta_data,
    aud, role
  ) values (
    v_id,
    p_handle || '@test.local',
    now(),
    jsonb_build_object('full_name', 'Display ' || p_handle),
    jsonb_build_object('provider', 'email'),
    'authenticated',
    'authenticated'
  );
  -- handle_new_user trigger (0001) created the public.users row with defaults.
  -- Override to test-specific values.
  update public.users
     set share_handle   = p_handle,
         display_name   = 'Display ' || p_handle,
         biography      = 'Bio of ' || p_handle,
         privacy_mode   = 'Public',
         account_status = 'active'
   where user_id = v_id;
  return v_id;
end $$;

-- ─── SETUP: ensure a super admin exists (required by find_or_create_support_chat) ─
do $$
declare
  v_admin_id uuid;
begin
  select user_id into v_admin_id from public.users where is_super_admin = true limit 1;
  if v_admin_id is null then
    -- Create one via the same auth.users → handle_new_user pipeline as mk_user.
    v_admin_id := pg_temp.mk_user('test_super_admin_' || substr(gen_random_uuid()::text,1,8));
    update public.users set is_super_admin = true where user_id = v_admin_id;
    raise notice '✓ SETUP created super admin %', v_admin_id;
  else
    raise notice '✓ SETUP super admin already present: %', v_admin_id;
  end if;
end $$;

-- ───────────────────────────── TEST 1: post report ──────────────────────────
do $$
declare
  v_reporter uuid := pg_temp.mk_user('t1_reporter_' || substr(gen_random_uuid()::text,1,8));
  v_author   uuid := pg_temp.mk_user('t1_author_'   || substr(gen_random_uuid()::text,1,8));
  v_post     uuid;
  v_payload  jsonb;
begin
  insert into public.posts (post_id, owner_id, type, title, description, city, street, street_number)
  values (gen_random_uuid(), v_author, 'Give', 'Test post title', 'A description here',
          (select city_id from public.cities limit 1), 'TestSt', '1')
  returning post_id into v_post;

  insert into public.reports (reporter_id, target_type, target_id, reason)
  values (v_reporter, 'post', v_post, 'Spam');

  select m.system_payload into v_payload
    from public.messages m
    join public.chats c on c.chat_id = m.chat_id
   where c.is_support_thread = true
     and (c.participant_a = v_reporter or c.participant_b = v_reporter)
     and m.system_payload->>'kind' = 'report_received'
   order by m.created_at desc limit 1;

  perform pg_temp.assert(v_payload is not null, 'T1: report_received message missing');
  perform pg_temp.assert(v_payload->'link_target'->>'type' = 'post', 'T1: link_target.type wrong');
  perform pg_temp.assert((v_payload->'link_target'->>'id')::uuid = v_post, 'T1: link_target.id wrong');
  perform pg_temp.assert(v_payload->'target_preview'->>'kind' = 'post', 'T1: target_preview.kind wrong');
  perform pg_temp.assert(v_payload->'target_preview'->>'author_handle' like 't1_author_%', 'T1: author_handle wrong');
  perform pg_temp.assert(position('Test post title' in (v_payload->'target_preview'->>'body_snippet')) > 0, 'T1: body_snippet missing title');
  perform pg_temp.assert((v_payload->'target_preview'->>'has_image')::boolean = false, 'T1: has_image should be false');

  raise notice '✓ T1 post-report enrichment OK';
end $$;

-- ───────────────────────────── TEST 2: user report ──────────────────────────
do $$
declare
  v_reporter uuid := pg_temp.mk_user('t2_reporter_' || substr(gen_random_uuid()::text,1,8));
  v_target   uuid := pg_temp.mk_user('t2_target_'   || substr(gen_random_uuid()::text,1,8));
  v_payload  jsonb;
begin
  insert into public.reports (reporter_id, target_type, target_id, reason)
  values (v_reporter, 'user', v_target, 'Offensive');

  select m.system_payload into v_payload
    from public.messages m
    join public.chats c on c.chat_id = m.chat_id
   where c.is_support_thread = true
     and (c.participant_a = v_reporter or c.participant_b = v_reporter)
     and m.system_payload->>'kind' = 'report_received'
   order by m.created_at desc limit 1;

  perform pg_temp.assert(v_payload->'link_target'->>'type' = 'user', 'T2: link_target.type wrong');
  perform pg_temp.assert((v_payload->'link_target'->>'id')::uuid = v_target, 'T2: link_target.id wrong');
  perform pg_temp.assert(v_payload->'link_target'->>'handle' like 't2_target_%', 'T2: handle wrong');
  perform pg_temp.assert(v_payload->'target_preview'->>'kind' = 'user', 'T2: preview kind wrong');
  perform pg_temp.assert(position('Bio of t2_target' in (v_payload->'target_preview'->>'bio_snippet')) > 0, 'T2: bio_snippet wrong');

  raise notice '✓ T2 user-report enrichment OK';
end $$;

-- ───────────── TEST 3: chat report — counterpart resolution (both sides) ─────
do $$
declare
  v_a uuid := pg_temp.mk_user('t3_a_' || substr(gen_random_uuid()::text,1,8));
  v_b uuid := pg_temp.mk_user('t3_b_' || substr(gen_random_uuid()::text,1,8));
  v_lo uuid; v_hi uuid;
  v_chat uuid;
  v_payload jsonb;
begin
  -- canonical pair order: participant_a < participant_b
  if v_a < v_b then v_lo := v_a; v_hi := v_b; else v_lo := v_b; v_hi := v_a; end if;

  insert into public.chats (chat_id, participant_a, participant_b, is_support_thread)
  values (gen_random_uuid(), v_lo, v_hi, false)
  returning chat_id into v_chat;

  -- Case A: participant_a reports → counterpart should be participant_b
  insert into public.reports (reporter_id, target_type, target_id, reason)
  values (v_lo, 'chat', v_chat, 'Spam');
  select m.system_payload into v_payload
    from public.messages m
    join public.chats c on c.chat_id = m.chat_id
   where c.is_support_thread = true
     and (c.participant_a = v_lo or c.participant_b = v_lo)
     and m.system_payload->>'kind' = 'report_received'
   order by m.created_at desc limit 1;
  perform pg_temp.assert((v_payload->'link_target'->>'id')::uuid = v_hi, 'T3a: counterpart wrong (lo reports → expect hi)');

  -- Case B: participant_b reports → counterpart should be participant_a
  insert into public.reports (reporter_id, target_type, target_id, reason)
  values (v_hi, 'chat', v_chat, 'Spam');
  select m.system_payload into v_payload
    from public.messages m
    join public.chats c on c.chat_id = m.chat_id
   where c.is_support_thread = true
     and (c.participant_a = v_hi or c.participant_b = v_hi)
     and m.system_payload->>'kind' = 'report_received'
   order by m.created_at desc limit 1;
  perform pg_temp.assert((v_payload->'link_target'->>'id')::uuid = v_lo, 'T3b: counterpart wrong (hi reports → expect lo)');

  raise notice '✓ T3 chat counterpart resolution OK';
end $$;

-- ─────────── TEST 4: chat report on a support thread → link_target=null ──────
do $$
declare
  v_user uuid := pg_temp.mk_user('t4_user_' || substr(gen_random_uuid()::text,1,8));
  v_support_chat uuid;
  v_payload jsonb;
begin
  v_support_chat := public.find_or_create_support_chat(v_user);
  perform pg_temp.assert(v_support_chat is not null, 'T4: could not get support chat');

  insert into public.reports (reporter_id, target_type, target_id, reason)
  values (v_user, 'chat', v_support_chat, 'Spam');

  select m.system_payload into v_payload
    from public.messages m
    join public.chats c on c.chat_id = m.chat_id
   where c.chat_id = v_support_chat
     and m.system_payload->>'kind' = 'report_received'
   order by m.created_at desc limit 1;

  perform pg_temp.assert(v_payload->'link_target' = 'null'::jsonb or v_payload->'link_target' is null, 'T4: link_target should be null for support thread');

  raise notice '✓ T4 support-thread report yields null link_target';
end $$;

-- ─────────── TEST 5: target_type='none' (support ticket) — no enrichment ─────
do $$
declare
  v_user uuid := pg_temp.mk_user('t5_user_' || substr(gen_random_uuid()::text,1,8));
  v_payload jsonb;
begin
  insert into public.reports (reporter_id, target_type, target_id, reason, note)
  values (v_user, 'none', null, 'Other', 'support description here');

  select m.system_payload into v_payload
    from public.messages m
    join public.chats c on c.chat_id = m.chat_id
   where c.is_support_thread = true
     and (c.participant_a = v_user or c.participant_b = v_user)
     and m.system_payload->>'kind' = 'report_received'
   order by m.created_at desc limit 1;

  perform pg_temp.assert(v_payload->'link_target' is null or v_payload->'link_target' = 'null'::jsonb, 'T5: target=none should have no link_target');
  perform pg_temp.assert(v_payload->'target_preview' is null or v_payload->'target_preview' = 'null'::jsonb, 'T5: target=none should have no target_preview');

  raise notice '✓ T5 target_type=none produces no enrichment';
end $$;

-- ─────────── TEST 6: threshold breach → auto_removed message with payload ────
do $$
declare
  v_r1 uuid := pg_temp.mk_user('t6_r1_' || substr(gen_random_uuid()::text,1,8));
  v_r2 uuid := pg_temp.mk_user('t6_r2_' || substr(gen_random_uuid()::text,1,8));
  v_r3 uuid := pg_temp.mk_user('t6_r3_' || substr(gen_random_uuid()::text,1,8));
  v_author uuid := pg_temp.mk_user('t6_author_' || substr(gen_random_uuid()::text,1,8));
  v_post uuid;
  v_auto_payload jsonb;
begin
  insert into public.posts (post_id, owner_id, type, title, description, city, street, street_number)
  values (gen_random_uuid(), v_author, 'Give', 'Threshold post', 'desc',
          (select city_id from public.cities limit 1), 'St', '1')
  returning post_id into v_post;

  insert into public.reports (reporter_id, target_type, target_id, reason) values (v_r1, 'post', v_post, 'Spam');
  insert into public.reports (reporter_id, target_type, target_id, reason) values (v_r2, 'post', v_post, 'Spam');
  insert into public.reports (reporter_id, target_type, target_id, reason) values (v_r3, 'post', v_post, 'Spam');

  -- The auto_removed message lives in the 3rd reporter's support thread.
  select m.system_payload into v_auto_payload
    from public.messages m
    join public.chats c on c.chat_id = m.chat_id
   where c.is_support_thread = true
     and (c.participant_a = v_r3 or c.participant_b = v_r3)
     and m.system_payload->>'kind' = 'auto_removed'
   order by m.created_at desc limit 1;

  perform pg_temp.assert(v_auto_payload is not null, 'T6: auto_removed message missing in r3 thread');
  perform pg_temp.assert(v_auto_payload->'link_target'->>'type' = 'post', 'T6: auto_removed link_target.type wrong');
  perform pg_temp.assert((v_auto_payload->'link_target'->>'id')::uuid = v_post, 'T6: auto_removed link_target.id wrong');
  perform pg_temp.assert(v_auto_payload->'target_preview'->>'kind' = 'post', 'T6: auto_removed target_preview.kind wrong');
  perform pg_temp.assert(v_auto_payload->>'distinct_reporters' = '3', 'T6: distinct_reporters should be 3');

  raise notice '✓ T6 threshold breach emits enriched auto_removed';
end $$;

-- ───────── TEST 7: regression — only ONE system message per report ───────────
do $$
declare
  v_r uuid := pg_temp.mk_user('t7_r_' || substr(gen_random_uuid()::text,1,8));
  v_a uuid := pg_temp.mk_user('t7_a_' || substr(gen_random_uuid()::text,1,8));
  v_post uuid;
  v_count int;
begin
  insert into public.posts (post_id, owner_id, type, title, description, city, street, street_number)
  values (gen_random_uuid(), v_a, 'Give', 'Regression', 'd',
          (select city_id from public.cities limit 1), 'St', '1')
  returning post_id into v_post;

  insert into public.reports (reporter_id, target_type, target_id, reason)
  values (v_r, 'post', v_post, 'Spam');

  -- Should be exactly one report_received message in v_r's support thread for this report.
  select count(*) into v_count
    from public.messages m
    join public.chats c on c.chat_id = m.chat_id
   where c.is_support_thread = true
     and (c.participant_a = v_r or c.participant_b = v_r)
     and m.system_payload->>'kind' in ('report', 'report_received')
     and (m.system_payload->>'target_id')::uuid = v_post;

  perform pg_temp.assert(v_count = 1, format('T7: expected 1 system message, got %s (obsolete 0013 trigger may still be live)', v_count));

  raise notice '✓ T7 no duplicate system messages';
end $$;

\echo '✓ 0047 report-admin-payload-enrichment tests passed'
