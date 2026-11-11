-- The preview card of a shared post link: a signed-out caller gets the public facts of a public,
-- open or delivered post and nothing for any other post, and still cannot read `posts` itself.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- The rows the card function returns for a post, read as a signed-out caller (as the link crawler is).
create function pg_temp.card_as_anon(p_post_id uuid)
returns text
language plpgsql
as $$
declare
  v_card text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);
  perform set_config('role', 'anon', true);
  select coalesce(string_agg(
           title || '|' || coalesce(description, '-') || '|' || direction || '|' || world_slug || '|' || status
           || '|' || coalesce(city_name_he, '-') || '|' || coalesce(cover_bucket || ':' || cover_key, '-'), ';'), 'none')
    into v_card
    from public.post_share_card(p_post_id);
  perform set_config('role', 'none', true);
  return v_card;
end;
$$;

select plan(11);

-- Alice owns the posts; Bob is the owner of a post while his account is suspended.
insert into auth.users (id, email, raw_app_meta_data) values
  ('00000000-0000-4000-8000-00000000000a', 'alice@example.test', '{"provider":"google"}'),
  ('00000000-0000-4000-8000-00000000000b', 'bob@example.test', '{"provider":"google"}');
insert into public.cities (city_id, name_he, name_en, location) values
  ('c1', 'city-he', 'City One', 'SRID=4326;POINT(34.78 32.08)');
insert into public.worlds (slug, label_he, label_en) values ('items', 'items', 'Items');
insert into public.post_kinds (id, world_slug, slug, label_he, label_en, direction) values
  ('20000000-0000-4000-8000-000000000001', 'items', 'item', 'item', 'Item', 'either');

insert into public.posts (id, owner_id, world_slug, kind_id, direction, status, visibility, title, description, city_id)
values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'items',
   '20000000-0000-4000-8000-000000000001', 'offer', 'open', 'Public', 'Sofa', 'three seats', 'c1'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-00000000000a', 'items',
   '20000000-0000-4000-8000-000000000001', 'request', 'open', 'FollowersOnly', 'Followers only', null, 'c1'),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-00000000000a', 'items',
   '20000000-0000-4000-8000-000000000001', 'request', 'open', 'OnlyMe', 'Only me', null, 'c1'),
  ('10000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-00000000000a', 'items',
   '20000000-0000-4000-8000-000000000001', 'offer', 'draft', 'Public', 'A draft', null, 'c1'),
  ('10000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-00000000000b', 'items',
   '20000000-0000-4000-8000-000000000001', 'offer', 'open', 'Public', 'Suspended owner', null, 'c1'),
  ('10000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-00000000000a', 'items',
   '20000000-0000-4000-8000-000000000001', 'offer', 'open', 'Public', 'Removed', null, 'c1');
-- Two photos: the first by gallery position shows; a video and an unprocessed photo never do.
insert into public.post_media (post_id, owner_id, kind, storage_key, ordinal, mime_type, size_bytes, processing_status)
values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'image', 'a/second.jpg', 1, 'image/jpeg', 10, 'ready'),
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'image', 'a/first.jpg', 0, 'image/jpeg', 10, 'ready'),
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'image', 'a/pending.jpg', 2, 'image/jpeg', 10, 'pending');
update public.user_account set status = 'suspended_admin' where user_id = '00000000-0000-4000-8000-00000000000b';

select is(pg_temp.card_as_anon('10000000-0000-4000-8000-000000000001'),
  'Sofa|three seats|offer|items|open|city-he|post-images:a/first.jpg',
  'a signed-out caller gets the public facts and the first processed photo of a public open post');
select is(pg_temp.card_as_anon('10000000-0000-4000-8000-000000000002'), 'none',
  'a followers-only post has no card');
select is(pg_temp.card_as_anon('10000000-0000-4000-8000-000000000003'), 'none',
  'an only-me post has no card');
select is(pg_temp.card_as_anon('10000000-0000-4000-8000-000000000004'), 'none',
  'a draft has no card');
select is(pg_temp.card_as_anon('10000000-0000-4000-8000-000000000005'), 'none',
  'a post of a member whose account is not active has no card');
select is(pg_temp.card_as_anon('10000000-0000-4000-8000-0000000000ff'), 'none',
  'an unknown id has no card, the same answer as a hidden post');

-- A delivered post keeps its card, with the new status.
select set_config('kc.fsm_role', 'owner', true);
update public.posts set status = 'closed_delivered' where id = '10000000-0000-4000-8000-000000000001';
select set_config('kc.fsm_role', '', true);
select is(pg_temp.card_as_anon('10000000-0000-4000-8000-000000000001'),
  'Sofa|three seats|offer|items|closed_delivered|city-he|post-images:a/first.jpg',
  'a delivered public post keeps its card');

-- Moderation takes a post off the card.
select set_config('kc.fsm_role', 'admin', true);
update public.posts set status = 'removed_admin' where id = '10000000-0000-4000-8000-000000000006';
select set_config('kc.fsm_role', '', true);
select is(pg_temp.card_as_anon('10000000-0000-4000-8000-000000000006'), 'none',
  'a post removed by moderation has no card');

-- The function is the only door: the table stays closed to signed-out callers.
select ok(has_function_privilege('anon', 'public.post_share_card(uuid)', 'execute'),
  'a signed-out caller may run the card function');
select ok(not has_table_privilege('anon', 'public.posts', 'select'),
  'a signed-out caller still cannot read posts');
select ok((select prosecdef from pg_proc where oid = 'public.post_share_card(uuid)'::regprocedure)
    and (select proconfig @> array['search_path=""'] from pg_proc where oid = 'public.post_share_card(uuid)'::regprocedure),
  'the card function is a definer with an empty search path');

select * from finish();
rollback;
