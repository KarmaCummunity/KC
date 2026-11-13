-- supabase/tests/0054_chat_mark_read_includes_system.sql
-- Regression test for FR-CHAT-011 + FR-CHAT-012.
-- Verifies that rpc_chat_mark_read now covers system messages (sender_id IS
-- NULL, kind='system') and that rpc_chat_unread_total returns 0 after the
-- chat is marked read, closing the original badge-resurrection race.
--
-- Tests create their own users/chats with random UUIDs so they don't collide
-- with seed data and can re-run without cleanup.

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
  update public.users
     set share_handle   = p_handle,
         display_name   = 'Display ' || p_handle,
         privacy_mode   = 'Public',
         account_status = 'active'
   where user_id = v_id;
  return v_id;
end $$;

-- mk_chat: returns the chat_id with canonical participant ordering.
create or replace function pg_temp.mk_chat(p_u1 uuid, p_u2 uuid)
returns uuid language plpgsql as $$
declare
  v_a uuid; v_b uuid; v_chat uuid;
begin
  if p_u1 < p_u2 then v_a := p_u1; v_b := p_u2;
                 else v_a := p_u2; v_b := p_u1; end if;
  insert into public.chats (participant_a, participant_b)
  values (v_a, v_b)
  returning chat_id into v_chat;
  return v_chat;
end $$;

-- ─── TEST 1: mark_read flips BOTH user message and system message to 'read' ──
do $$
declare
  v_recipient uuid := pg_temp.mk_user('t1r_' || substr(gen_random_uuid()::text,1,8));
  v_sender    uuid := pg_temp.mk_user('t1s_' || substr(gen_random_uuid()::text,1,8));
  v_chat      uuid := pg_temp.mk_chat(v_recipient, v_sender);
  v_user_msg  uuid;
  v_sys_msg   uuid;
  v_user_status text;
  v_sys_status  text;
  v_unread bigint;
begin
  -- Seed: a peer DM (status='delivered') and a system message (sender NULL).
  insert into public.messages (chat_id, sender_id, kind, body, status, delivered_at)
  values (v_chat, v_sender, 'user', 'hello', 'delivered', now())
  returning message_id into v_user_msg;

  insert into public.messages (chat_id, sender_id, kind, body, system_payload, status, delivered_at)
  values (v_chat, null, 'system', 'post closed', jsonb_build_object('kind','post_closed'), 'delivered', now())
  returning message_id into v_sys_msg;

  -- Pre-condition: unread_total counts the system message.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_recipient::text)::text, true);
  select public.rpc_chat_unread_total() into v_unread;
  perform pg_temp.assert(v_unread = 2, 'T1 pre: expected unread_total=2, got ' || v_unread);

  -- Act: recipient calls mark_read.
  perform public.rpc_chat_mark_read(v_chat);

  -- Post-condition: both messages flipped to 'read'.
  select status into v_user_status from public.messages where message_id = v_user_msg;
  select status into v_sys_status  from public.messages where message_id = v_sys_msg;
  perform pg_temp.assert(v_user_status = 'read', 'T1: user message status=' || v_user_status);
  perform pg_temp.assert(v_sys_status  = 'read', 'T1: system message status=' || v_sys_status);

  -- AC1: unread_total clears to 0 — closes the original badge race.
  select public.rpc_chat_unread_total() into v_unread;
  perform pg_temp.assert(v_unread = 0, 'T1 post: expected unread_total=0, got ' || v_unread);

  raise notice '✓ T1 mark_read covers user + system messages';
end $$;

-- ─── TEST 1b: legacy system row (delivered_at IS NULL) is still markable ───
-- Regression for the `messages_timestamps_monotonic` failure we hit applying
-- 0054 to a DB that contained pre-fix system messages (see 0055).
do $$
declare
  v_recipient uuid := pg_temp.mk_user('t1br_' || substr(gen_random_uuid()::text,1,8));
  v_sender    uuid := pg_temp.mk_user('t1bs_' || substr(gen_random_uuid()::text,1,8));
  v_chat      uuid := pg_temp.mk_chat(v_recipient, v_sender);
  v_sys_msg   uuid;
  v_sys_status text;
  v_delivered_at timestamptz;
