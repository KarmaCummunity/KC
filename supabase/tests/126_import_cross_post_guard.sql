-- External post import, cross-post guard (FR-IMPORT-008 AC1, KC#2438): import_similar_open_post finds the
-- member's own open post an imported text repeats (trigram similarity >= 0.80). Other members' posts,
-- closed posts and different texts do not match, and only the service role may ask.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- The post id the guard returns for a member and a text, or 'none'.
create function pg_temp.match(p_user uuid, p_text text)
returns text
language sql
as $$ select coalesce((select m.post_id::text from public.import_similar_open_post(p_user, p_text) m), 'none') $$;

select plan(7);

insert into auth.users (id, email, raw_app_meta_data) values
  ('00000000-0000-4000-8000-00000000000a', 'alice@example.test', '{"provider":"google"}'),
  ('00000000-0000-4000-8000-00000000000b', 'bob@example.test', '{"provider":"google"}');
insert into public.cities (city_id, name_he, name_en, location) values
  ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)');
insert into public.worlds (slug, label_he, label_en) values ('items', 'items', 'Items');
insert into public.post_kinds (id, world_slug, slug, label_he, label_en, direction) values
  ('20000000-0000-4000-8000-000000000001', 'items', 'item', 'item', 'Item', 'either');
-- Alice: an open sofa and a paused table; Bob: an open sofa with the same words.
insert into public.posts (id, owner_id, world_slug, kind_id, direction, title, description, city_id) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'items', '20000000-0000-4000-8000-000000000001', 'offer',
   'Three-seat sofa', 'Free sofa, pick up in Haifa by Thursday', 'c1'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-00000000000a', 'items', '20000000-0000-4000-8000-000000000001', 'offer',
   'Wooden dining table', 'Six chairs included, pick up in Haifa', 'c1'),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-00000000000b', 'items', '20000000-0000-4000-8000-000000000001', 'offer',
   'Three-seat sofa', 'Free sofa, pick up in Haifa by Thursday', 'c1');
select set_config('kc.fsm_role', 'owner', true);
update public.posts set status = 'paused' where id = '10000000-0000-4000-8000-000000000002';
select set_config('kc.fsm_role', '', true);

select is(pg_temp.match('00000000-0000-4000-8000-00000000000a', 'Three-seat sofa Free sofa, pick up in Haifa by Thursday'),
  '10000000-0000-4000-8000-000000000001', 'the same text matches the member''s open post');
select is(pg_temp.match('00000000-0000-4000-8000-00000000000a', 'three seat sofa - free sofa, pick up in haifa by thursday!'),
  '10000000-0000-4000-8000-000000000001', 'case and punctuation do not hide a repeat');
select is(pg_temp.match('00000000-0000-4000-8000-00000000000a', 'Bicycle for a child, ages five to seven'),
  'none', 'a different text matches nothing');
select is(pg_temp.match('00000000-0000-4000-8000-00000000000a', 'Wooden dining table Six chairs included, pick up in Haifa'),
  'none', 'a post that is not open is not a repeat');
select is(pg_temp.match('00000000-0000-4000-8000-00000000000b', 'Three-seat sofa Free sofa, pick up in Haifa by Thursday'),
  '10000000-0000-4000-8000-000000000003', 'each member is compared with their own posts only');

select ok(has_function_privilege('service_role', 'public.import_similar_open_post(uuid, text, real)', 'execute'),
  'the extraction function (service role) asks');
select ok(not has_function_privilege('authenticated', 'public.import_similar_open_post(uuid, text, real)', 'execute'),
  'a member cannot probe anyone''s posts through it');

select * from finish();
rollback;
