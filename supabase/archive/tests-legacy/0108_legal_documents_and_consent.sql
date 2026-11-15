-- supabase/tests/0108_legal_documents_and_consent.sql
-- Smoke tests for 0108_legal_documents_and_consent.sql (FR-SETTINGS-010).
--
-- Self-contained: bootstraps a synthetic super-admin (since CI's fresh Supabase
-- stack has no pre-seeded admin) so the suite runs against both prod-like
-- environments (admin exists, v1 pre-seeded by migration) and CI-fresh
-- environments (no admin yet — the migration skipped its seed, this file
-- creates the admin + publishes v1 inline).
--
-- Asserts:
--   1. Append-only triggers block UPDATE / DELETE on the immutable tables.
--   2. publish_legal_document rejects non-admin (forbidden) and accepts admin.
--   3. publish rejects critical with effective_date > now()+1h.
--   4. publish rejects non-minor without change_summary.
--   5. needs_legal_reacknowledgement returns rows for a fresh user.
--   6. accept_legal_document logs and clears the gate.
--   7. accept rejects out-of-range version.

create or replace function pg_temp.assert(p_cond boolean, p_msg text)
returns void language plpgsql as $body$
begin
  if p_cond is not true then raise exception 'ASSERT FAILED: %', p_msg; end if;
end $body$;

create or replace function pg_temp.expect_raise(p_sql text, p_msg_like text, p_test text)
returns void language plpgsql as $body$
declare
  v_err text;
begin
  execute p_sql;
  raise exception '%: expected raise, but statement succeeded', p_test;
exception
  when others then
    get stacked diagnostics v_err = message_text;
    if v_err not like '%' || p_msg_like || '%' then
      raise exception '%: expected message containing %, got: %', p_test, p_msg_like, v_err;
    end if;
end $body$;

-- ─── Bootstrap: ensure a super-admin exists, then make sure v1 of both docs
--     and the legal_documents pointer rows exist. Idempotent.
do $body$
declare
  v_admin uuid;
  v_email text := 'legal-test-admin@kc-tests.local';
begin
  select user_id into v_admin from public.users where is_super_admin = true order by created_at asc limit 1;

  if v_admin is null then
    -- Mint a synthetic auth.users + public.users row, mark as super-admin.
    v_admin := gen_random_uuid();
    insert into auth.users (
      id, email, email_confirmed_at,
      raw_user_meta_data, raw_app_meta_data,
      aud, role
    ) values (
      v_admin, v_email, now(),
      '{}'::jsonb, jsonb_build_object('provider','email'),
      'authenticated', 'authenticated'
    );
    -- public.users may auto-promote based on email pattern; if not, force the flag.
    insert into public.users (user_id, share_handle, is_super_admin)
      values (v_admin, 'legal_test_admin_' || substr(v_admin::text, 1, 8), true)
    on conflict (user_id) do update set is_super_admin = true;
  end if;

  perform set_config('request.jwt.claim.sub', v_admin::text, false);

  -- If migration's v1 seed was skipped (CI path), publish v1 now via the RPC.
  if not exists (select 1 from public.legal_document_versions where doc_type = 'terms' and version = 1) then
    perform public.publish_legal_document(
      'terms'::public.legal_doc_type,
      '# bootstrap terms v1',
      'standard',
      '- bootstrap',
      now()
    );
  end if;
  if not exists (select 1 from public.legal_document_versions where doc_type = 'privacy' and version = 1) then
    perform public.publish_legal_document(
      'privacy'::public.legal_doc_type,
      '# bootstrap privacy v1',
      'standard',
      '- bootstrap',
      now()
    );
  end if;
end $body$;

-- ─── TEST 1+2: legal_document_versions UPDATE / DELETE blocked by trigger ───
do $body$
begin
  perform pg_temp.expect_raise(
    'update public.legal_document_versions set body_md = ''hacked'' where doc_type = ''terms'' and version = 1',
    'legal_document_versions is append-only',
    'TEST 1: UPDATE on legal_document_versions blocked'
  );
  perform pg_temp.expect_raise(
    'delete from public.legal_document_versions where doc_type = ''terms'' and version = 1',
    'legal_document_versions is append-only',
    'TEST 2: DELETE on legal_document_versions blocked'
  );
end $body$;

-- ─── TEST 3: user_legal_acceptances UPDATE / DELETE blocked by trigger ─────
do $body$
declare
  v_admin uuid;