begin
  -- Seed: a system message inserted directly at status='delivered' WITHOUT
  -- delivered_at (the historical inconsistency).
  insert into public.messages (chat_id, sender_id, kind, body, system_payload, status, delivered_at)
  values (v_chat, null, 'system', 'legacy', jsonb_build_object('kind','legacy'), 'delivered', null)
  returning message_id into v_sys_msg;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_recipient::text)::text, true);
  perform public.rpc_chat_mark_read(v_chat);

  select status, delivered_at into v_sys_status, v_delivered_at
    from public.messages where message_id = v_sys_msg;
  perform pg_temp.assert(v_sys_status = 'read', 'T1b: legacy system status=' || v_sys_status);
  perform pg_temp.assert(v_delivered_at is not null, 'T1b: delivered_at should be coalesced by the RPC');

  raise notice '✓ T1b legacy system row (delivered_at IS NULL) is markable';
end $$;

-- ─── TEST 2: non-participant is rejected ────────────────────────────────────
do $$
declare
  v_a uuid := pg_temp.mk_user('t2a_' || substr(gen_random_uuid()::text,1,8));
  v_b uuid := pg_temp.mk_user('t2b_' || substr(gen_random_uuid()::text,1,8));
  v_outsider uuid := pg_temp.mk_user('t2o_' || substr(gen_random_uuid()::text,1,8));
  v_chat uuid := pg_temp.mk_chat(v_a, v_b);
  v_rejected boolean := false;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_outsider::text)::text, true);
  begin
    perform public.rpc_chat_mark_read(v_chat);
  exception when others then
    v_rejected := true;
  end;
  perform pg_temp.assert(v_rejected, 'T2: non-participant should be rejected');
  raise notice '✓ T2 non-participant rejected';
end $$;

-- ─── TEST 3: idempotent — second call is a no-op ────────────────────────────
do $$
declare
  v_recipient uuid := pg_temp.mk_user('t3r_' || substr(gen_random_uuid()::text,1,8));
  v_sender    uuid := pg_temp.mk_user('t3s_' || substr(gen_random_uuid()::text,1,8));
  v_chat      uuid := pg_temp.mk_chat(v_recipient, v_sender);
  v_read_at_1 timestamptz;
  v_read_at_2 timestamptz;
begin
  insert into public.messages (chat_id, sender_id, kind, body, status, delivered_at)
  values (v_chat, v_sender, 'user', 'hi', 'delivered', now());

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_recipient::text)::text, true);
  perform public.rpc_chat_mark_read(v_chat);
  select read_at into v_read_at_1 from public.messages where chat_id = v_chat;
  perform pg_temp.assert(v_read_at_1 is not null, 'T3: read_at should be stamped after first call');

  -- Sleep to ensure now() would have advanced if the second call wrote.
  perform pg_sleep(0.05);
  perform public.rpc_chat_mark_read(v_chat);
  select read_at into v_read_at_2 from public.messages where chat_id = v_chat;
  perform pg_temp.assert(v_read_at_1 = v_read_at_2, 'T3: read_at must not change on second call');

  raise notice '✓ T3 mark_read is idempotent';
end $$;

-- ─── TEST 4: anonymous caller is rejected ──────────────────────────────────
do $$
declare
  v_a uuid := pg_temp.mk_user('t4a_' || substr(gen_random_uuid()::text,1,8));
  v_b uuid := pg_temp.mk_user('t4b_' || substr(gen_random_uuid()::text,1,8));
  v_chat uuid := pg_temp.mk_chat(v_a, v_b);
  v_rejected boolean := false;
begin
  -- Clear the JWT claims so auth.uid() returns null.
  perform set_config('request.jwt.claims', '', true);
  begin
    perform public.rpc_chat_mark_read(v_chat);
  exception when others then
    v_rejected := true;
  end;
  perform pg_temp.assert(v_rejected, 'T4: anonymous caller should be rejected');
  raise notice '✓ T4 anonymous caller rejected';
end $$;

\echo '✓ 0054 chat mark-read covers system messages — tests passed'
