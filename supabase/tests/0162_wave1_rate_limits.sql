-- Wave 1 / TD-162 — NFR-SEC-009 message (10/s) and report (5/h) rate limits.

create or replace function pg_temp.assert(p_cond boolean, p_msg text)
returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'ASSERT FAILED: %', p_msg; end if;
end $$;
-- Called below under `set local role`: new functions are owner-only by default (0520).
grant execute on function pg_temp.assert(boolean, text) to public;

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

-- ─── messages: 11th insert in 1s raises rate_limit_exceeded ─────────────────
do $$
declare
  v_a      uuid := pg_temp.mk_user('rl_msg_a_' || substr(gen_random_uuid()::text, 1, 8));
  v_b      uuid := pg_temp.mk_user('rl_msg_b_' || substr(gen_random_uuid()::text, 1, 8));
  v_chat   uuid;
  v_pa     uuid;
  v_pb     uuid;
  i        int;
  v_hit    boolean := false;
begin
  v_pa := least(v_a, v_b);
  v_pb := greatest(v_a, v_b);
  insert into public.chats (participant_a, participant_b)
  values (v_pa, v_pb)
  returning chat_id into v_chat;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_a::text)::text, true);
  set local role authenticated;

  for i in 1..10 loop
    insert into public.messages (chat_id, sender_id, kind, body, status)
    values (v_chat, v_a, 'user', 'probe-' || i::text, 'pending');
  end loop;

  begin
    insert into public.messages (chat_id, sender_id, kind, body, status)
    values (v_chat, v_a, 'user', 'probe-11', 'pending');
    raise exception 'ASSERT FAILED: 11th message should be rate limited';
  exception
    when others then
      if sqlerrm not like '%rate_limit_exceeded%' then
        raise;
      end if;
      v_hit := true;
  end;

  perform pg_temp.assert(v_hit, '11th message did not raise rate_limit_exceeded');
  raise notice '✓ messages rate limit enforced at 10/s';
  reset role;
end $$;

-- ─── reports: 6th insert in 1h raises rate_limit_exceeded ───────────────────
-- Issue reports (target_type=none) avoid target visibility / dedup constraints.
do $$
declare
  v_reporter uuid := pg_temp.mk_user('rl_rep_' || substr(gen_random_uuid()::text, 1, 8));
  i          int;
  v_hit      boolean := false;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_reporter::text)::text, true);
  set local role authenticated;

  for i in 1..5 loop
    insert into public.reports (reporter_id, target_type, target_id, reason)
    values (v_reporter, 'none', null, 'Other');
  end loop;

  begin
    insert into public.reports (reporter_id, target_type, target_id, reason)
    values (v_reporter, 'none', null, 'Other');
    raise exception 'ASSERT FAILED: 6th report should be rate limited';
  exception
    when others then
      if sqlerrm not like '%rate_limit_exceeded%' then
        raise;
      end if;
      v_hit := true;
  end;

  perform pg_temp.assert(v_hit, '6th report did not raise rate_limit_exceeded');
  raise notice '✓ reports rate limit enforced at 5/h';
  reset role;
end $$;