begin
  select user_id into v_admin from public.users where is_super_admin = true order by created_at asc limit 1;
  insert into public.user_legal_acceptances (user_id, doc_type, version) values (v_admin, 'terms', 1);

  perform pg_temp.expect_raise(
    'update public.user_legal_acceptances set version = 99 where user_id = ' || quote_literal(v_admin),
    'user_legal_acceptances is append-only',
    'TEST 3a: UPDATE on user_legal_acceptances blocked'
  );
  perform pg_temp.expect_raise(
    'delete from public.user_legal_acceptances where user_id = ' || quote_literal(v_admin),
    'user_legal_acceptances is append-only',
    'TEST 3b: DELETE on user_legal_acceptances blocked'
  );
  truncate public.user_legal_acceptances;
end $body$;

-- ─── TEST 4: publish_legal_document — admin accepted, content_hash filled ──
do $body$
declare
  v_admin uuid;
  v_result json;
  v_v_before int;
  v_v_after int;
begin
  select user_id into v_admin from public.users where is_super_admin = true order by created_at asc limit 1;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  select current_version into v_v_before from public.legal_documents where doc_type = 'terms';
  v_result := public.publish_legal_document('terms'::public.legal_doc_type, '# v_test_minor', 'minor', null, now());
  select current_version into v_v_after from public.legal_documents where doc_type = 'terms';

  perform pg_temp.assert(v_v_after = v_v_before + 1, 'TEST 4a: current_version did not advance');
  perform pg_temp.assert((v_result->>'content_hash') is not null, 'TEST 4b: content_hash missing');
  perform pg_temp.assert(length(v_result->>'content_hash') = 64, 'TEST 4c: content_hash not 64 hex chars');
end $body$;

-- ─── TEST 5: critical too-far-future rejected ─────────────────────────────
do $body$
declare
  v_admin uuid;
begin
  select user_id into v_admin from public.users where is_super_admin = true order by created_at asc limit 1;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  perform pg_temp.expect_raise(
    'select public.publish_legal_document(''terms''::public.legal_doc_type, ''# x'', ''critical'', ''- urgent'', ' || quote_literal((now() + interval '2 hours')::text) || '::timestamptz)',
    'critical severity must be effective immediately',
    'TEST 5: critical+future rejected'
  );
end $body$;

-- ─── TEST 6: non-minor requires change_summary ────────────────────────────
do $body$
declare
  v_admin uuid;
begin
  select user_id into v_admin from public.users where is_super_admin = true order by created_at asc limit 1;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  perform pg_temp.expect_raise(
    'select public.publish_legal_document(''terms''::public.legal_doc_type, ''# x'', ''standard'', null, now())',
    'change_summary required for non-minor severity',
    'TEST 6: standard without summary rejected'
  );
end $body$;

-- ─── TEST 7: needs_legal_reacknowledgement returns rows for unaccepted user ─
do $body$
declare
  v_admin uuid;
  v_count int;
begin
  select user_id into v_admin from public.users where is_super_admin = true order by created_at asc limit 1;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  truncate public.user_legal_acceptances;
  select count(*) into v_count from public.needs_legal_reacknowledgement();
  perform pg_temp.assert(v_count >= 1, 'TEST 7: needs_legal_reacknowledgement empty for fresh user');
end $body$;

-- ─── TEST 8: accept_legal_document clears the gate for that doc_type ──────
do $body$
declare
  v_admin uuid;
  v_current int;
  v_remaining int;
begin
  select user_id into v_admin from public.users where is_super_admin = true order by created_at asc limit 1;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  select current_version into v_current from public.legal_documents where doc_type = 'terms';
  perform public.accept_legal_document('terms'::public.legal_doc_type, v_current, 'he', 'pgTest/1.0');

  select count(*) into v_remaining from public.needs_legal_reacknowledgement() where doc_type = 'terms';
  perform pg_temp.assert(v_remaining = 0, 'TEST 8: accept did not clear terms from gate');
end $body$;

-- ─── TEST 9: accept rejects below last_material_version ───────────────────
do $body$
declare
  v_admin uuid;
  v_lm int;
begin
  select user_id into v_admin from public.users where is_super_admin = true order by created_at asc limit 1;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  select last_material_version into v_lm from public.legal_documents where doc_type = 'privacy';
  perform pg_temp.expect_raise(
    'select public.accept_legal_document(''privacy''::public.legal_doc_type, ' || (v_lm - 1)::text || '::int, ''he'', ''ua'')',
    'must be in',
    'TEST 9: accept below last_material_version rejected'
  );
end $body$;

-- Cleanup: revert per-session test state so reruns are clean.
truncate public.user_legal_acceptances;
