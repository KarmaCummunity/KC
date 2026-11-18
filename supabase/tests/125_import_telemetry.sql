-- External post import, telemetry (FR-IMPORT-010 AC4, FR-IMPORT-008 AC3, KC#2350): the member records
-- which draft fields they changed on their own published import; the team reads the funnel and the
-- per-field edit rate (moderators and above, counts only); the daily model budget is a health check.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Runs a statement as a member (digit of the id); its one value as text, or the error.
create function pg_temp.as_member(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  begin
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    execute p_sql into v_value;
    perform set_config('role', 'none', true);
    return coalesce(v_value, 'empty');
  exception when others then
    perform set_config('role', 'none', true);
    return case when sqlstate in ('P0001', 'P0002', '42501', '28000', '23514') then sqlstate else sqlstate || ' ' || sqlerrm end;
  end;
end;
$$;

select plan(12);

-- a and b are members, e moderates.
insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b', 'e']) x;
insert into public.admin_role_grants (user_id, role) values ('00000000-0000-4000-8000-00000000000e', 'moderator');
insert into public.cities (city_id, name_he, name_en, location) values ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)');
insert into public.worlds (slug, label_he, label_en) values ('items', 'items', 'Items');
insert into public.post_kinds (id, world_slug, slug, label_he, label_en, direction) values
  ('20000000-0000-4000-8000-000000000001', 'items', 'item', 'item', 'Item', 'either');
insert into public.posts (id, owner_id, world_slug, kind_id, direction, title, city_id) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'items', '20000000-0000-4000-8000-000000000001', 'offer', 'Sofa', 'c1'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-00000000000a', 'items', '20000000-0000-4000-8000-000000000001', 'offer', 'Table', 'c1');

-- Alice: two published imports, one draft from two days ago (discarded), one draft from now, one
-- manual attempt; Bob: one published import. Three attempts called the model.
insert into public.external_post_imports (id, user_id, channel, source_platform, text_fingerprint, routing, reason, extraction_version, provider_called, status, post_id, created_at) values
  ('40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'paste', 'whatsapp', repeat('a', 64), 'confirm', 'ok', 'v1', true, 'published', '10000000-0000-4000-8000-000000000001', now()),
  ('40000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-00000000000a', 'paste', 'facebook', repeat('b', 64), 'ready', 'ok', 'v1', true, 'published', '10000000-0000-4000-8000-000000000002', now()),
  ('40000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-00000000000a', 'paste', 'unknown', repeat('c', 64), 'confirm', 'ok', 'v1', true, 'drafted', null, now() - interval '2 days'),
  ('40000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-00000000000a', 'paste', 'unknown', repeat('d', 64), 'confirm', 'ok', 'v1', false, 'drafted', null, now()),
  ('40000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-00000000000a', 'paste', 'unknown', repeat('e', 64), 'manual', 'rate_limited', 'v1', false, 'drafted', null, now()),
  ('40000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-00000000000b', 'paste', 'yad2', repeat('f', 64), 'confirm', 'ok', 'v1', false, 'published', null, now());

-- ── Recording edits ───────────────────────────────────────────────────────────────────────────
select is(pg_temp.as_member('a', $$select 'ok' from public.api_import_record_edits('40000000-0000-4000-8000-000000000001', array['title', 'city', 'title'])$$),
  'ok', 'a member records the edits of their published import');
select is((select array_to_string(edited_fields, ',') from public.external_post_imports where id = '40000000-0000-4000-8000-000000000001'),
  'city,title', 'kept once each, in a stable order');
select is(pg_temp.as_member('a', $$select 'ok' from public.api_import_record_edits('40000000-0000-4000-8000-000000000002', '{}')$$),
  'ok', 'a draft published untouched records an empty list');
select is(pg_temp.as_member('a', $$select 'ok' from public.api_import_record_edits('40000000-0000-4000-8000-000000000003', array['title'])$$),
  'P0002', 'a draft not yet published is refused');
select is(pg_temp.as_member('b', $$select 'ok' from public.api_import_record_edits('40000000-0000-4000-8000-000000000001', array['world'])$$),
  'P0002', 'another member''s import is refused');
select is(pg_temp.as_member('a', $$select 'ok' from public.api_import_record_edits('40000000-0000-4000-8000-000000000001', array['phone'])$$),
  '23514', 'a field name outside the list is refused');

-- ── The funnel and the edit rates, for the team ──────────────────────────────────────────────
select is(pg_temp.as_member('e', $$select (f.attempts, f.manual, f.drafted, f.published, f.discarded, f.provider_calls)::text from public.admin_import_funnel(30) f$$),
  '(6,1,5,3,1,3)', 'the funnel: 6 attempts, 1 manual, 5 drafts, 3 published, 1 discarded, 3 model calls');
select is(pg_temp.as_member('e', $$select string_agg(r.field || '=' || r.edited || '/' || r.reported || ':' || coalesce(r.edit_rate::text, '-'), ' ' order by r.field) from public.admin_import_field_edit_rates(30) r where r.field in ('city', 'title', 'world')$$),
  'city=1/2:0.50 title=1/2:0.50 world=0/2:0.00', 'the edit rate per field over the published imports that reported');
select is(pg_temp.as_member('a', $$select count(*)::text from public.admin_import_funnel(30)$$),
  '42501', 'a member cannot read the funnel');
select is(pg_temp.as_member('a', $$select count(*)::text from public.admin_import_field_edit_rates(30)$$),
  '42501', 'nor the edit rates');

-- ── The budget in the health registry ────────────────────────────────────────────────────────
select is((select h.status || ' ' || h.measured from ops.run_health_checks() h where h.check_name = 'import_provider_budget'),
  'ok 2', 'today''s model calls are measured (yesterday''s are not) and under the alert line');
insert into public.external_post_imports (user_id, channel, source_platform, text_fingerprint, routing, reason, extraction_version, provider_called)
select '00000000-0000-4000-8000-00000000000b', 'paste', 'unknown', lpad(to_hex(n), 64, '0'), 'manual', 'ok', 'v1', true
  from generate_series(1, 1800) n;
select is((select h.status from ops.run_health_checks() h where h.check_name = 'import_provider_budget'),
  'failing', 'past 90 % of the daily budget the check fails, before imports stop');

select * from finish();
rollback;
