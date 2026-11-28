-- Private upload bucket for post photos (DESIGN.md §3 A, phase 3a; KC#2779): a member's original
-- lands in the private `post-uploads` bucket, readable by its owner only; the worker is handed the
-- source bucket, writes the copy to `post-images/derived/`, and completion moves the row there. The
-- orphan rule and `replace_post_media` know the bucket, and `post-images` behaves as before.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(24);

-- Runs a statement as member 'a' or 'b', or signed out (null): rows affected, or the error text.
create function pg_temp.act(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_rows bigint;
  v_role constant text := case when p_who is null then 'anon' else 'authenticated' end;
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', case when p_who is not null then '00000000-0000-4000-8000-00000000000' || p_who end,
    'role', v_role)::text, true);
  perform set_config('role', v_role, true);
  execute p_sql;
  get diagnostics v_rows = row_count;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '{}', true);
  return v_rows::text;
exception when others then
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '{}', true);
  return sqlerrm;
end;
$$;

-- The error text of a statement run as the test's own role, or 'ok'.
create function pg_temp.err(p_sql text)
returns text
language plpgsql
as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlerrm;
end;
$$;

insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b']) x;
insert into public.cities (city_id, name_he, name_en, location) values ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)');
insert into public.worlds (slug, label_he, label_en) values ('items', 'items', 'items');
insert into public.post_kinds (id, world_slug, slug, label_he, label_en, direction)
values ('20000000-0000-4000-8000-000000000001', 'items', 'item', 'item', 'item', 'either');
insert into public.posts (id, owner_id, world_slug, kind_id, direction, status, visibility, title, city_id)
values ('40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'items',
        '20000000-0000-4000-8000-000000000001', 'request', 'open', 'Public', 'p', 'c1');

-- ── The bucket and who may touch it ─────────────────────────────────────────────────────────────
select is((select public::text || ':' || file_size_limit || ':' || array_to_string(allowed_mime_types, '+')
             from storage.buckets where id = 'post-uploads'),
  'false:8388608:image/jpeg+image/png', 'post-uploads is private, 8 MiB, JPEG and PNG only');
-- Each refusal is recorded only as "not inserted": its error text differs between this server's
-- stand-in of the storage schema and the platform's.
select is(
  pg_temp.act('a', $$insert into storage.objects (bucket_id, name, metadata) values ('post-uploads',
    '00000000-0000-4000-8000-00000000000a/u/0.jpg', '{"mimetype":"image/jpeg","size":1000}')$$)
  || '|' || (pg_temp.act('a', $$insert into storage.objects (bucket_id, name) values ('post-uploads',
    '00000000-0000-4000-8000-00000000000b/u/0.jpg')$$) = '1')::text
  || '|' || (pg_temp.act(null, $$insert into storage.objects (bucket_id, name) values ('post-uploads', 'x/0.jpg')$$) = '1')::text,
  '1|false|false', 'a member uploads into their own folder only; signed out, nobody uploads');
select is(
  pg_temp.act('a', $$select 1 from storage.objects where bucket_id = 'post-uploads'$$)
  || '|' || pg_temp.act('b', $$select 1 from storage.objects where bucket_id = 'post-uploads'$$),
  '1|0', 'only the owner sees the object (signed URLs and removal need that)');
select is(pg_temp.act('a', $$update storage.objects set name = name || '.x' where bucket_id = 'post-uploads'$$), '0',
  'nobody renames or overwrites an upload in place');
select is(
  pg_temp.act('b', $$delete from storage.objects where bucket_id = 'post-uploads'$$)
  || '|' || (select count(*)::text from storage.objects where bucket_id = 'post-uploads'),
  '0|1', 'another member removes nothing of it');

-- ── Queue, claim and completion ─────────────────────────────────────────────────────────────────
insert into public.post_media (post_id, owner_id, storage_bucket, storage_key, ordinal, mime_type, size_bytes)
values ('40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'post-uploads',
        '00000000-0000-4000-8000-00000000000a/u/0.jpg', 0, 'image/jpeg', 1000);
select is((select q.source_bucket || ':' || q.source_key from kc_private.post_media_processing q
             join public.post_media m on m.id = q.media_id where m.ordinal = 0),
  'post-uploads:00000000-0000-4000-8000-00000000000a/u/0.jpg', 'a pending photo in post-uploads is queued with its bucket');

create temp table c as select * from public.post_media_processing_claim(1, 300);
select is((select storage_bucket || ':' || object_size || ':' || object_mimetype from c),
  'post-uploads:1000:image/jpeg', 'the claim names the source bucket and what Storage recorded there');

create temp table k as
  select kc_private.post_media_derivative_key(owner_id, media_id, attempt, 'image/jpeg') as key from c;
insert into storage.objects (bucket_id, name, metadata)
select 'post-images', key, '{"mimetype":"image/jpeg","size":"900"}' from k;
select is(public.post_media_processing_complete((select media_id from c), (select lease_token from c),
            (select key from k), 900, 800, 600),
  'ready', 'the copy in post-images completes the job');
select is((select storage_bucket || ':' || (storage_key = (select key from k))::text || ':' || processing_status
             from public.post_media where id = (select media_id from c)),
  'post-images:true:ready', 'the row now points at the public copy');
select is((select source_bucket || ':' || source_key || ':' || state from kc_private.post_media_processing
            where media_id = (select media_id from c)),
  'post-uploads:00000000-0000-4000-8000-00000000000a/u/0.jpg:done', 'the job still records where the original is');

