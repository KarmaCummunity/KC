-- TD-83 / 0184 — both support-thread helpers use an atomic on-conflict upsert
-- that infers the PARTIAL chats_unique_support_pair index (… where
-- is_support_thread = true). Each must be idempotent and must not raise 42P10.

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
         account_status = 'active'
   where user_id = v_id;
  return v_id;
end $$;

-- ── (1) internal helper find_or_create_support_chat(p_user) ──────────────────
do $$
declare
  v_admin uuid := pg_temp.mk_user('sup_admin_' || substr(gen_random_uuid()::text, 1, 8));
  v_user  uuid := pg_temp.mk_user('sup_user_'  || substr(gen_random_uuid()::text, 1, 8));
  v_c1    uuid;
  v_c2    uuid;
  v_cnt   int;
begin
  update public.users set is_super_admin = true where user_id = v_admin;

  v_c1 := public.find_or_create_support_chat(v_user);
  v_c2 := public.find_or_create_support_chat(v_user);

  if v_c1 is null then
    raise exception 'ASSERT FAILED: support chat was null (no super_admin resolved)';
  end if;
  if v_c1 <> v_c2 then
    raise exception 'ASSERT FAILED: find_or_create_support_chat not idempotent: % vs %', v_c1, v_c2;
  end if;

  select count(*) into v_cnt
  from public.chats
  where is_support_thread = true
    and (participant_a = v_user or participant_b = v_user);
  if v_cnt <> 1 then
    raise exception 'ASSERT FAILED: expected exactly 1 support chat for the user, got %', v_cnt;
  end if;

  raise notice '✓ find_or_create_support_chat is an idempotent atomic upsert (TD-83)';
end $$;

-- ── (2) public RPC rpc_get_or_create_support_thread() (0070 inference fix) ────
do $$
declare
  v_admin uuid := pg_temp.mk_user('sup_rpc_admin_' || substr(gen_random_uuid()::text, 1, 8));
  v_user  uuid := pg_temp.mk_user('sup_rpc_user_'  || substr(gen_random_uuid()::text, 1, 8));
  v_chat  public.chats;
  v_chat2 public.chats;
begin
  update public.users set is_super_admin = true where user_id = v_admin;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_user::text)::text, true);
  set local role authenticated;

  v_chat  := public.rpc_get_or_create_support_thread();
  v_chat2 := public.rpc_get_or_create_support_thread();

  reset role;

  if v_chat.chat_id is null then
    raise exception 'ASSERT FAILED: rpc_get_or_create_support_thread returned a null chat';
  end if;
  if not v_chat.is_support_thread then
    raise exception 'ASSERT FAILED: rpc_get_or_create_support_thread returned a non-support chat';
  end if;
  if v_chat.chat_id <> v_chat2.chat_id then
    raise exception 'ASSERT FAILED: rpc_get_or_create_support_thread not idempotent: % vs %',
      v_chat.chat_id, v_chat2.chat_id;
  end if;

  raise notice '✓ rpc_get_or_create_support_thread infers the partial index + is idempotent';
end $$;
