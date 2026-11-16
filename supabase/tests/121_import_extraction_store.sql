-- External post import store (FR-IMPORT-008, FR-IMPORT-009): a member reads and deletes only
-- their own import records and cannot write them; the extraction cache is closed to every API
-- role; the checks keep malformed rows out.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Runs one statement as an API role and returns the number of rows it returned or changed.
create function pg_temp.rows_as(p_role text, p_user_id uuid, p_sql text)
returns bigint
language plpgsql
as $$
declare
  v_rows bigint;
begin
  perform set_config(
    'request.jwt.claims', jsonb_build_object('sub', p_user_id, 'role', p_role)::text, true);
  perform set_config('role', p_role, true);
  execute p_sql;
  get diagnostics v_rows = row_count;
  perform set_config('role', 'none', true);
  return v_rows;
end;
$$;

select plan(17);

insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data) values
  ('00000000-0000-4000-8000-00000000000a', 'alice@example.test', now(), '{"provider":"email"}'),
  ('00000000-0000-4000-8000-00000000000b', 'bob@example.test', now(), '{"provider":"email"}');

-- A valid fingerprint is 64 lower-case hex characters.
insert into public.external_post_imports (id, user_id, channel, text_fingerprint, routing, reason, extraction_version) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'share', repeat('a', 64), 'confirm', 'ok', 'v1'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-00000000000a', 'paste', repeat('b', 64), 'manual', 'provider_failed', 'v1'),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-00000000000b', 'share', repeat('c', 64), 'ready', 'ok', 'v1');
insert into public.post_extraction_cache (fingerprint, extraction_version, result)
  values (repeat('a', 64), 'v1', '{"is_post": false}');

-- ── Members read only their own records ─────────────────────────────────────
select is(pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000a',
  'select 1 from public.external_post_imports'), 2::bigint, 'a member reads their own import records');
select is(pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000b',
  'select 1 from public.external_post_imports'), 1::bigint, 'and not the records of another member');
select throws_ok(
  $$select pg_temp.rows_as('anon', null, 'select 1 from public.external_post_imports')$$,
  '42501', null, 'a signed-out caller cannot read import records');

-- ── Members cannot write; they can delete their own ─────────────────────────
select throws_ok(
  $$select pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000a',
    $q$insert into public.external_post_imports (user_id, channel, text_fingerprint, routing, reason, extraction_version)
       values ('00000000-0000-4000-8000-00000000000a', 'share', repeat('d', 64), 'ready', 'ok', 'v1')$q$)$$,
  '42501', null, 'a member cannot create an import record');
select throws_ok(
  $$select pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000a',
    $q$update public.external_post_imports set routing = 'ready'$q$)$$,
  '42501', null, 'a member cannot change an import record');
select is(pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000a',
  $$delete from public.external_post_imports where id = '10000000-0000-4000-8000-000000000003'$$),
  0::bigint, 'a member cannot delete the record of another member');
select is(pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000a',
  $$delete from public.external_post_imports where id = '10000000-0000-4000-8000-000000000001'$$),
  1::bigint, 'a member deletes their own record');

-- ── The service role writes ────────────────────────────────────────────────
select is(pg_temp.rows_as('service_role', null,
  $$insert into public.external_post_imports (user_id, channel, text_fingerprint, routing, reason, extraction_version, provider_called)
    values ('00000000-0000-4000-8000-00000000000b', 'paste', repeat('e', 64), 'confirm', 'ok', 'v1', true)$$),
  1::bigint, 'the service role records an extraction');

-- ── The cache is closed to API roles ───────────────────────────────────────
select throws_ok(
  $$select pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000a', 'select 1 from public.post_extraction_cache')$$,
  '42501', null, 'a member cannot read the extraction cache');
select throws_ok(
  $$select pg_temp.rows_as('anon', null, 'select 1 from public.post_extraction_cache')$$,
  '42501', null, 'a signed-out caller cannot read the extraction cache');
select is(pg_temp.rows_as('service_role', null, 'select 1 from public.post_extraction_cache'),
  1::bigint, 'the service role reads the cache');

-- ── Checks keep malformed rows out ─────────────────────────────────────────
select throws_ok(
  $$insert into public.external_post_imports (user_id, channel, text_fingerprint, routing, reason, extraction_version)
    values ('00000000-0000-4000-8000-00000000000a', 'share', 'not-a-hash', 'ready', 'ok', 'v1')$$,
  '23514', null, 'a fingerprint must be 64 hex characters');
select throws_ok(
  $$insert into public.external_post_imports (user_id, channel, text_fingerprint, routing, reason, extraction_version)
    values ('00000000-0000-4000-8000-00000000000a', 'bot', repeat('f', 64), 'ready', 'ok', 'v1')$$,
  '23514', null, 'the channel is share or paste');
select throws_ok(
  $$insert into public.external_post_imports (user_id, channel, text_fingerprint, routing, reason, extraction_version)
    values ('00000000-0000-4000-8000-00000000000a', 'share', repeat('f', 64), 'auto', 'ok', 'v1')$$,
  '23514', null, 'the routing is ready, confirm or manual');
select throws_ok(
  $$insert into public.external_post_imports (user_id, channel, text_fingerprint, routing, reason, extraction_version, confidence)
    values ('00000000-0000-4000-8000-00000000000a', 'share', repeat('f', 64), 'ready', 'ok', 'v1', 1.5)$$,
  '23514', null, 'the confidence is at most 1');
select throws_ok(
  $$insert into public.post_extraction_cache (fingerprint, extraction_version, result) values ('xyz', 'v1', '{}')$$,
  '23514', null, 'a cache key must be a fingerprint');
select throws_ok(
  $$insert into public.post_extraction_cache (fingerprint, extraction_version, result) values (repeat('9', 64), 'v1', '[]')$$,
  '23514', null, 'a cached answer is an object');

select * from finish();
rollback;
