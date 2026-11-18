-- External post import, provenance (FR-IMPORT-007 AC3): api_import_attach_post marks the caller's post
-- as imported from the caller's import record and links them; nobody else's rows, no second post for the
-- same import, no signed-out caller, and no member can set the source columns by hand.
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

select plan(15);

insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data) values
  ('00000000-0000-4000-8000-00000000000a', 'alice@example.test', now(), '{"provider":"email"}'),
  ('00000000-0000-4000-8000-00000000000b', 'bob@example.test', now(), '{"provider":"email"}');
insert into public.cities (city_id, name_he, name_en, location) values
  ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)');
insert into public.worlds (slug, label_he, label_en) values ('items', 'items', 'Items');
insert into public.post_kinds (id, world_slug, slug, label_he, label_en, direction) values
  ('20000000-0000-4000-8000-000000000001', 'items', 'item', 'item', 'Item', 'either');

-- Alice has two posts, Bob one; Alice has two imports (one from WhatsApp), Bob one.
insert into public.posts (id, owner_id, world_slug, kind_id, direction, title, city_id) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'items', '20000000-0000-4000-8000-000000000001', 'offer', 'Sofa', 'c1'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-00000000000a', 'items', '20000000-0000-4000-8000-000000000001', 'offer', 'Table', 'c1'),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-00000000000b', 'items', '20000000-0000-4000-8000-000000000001', 'offer', 'Chair', 'c1');
insert into public.external_post_imports (id, user_id, channel, source_platform, text_fingerprint, routing, reason, extraction_version) values
  ('40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'share', 'whatsapp', repeat('a', 64), 'confirm', 'ok', 'v1'),
  ('40000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-00000000000a', 'paste', 'facebook', repeat('b', 64), 'confirm', 'ok', 'v1'),
  ('40000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-00000000000b', 'paste', 'yad2', repeat('c', 64), 'confirm', 'ok', 'v1');

-- ── A native post is native ────────────────────────────────────────────────
select is((select source || '/' || coalesce(source_platform, '-') from public.posts where id = '10000000-0000-4000-8000-000000000001'),
  'native/-', 'a post starts native, with no platform');

-- ── Attaching ──────────────────────────────────────────────────────────────
select is(pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000a',
  $$select public.api_import_attach_post('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001')$$),
  1::bigint, 'a member attaches their import to their post');
select is((select source || '/' || source_platform from public.posts where id = '10000000-0000-4000-8000-000000000001'),
  'imported/whatsapp', 'the post is imported from the platform of the import');
select is((select post_id::text || '/' || status from public.external_post_imports where id = '40000000-0000-4000-8000-000000000001'),
  '10000000-0000-4000-8000-000000000001/published', 'the import is tied to the post and published');
select lives_ok(
  $$select pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000a',
    $q$select public.api_import_attach_post('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001')$q$)$$,
  'attaching the same pair again changes nothing and does not fail');

-- ── What it refuses ────────────────────────────────────────────────────────
select throws_ok(
  $$select pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000a',
    $q$select public.api_import_attach_post('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002')$q$)$$,
  '23505', null, 'an import cannot be attached to a second post');
select is((select source from public.posts where id = '10000000-0000-4000-8000-000000000002'),
  'native', 'and the second post stays native');
select throws_ok(
  $$select pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000b',
    $q$select public.api_import_attach_post('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003')$q$)$$,
  'P0002', null, 'a member cannot attach the import of another member');
select throws_ok(
  $$select pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000a',
    $q$select public.api_import_attach_post('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003')$q$)$$,
  'P0002', null, 'a member cannot mark the post of another member');
select throws_ok(
  $$select pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000a',
    $q$select public.api_import_attach_post('40000000-0000-4000-8000-0000000000ff', '10000000-0000-4000-8000-000000000002')$q$)$$,
  'P0002', null, 'an import that does not exist is refused');
select throws_ok(
  $$select pg_temp.rows_as('anon', null,
    $q$select public.api_import_attach_post('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001')$q$)$$,
  '42501', null, 'a signed-out caller cannot call it');

-- ── Members cannot set the columns by hand ─────────────────────────────────
select throws_ok(
  $$select pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000a',
    $q$update public.posts set source = 'imported' where id = '10000000-0000-4000-8000-000000000002'$q$)$$,
  '42501', null, 'a member cannot mark a post as imported by hand');
select throws_ok(
  $$select pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000a',
    $q$update public.posts set source_platform = 'yad2' where id = '10000000-0000-4000-8000-000000000002'$q$)$$,
  '42501', null, 'nor set a platform by hand');

-- ── The columns agree ──────────────────────────────────────────────────────
select throws_ok(
  $$update public.posts set source_platform = 'yad2' where id = '10000000-0000-4000-8000-000000000002'$$,
  '23514', null, 'a platform without source = imported is refused');
select throws_ok(
  $$update public.posts set source = 'imported', source_platform = 'telegram' where id = '10000000-0000-4000-8000-000000000002'$$,
  '23514', null, 'only the known platforms are accepted');

select * from finish();
rollback;
