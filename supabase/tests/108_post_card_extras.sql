-- Post cards carry the fields the adapter used to read from `posts` and `challenges` in a second
-- round trip: the map point, the detected language, the status an admin removal restores, the
-- street the poster chose to show and the challenge id. Visibility stays what the direct reads gave.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- One field of a post's card, read as a signed-in member ('none' when the member gets no card).
create function pg_temp.card_field(p_viewer uuid, p_post uuid, p_field text)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', p_viewer)::text, true);
  perform set_config('role', 'authenticated', true);
  select coalesce(to_jsonb(c) ->> p_field, '~') into v_value from public.post_cards(array[p_post]) c;
  perform set_config('role', 'none', true);
  return coalesce(v_value, 'none');
end;
$$;

select plan(7);

insert into auth.users (id, email, raw_app_meta_data) values
  ('00000000-0000-4000-8000-00000000000a', 'alice@example.test', '{"provider":"google"}'),
  ('00000000-0000-4000-8000-00000000000b', 'bob@example.test', '{"provider":"google"}');
insert into public.cities (city_id, name_he, name_en, location) values
  ('c1', 'city-he', 'City One', 'SRID=4326;POINT(34.78 32.08)');
insert into public.worlds (slug, label_he, label_en) values ('items', 'items', 'Items'), ('challenges', 'challenges', 'Challenges');
insert into public.post_kinds (id, world_slug, slug, label_he, label_en, direction) values
  ('20000000-0000-4000-8000-000000000001', 'items', 'item', 'item', 'Item', 'either'),
  ('20000000-0000-4000-8000-000000000002', 'challenges', 'challenge', 'c', 'c', 'offer');

insert into public.posts (id, owner_id, world_slug, kind_id, post_type, direction, status, visibility, title, description, city_id)
values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'items',
   '20000000-0000-4000-8000-000000000001', 'standard', 'offer', 'open', 'Public', 'Sofa', 'three seats', 'c1'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-00000000000a', 'challenges',
   '20000000-0000-4000-8000-000000000002', 'challenge', 'offer', 'open', 'Public', 'Run daily', null, 'c1');
-- The challenge row exists in this transaction, so the deferred "a challenge post has its challenge" check holds.
insert into public.challenges (id, post_id, creator_id, scope, measurement, cadence) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002',
   '00000000-0000-4000-8000-00000000000a', 'community', 'yes_no', 'daily');

-- ── The card holds what the second read used to fetch ───────────────────────────────────────────
select is(pg_temp.card_field('00000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-000000000001', 'geo_approx'),
  (select p.geo_approx::text from public.posts p where p.id = '10000000-0000-4000-8000-000000000001'),
  'the map point is the posts column, as the same hex string');

update public.posts set source_language = 'he' where id = '10000000-0000-4000-8000-000000000001';
select is(pg_temp.card_field('00000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-000000000001', 'source_language'), 'he',
  'the detected language comes from the card');

select is(pg_temp.card_field('00000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-000000000001', 'shown_street'),
  coalesce((select p.shown_street from public.posts p where p.id = '10000000-0000-4000-8000-000000000001'), '~'),
  'the street the poster chose to show comes from the card');

select is(pg_temp.card_field('00000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-000000000001', 'status_before_removal'), '~',
  'an open post restores nothing');
select set_config('kc.fsm_role', 'admin', true);
update public.posts set status = 'removed_admin' where id = '10000000-0000-4000-8000-000000000001';
select is(pg_temp.card_field('00000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-000000000001', 'status_before_removal'), 'open',
  'a removed post names the status a restore returns it to');

-- ── The challenge id ────────────────────────────────────────────────────────────────────────────
select is(pg_temp.card_field('00000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-000000000002', 'challenge_id'),
  '30000000-0000-4000-8000-000000000001', 'the card of a challenge post names its challenge');
select is(pg_temp.card_field('00000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-000000000001', 'challenge_id'), '~',
  'a post that is not a challenge names none');

select * from finish();
rollback;
