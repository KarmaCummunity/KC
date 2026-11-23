-- Feed filter "only posts with a photo" (FR-FEED-004; issue #2540): feed_page and post search
-- return only posts with at least one ready image when p_filters carries has_image = true.
-- A pending file and a video do not count; without the key (or with false) nothing changes.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Titles of Bob's feed page for the given filters, in order, as one string.
create function pg_temp.titles(p_filters text)
returns text
language plpgsql
as $$
declare
  v_out text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', '00000000-0000-4000-8000-00000000000b', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute format(
    $q$select coalesce(string_agg((f.card).title, ',' order by (f.card).title), '') from public.feed_page(null, 50, %L) f$q$,
    p_filters) into v_out;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '{}', true);
  return v_out;
end;
$$;

select plan(5);

insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b']) x;
insert into public.cities (city_id, name_he, name_en, location) values ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)');
insert into public.worlds (slug, label_he, label_en, shows_in_main_feed) values ('items', 'items', 'items', true);
insert into public.post_kinds (id, world_slug, slug, label_he, label_en, direction)
values ('20000000-0000-4000-8000-000000000001', 'items', 'item', 'item', 'item', 'either');
-- Alice's public open posts: 1 has a ready image, 2 a pending one, 3 only a ready video, 4 no file.
insert into public.posts (id, owner_id, world_slug, kind_id, direction, status, visibility, title, city_id)
select ('40000000-0000-4000-8000-00000000000' || n)::uuid, '00000000-0000-4000-8000-00000000000a', 'items',
       '20000000-0000-4000-8000-000000000001', 'offer', 'open', 'Public', 'post ' || n, 'c1'
  from generate_series(1, 4) n;
insert into public.post_media (post_id, owner_id, kind, storage_key, ordinal, mime_type, size_bytes)
values
  ('40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'image',
   '00000000-0000-4000-8000-00000000000a/1/0.jpg', 0, 'image/jpeg', 1000),
  ('40000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-00000000000a', 'image',
   '00000000-0000-4000-8000-00000000000a/2/0.jpg', 0, 'image/jpeg', 1000),
  ('40000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-00000000000a', 'video',
   '00000000-0000-4000-8000-00000000000a/3/0.mp4', 0, 'video/mp4', 1000);
-- The media pipeline marks the files of posts 1 and 3 processed; post 2's stays pending.
set local "kc.fsm_role" = 'system';
update public.post_media set processing_status = 'ready'
 where post_id in ('40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000003');
set local "kc.fsm_role" = '';

select is(pg_temp.titles('{"has_image": true}'), 'post 1',
  'only the post with a ready image is returned');
select is(pg_temp.titles('{}'), 'post 1,post 2,post 3,post 4', 'without the key every post is returned');
select is(pg_temp.titles('{"has_image": false}'), 'post 1,post 2,post 3,post 4', 'false changes nothing');
select is(pg_temp.titles('{"has_image": true, "scope": "search", "q": "post"}'), 'post 1',
  'search honours the key too');
select is(pg_temp.titles('{"has_image": true, "sort": "oldest", "world": "items"}'), 'post 1',
  'it combines with the sort and the world filters');

select * from finish();
rollback;