-- A row whose bucket changed after the claim is not finalized.
insert into storage.objects (bucket_id, name, metadata) values ('post-uploads',
  '00000000-0000-4000-8000-00000000000a/u/1.jpg', '{"mimetype":"image/jpeg","size":1000}');
insert into public.post_media (post_id, owner_id, storage_bucket, storage_key, ordinal, mime_type, size_bytes)
values ('40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'post-uploads',
        '00000000-0000-4000-8000-00000000000a/u/1.jpg', 1, 'image/jpeg', 1000);
create temp table c2 as select * from public.post_media_processing_claim(1, 300);
update public.post_media set storage_bucket = 'post-images' where id = (select media_id from c2);
select is(public.post_media_processing_complete((select media_id from c2), (select lease_token from c2),
            'derived/x', 900, 800, 600),
  'changed', 'a row that moved to another bucket since the claim is skipped');
delete from public.post_media where id = (select media_id from c2);

-- ── Backward compatible: post-images uploads and other buckets ──────────────────────────────────
insert into public.post_media (post_id, owner_id, storage_key, ordinal, mime_type, size_bytes)
values ('40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a',
        '00000000-0000-4000-8000-00000000000a/p/2.jpg', 2, 'image/jpeg', 1000);
select is((select q.source_bucket from kc_private.post_media_processing q
             join public.post_media m on m.id = q.media_id where m.ordinal = 2),
  'post-images', 'a photo uploaded to post-images is queued as before');
insert into public.post_media (post_id, owner_id, storage_bucket, storage_key, ordinal, mime_type, size_bytes)
values ('40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'other-bucket',
        '00000000-0000-4000-8000-00000000000a/o/3.jpg', 3, 'image/jpeg', 1000);
select is((select count(*)::integer from kc_private.post_media_processing q
             join public.post_media m on m.id = q.media_id where m.ordinal = 3),
  0, 'a photo in any other bucket is never queued');
delete from public.post_media where ordinal = 3;

-- ── Orphans ─────────────────────────────────────────────────────────────────────────────────────
select is((select string_agg(k, ',' order by k) from kc_private.storage_orphan_keys('post-uploads', array[
    '00000000-0000-4000-8000-00000000000a/u/0.jpg',
    '00000000-0000-4000-8000-00000000000a/u/0-thumb.jpg',
    '00000000-0000-4000-8000-00000000000a/u/9.jpg']) k),
  '00000000-0000-4000-8000-00000000000a/u/9.jpg',
  'post-uploads: the original a job was made from and its thumb are kept; an unknown upload is an orphan');
select is((select string_agg(k, ',' order by k) from kc_private.storage_orphan_keys('post-images', array[
    '00000000-0000-4000-8000-00000000000a/u/0.jpg',
    '00000000-0000-4000-8000-00000000000a/p/2.jpg',
    (select key from k)]) k),
  '00000000-0000-4000-8000-00000000000a/u/0.jpg',
  'post-images: its own job source and the copy are kept; a post-uploads job protects nothing there');

-- ── replace_post_media ──────────────────────────────────────────────────────────────────────────
select is(pg_temp.act('a', $$select public.replace_post_media('40000000-0000-4000-8000-000000000001',
    '[{"storage_key":"00000000-0000-4000-8000-00000000000a/u/0.jpg","mime_type":"image/jpeg","size_bytes":1000,"storage_bucket":"chat-media"}]')$$),
  'invalid_input', 'an item may name post-images or post-uploads only');

create temp table kept as select id, storage_key from public.post_media where ordinal = 0;
select is(pg_temp.act('a', format($$select public.replace_post_media('40000000-0000-4000-8000-000000000001', %L)$$,
    jsonb_build_array(
      jsonb_build_object('storage_key', (select storage_key from kept), 'mime_type', 'image/jpeg', 'size_bytes', 900),
      jsonb_build_object('storage_key', '00000000-0000-4000-8000-00000000000a/u/5.jpg', 'mime_type', 'image/jpeg',
                         'size_bytes', 1000, 'storage_bucket', 'post-uploads'),
      jsonb_build_object('storage_key', '00000000-0000-4000-8000-00000000000a/p/2.jpg', 'mime_type', 'image/jpeg',
                         'size_bytes', 1000, 'storage_bucket', 'post-uploads')))),
  '1', 'the owner replaces the gallery with a kept copy and new uploads');
select is((select id from public.post_media where ordinal = 0), (select id from kept),
  'the processed copy (post-images by default) is kept as it is');
select is((select storage_bucket || ':' || processing_status from public.post_media where ordinal = 1),
  'post-uploads:pending', 'a new upload is stored with its bucket');
select is((select q.source_bucket from kc_private.post_media_processing q
             join public.post_media m on m.id = q.media_id where m.ordinal = 1),
  'post-uploads', 'and queued with it');
select is((select storage_bucket from public.post_media where ordinal = 2), 'post-uploads',
  'the same key in another bucket is another file: the row is replaced, not kept');
select is((select count(*)::integer from public.post_media where post_id = '40000000-0000-4000-8000-000000000001'), 3,
  'the gallery is exactly the three items');

-- ── Photos queued before the queue knew buckets ─────────────────────────────────────────────────
delete from kc_private.post_media_processing
 where media_id = (select id from public.post_media where ordinal = 1);
select is(kc_private.post_media_processing_backfill(), 1, 'the backfill queues a pending post-uploads photo too');
select is((select q.source_bucket from kc_private.post_media_processing q
             join public.post_media m on m.id = q.media_id where m.ordinal = 1),
  'post-uploads', 'with its bucket');

select * from finish();
rollback;
