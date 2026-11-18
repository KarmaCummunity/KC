-- External post import, moderation lockout (FR-IMPORT-008 AC4, KC#2395): import_moderation_removals
-- returns when moderation removed the member's imported posts, from the real `post_status_moderated`
-- audit events. Native posts, other members' imports, a restore and old removals do not count, and
-- only the service role may read it.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Moves a post as moderation would (the FSM role 'admin' writes the audit event).
create function pg_temp.moderate(p_post uuid, p_status text)
returns void
language plpgsql
as $$
begin
  perform set_config('kc.fsm_role', 'admin', true);
  update public.posts set status = p_status where id = p_post;
  perform set_config('kc.fsm_role', '', true);
end;
$$;

-- Number of removals the function returns for a member since an instant.
create function pg_temp.removals(p_user uuid, p_since timestamptz)
returns integer
language sql
as $$ select count(*)::integer from public.import_moderation_removals(p_user, p_since) $$;

select plan(8);

insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data) values
  ('00000000-0000-4000-8000-00000000000a', 'alice@example.test', now(), '{"provider":"email"}'),
  ('00000000-0000-4000-8000-00000000000b', 'bob@example.test', now(), '{"provider":"email"}');
insert into public.cities (city_id, name_he, name_en, location) values
  ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)');
insert into public.worlds (slug, label_he, label_en) values ('items', 'items', 'Items');
insert into public.post_kinds (id, world_slug, slug, label_he, label_en, direction) values
  ('20000000-0000-4000-8000-000000000001', 'items', 'item', 'item', 'Item', 'either');

-- Alice: two imported posts and a native one. Bob: one imported post.
insert into public.posts (id, owner_id, world_slug, kind_id, direction, title, city_id) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'items', '20000000-0000-4000-8000-000000000001', 'offer', 'Sofa', 'c1'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-00000000000a', 'items', '20000000-0000-4000-8000-000000000001', 'offer', 'Table', 'c1'),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-00000000000a', 'items', '20000000-0000-4000-8000-000000000001', 'offer', 'Lamp', 'c1'),
  ('10000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-00000000000b', 'items', '20000000-0000-4000-8000-000000000001', 'offer', 'Chair', 'c1');
insert into public.external_post_imports (id, user_id, channel, source_platform, text_fingerprint, routing, reason, extraction_version, post_id, status) values
  ('40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'paste', 'whatsapp', repeat('a', 64), 'confirm', 'ok', 'v1', '10000000-0000-4000-8000-000000000001', 'published'),
  ('40000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-00000000000a', 'paste', 'facebook', repeat('b', 64), 'confirm', 'ok', 'v1', '10000000-0000-4000-8000-000000000002', 'published'),
  ('40000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-00000000000b', 'paste', 'yad2', repeat('d', 64), 'confirm', 'ok', 'v1', '10000000-0000-4000-8000-000000000004', 'published');

select is(pg_temp.removals('00000000-0000-4000-8000-00000000000a', now() - interval '44 days'), 0,
  'no removal yet, nothing returned');

-- ── Moderation removes Alice's imported posts (one of them twice), her native post and Bob's ──
select pg_temp.moderate('10000000-0000-4000-8000-000000000001', 'removed_admin');
select pg_temp.moderate('10000000-0000-4000-8000-000000000001', 'open');
select pg_temp.moderate('10000000-0000-4000-8000-000000000001', 'removed_admin');
select pg_temp.moderate('10000000-0000-4000-8000-000000000002', 'removed_admin');
select pg_temp.moderate('10000000-0000-4000-8000-000000000003', 'removed_admin');
select pg_temp.moderate('10000000-0000-4000-8000-000000000004', 'removed_admin');

select is(pg_temp.removals('00000000-0000-4000-8000-00000000000a', now() - interval '44 days'), 3,
  'every removal of an imported post counts, a repeated one too; the restore and the native post do not');
select is(pg_temp.removals('00000000-0000-4000-8000-00000000000b', now() - interval '44 days'), 1,
  'another member''s removals are their own');
select is(pg_temp.removals('00000000-0000-4000-8000-00000000000a', now() + interval '1 minute'), 0,
  'removals before the instant are not returned');

-- Audit events are immutable, and every event of this transaction shares one `now()`: the
-- instant bound is checked at its edge instead (inclusive), and the window itself in limits.test.ts.
select is(pg_temp.removals('00000000-0000-4000-8000-00000000000a', now()), 3,
  'a removal at the instant itself is inside the window');

-- ── Who may read it ───────────────────────────────────────────────────────────────────────────
select ok(has_function_privilege('service_role', 'public.import_moderation_removals(uuid, timestamptz)', 'execute'),
  'the extraction function (service role) reads it');
select ok(not has_function_privilege('authenticated', 'public.import_moderation_removals(uuid, timestamptz)', 'execute'),
  'a member cannot probe anyone''s moderation record');
select ok(not has_function_privilege('anon', 'public.import_moderation_removals(uuid, timestamptz)', 'execute'),
  'nor can a guest');

select * from finish();
rollback;
