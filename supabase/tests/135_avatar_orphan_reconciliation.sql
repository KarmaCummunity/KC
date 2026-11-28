-- Profile photo reconciliation (DESIGN.md §5, phase 2): an `avatars` object is kept exactly when a
-- member's avatar_url points at it or it is that object's `-thumb`; older generations, unsaved
-- uploads and legacy fixed paths nobody points at are orphans; external photo URLs never protect or
-- condemn anything; buckets that are not recorded row by row are still never judged.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(10);

-- Lookup of a stored URL's object key.
select is(kc_private.avatar_object_key('https://x.supabase.co/storage/v1/object/public/avatars/u1/avatar-g2.jpg?t=17'),
  'u1/avatar-g2.jpg', 'a public avatar URL gives its key, without the query');
select is(kc_private.avatar_object_key('https://x.supabase.co/storage/v1/object/public/avatars/u1/a.jpg#x'),
  'u1/a.jpg', 'a fragment is dropped too');
select is(kc_private.avatar_object_key('https://lh3.googleusercontent.com/a/photo.jpg'), null::text,
  'a provider photo is not an avatars object');
select is(kc_private.avatar_object_key('https://x.supabase.co/storage/v1/object/public/post-images/u1/a.jpg'), null::text,
  'another bucket''s URL is not an avatars object');
select is(kc_private.avatar_object_key(null), null::text, 'no URL, no key');

insert into auth.users (id, email, raw_app_meta_data) values
  ('00000000-0000-4000-8000-00000000000a', 'a@example.test', '{"provider":"google"}'),
  ('00000000-0000-4000-8000-00000000000b', 'b@example.test', '{"provider":"google"}');
update public.users set avatar_url =
  'https://x.supabase.co/storage/v1/object/public/avatars/00000000-0000-4000-8000-00000000000a/avatar-g2.jpg?t=1'
 where id = '00000000-0000-4000-8000-00000000000a';
update public.users set avatar_url = 'https://lh3.googleusercontent.com/a/photo.jpg'
 where id = '00000000-0000-4000-8000-00000000000b';

select is((select string_agg(k, ',' order by k) from kc_private.storage_orphan_keys('avatars', array[
    '00000000-0000-4000-8000-00000000000a/avatar-g2.jpg',
    '00000000-0000-4000-8000-00000000000a/avatar-g2-thumb.jpg',
    '00000000-0000-4000-8000-00000000000a/avatar-g1.jpg',
    '00000000-0000-4000-8000-00000000000a/avatar.jpg',
    '00000000-0000-4000-8000-00000000000b/avatar-g9.jpg']) k),
  '00000000-0000-4000-8000-00000000000a/avatar-g1.jpg,00000000-0000-4000-8000-00000000000a/avatar.jpg,00000000-0000-4000-8000-00000000000b/avatar-g9.jpg',
  'the current photo and its thumb are kept; an older generation, a legacy path and an unsaved upload are orphans');

update public.users set avatar_url = null where id = '00000000-0000-4000-8000-00000000000a';
select is((select count(*)::integer from kc_private.storage_orphan_keys('avatars', array[
    '00000000-0000-4000-8000-00000000000a/avatar-g2.jpg'])), 1,
  'once the member removes the photo, its object is an orphan');

-- A member changes their own photo the way the app does (a direct update of their users row): the
-- orphan rule must add nothing a member's write has to be allowed to run.
create function pg_temp.member_sets_avatar(p_url text)
returns text
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);
  update public.users set avatar_url = p_url where id = '00000000-0000-4000-8000-00000000000a';
  perform set_config('role', 'none', true);
  return 'ok';
exception when others then
  perform set_config('role', 'none', true);
  return sqlerrm;
end;
$$;
select is(pg_temp.member_sets_avatar(
    'https://x.supabase.co/storage/v1/object/public/avatars/00000000-0000-4000-8000-00000000000a/avatar-g3.jpg'),
  'ok', 'a member can still set their own photo (nothing in the rule runs with the member''s rights)');
select is((select count(*)::integer from kc_private.storage_orphan_keys('avatars', array[
    '00000000-0000-4000-8000-00000000000a/avatar-g3.jpg'])), 0, 'and the photo they just set is kept');

select is((select count(*)::integer from kc_private.storage_orphan_keys('chat-media', array['x/unknown.jpg'])), 0,
  'a bucket whose files are not recorded row by row is still never judged');

select * from finish();
rollback;
