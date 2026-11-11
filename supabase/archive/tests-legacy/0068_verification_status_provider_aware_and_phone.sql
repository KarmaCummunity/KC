-- supabase/tests/0068_verification_status_provider_aware_and_phone.sql
-- Regression test for FR-AUTH-005 / FR-AUTH-006 verification-status correctness.
-- Asserts:
--   1. Google INSERT lands as `active` directly (no transient pending_verification).
--   2. Phone OTP UPDATE on `phone_confirmed_at` promotes pending_verification → active.
--   3. Email/password INSERT with NULL email_confirmed_at stays pending_verification,
--      and the verify UPDATE on `email_confirmed_at` promotes it → active.

create or replace function pg_temp.assert(p_cond boolean, p_msg text)
returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'ASSERT FAILED: %', p_msg; end if;
end $$;

create or replace function pg_temp.account_status(p_user_id uuid)
returns text language sql as $$
  select account_status from public.users where user_id = p_user_id
$$;

-- ─── TEST 1: Google INSERT (provider=google) → 'active' on first row ──
do $$
declare
  v_uid uuid := gen_random_uuid();
  v_status text;
begin
  insert into auth.users (
    id, email, email_confirmed_at,
    raw_user_meta_data, raw_app_meta_data,
    aud, role
  ) values (
    v_uid,
    'google_' || substr(v_uid::text, 1, 8) || '@test.local',
    -- Simulate the pre-0068 race: row is INSERTed with NULL email_confirmed_at;
    -- 0067 then relied on the post-INSERT UPDATE to flip it. Under 0068 this is
    -- no longer needed for google/apple — handle_new_user writes 'active' from
    -- the provider field alone.
    null,
    '{}'::jsonb,
    jsonb_build_object('provider','google'),
    'authenticated', 'authenticated'
  );

  v_status := pg_temp.account_status(v_uid);
  perform pg_temp.assert(
    v_status = 'active',
    format('Google INSERT expected ''active'', got %L', v_status)
  );

  delete from public.auth_identities where user_id = v_uid;
  delete from public.users where user_id = v_uid;
  delete from auth.users where id = v_uid;
end $$;

\echo '✓ TEST 1 passed — Google provider lands as active without verification UPDATE'

-- ─── TEST 2: Phone signup → UPDATE phone_confirmed_at → 'active' ──────
do $$
declare
  v_uid uuid := gen_random_uuid();
  v_status_initial text;
  v_status_after   text;
begin
  insert into auth.users (
    id, email, phone, email_confirmed_at, phone_confirmed_at,
    raw_user_meta_data, raw_app_meta_data,
    aud, role
  ) values (
    v_uid,
    null,
    '+9725' || substr(v_uid::text, 1, 8),
    null, null,
    '{}'::jsonb,
    jsonb_build_object('provider','phone'),
    'authenticated', 'authenticated'
  );

  v_status_initial := pg_temp.account_status(v_uid);
  perform pg_temp.assert(
    v_status_initial = 'pending_verification',
    format('Phone INSERT (pre-verify) expected ''pending_verification'', got %L', v_status_initial)
  );

  update auth.users set phone_confirmed_at = now() where id = v_uid;

  v_status_after := pg_temp.account_status(v_uid);
  perform pg_temp.assert(
    v_status_after = 'active',
    format('Phone post-OTP-UPDATE expected ''active'', got %L', v_status_after)
  );

  delete from public.auth_identities where user_id = v_uid;
  delete from public.users where user_id = v_uid;
  delete from auth.users where id = v_uid;
end $$;

\echo '✓ TEST 2 passed — Phone OTP UPDATE on phone_confirmed_at promotes pending_verification → active'

-- ─── TEST 3: Email/password — INSERT pending, then verify → active ────
do $$
declare
  v_uid uuid := gen_random_uuid();
  v_status_initial text;
  v_status_after   text;
begin
  insert into auth.users (
    id, email, email_confirmed_at,
    raw_user_meta_data, raw_app_meta_data,
    aud, role
  ) values (
    v_uid,
    'email_' || substr(v_uid::text, 1, 8) || '@test.local',
    null,
    '{}'::jsonb,
    jsonb_build_object('provider','email'),
    'authenticated', 'authenticated'
  );

  v_status_initial := pg_temp.account_status(v_uid);
  perform pg_temp.assert(
    v_status_initial = 'pending_verification',
    format('Email INSERT (pre-verify) expected ''pending_verification'', got %L', v_status_initial)
  );

  update auth.users set email_confirmed_at = now() where id = v_uid;

  v_status_after := pg_temp.account_status(v_uid);
  perform pg_temp.assert(
    v_status_after = 'active',
    format('Email post-link-UPDATE expected ''active'', got %L', v_status_after)
  );

  delete from public.auth_identities where user_id = v_uid;
  delete from public.users where user_id = v_uid;
  delete from auth.users where id = v_uid;
end $$;

\echo '✓ TEST 3 passed — Email link UPDATE on email_confirmed_at promotes pending_verification → active'

\echo '✓ 0068_verification_status_provider_aware_and_phone.sql — all assertions passed'
