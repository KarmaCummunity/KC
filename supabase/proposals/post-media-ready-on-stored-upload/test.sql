-- pgTAP suite for the PROPOSAL in migration.sql (not in supabase/tests/: it fails without it).
-- Run locally only: copy migration.sql into supabase/migrations/ under a scratch number, run
-- scripts/run-baseline-tests.sh <this file> against a LOCAL server, then delete the copy.
-- A member's photo becomes `ready` the moment its row is recorded, but only when the stored object
-- matches the row (type and byte size) and only for the member's own insert (KC#2316). Anything
-- else stays `pending` as before: a missing or mismatched file, odd metadata, a server insert, and
-- every row that existed before. Other members and the signed-out share card then see the photo.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Runs a statement as a member ('a' / 'b'), or signed out when null, and returns its one value as
-- text, the P0001 / 42501 message, or the SQLSTATE.
create function pg_temp.as_member(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  begin
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', '00000000-0000-4000-8000-00000000000' || p_who,
      'role', case when p_who is null then 'anon' else 'authenticated' end)::text, true);
    perform set_config('role', case when p_who is null then 'anon' else 'authenticated' end, true);
    execute p_sql into v_value;
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '{}', true);
    return coalesce(v_value, 'ok');
  exception when others then
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '{}', true);
    return case when sqlstate in ('P0001', '42501') then sqlerrm else sqlstate end;
  end;
end;
$$;

-- The object the storage service would have recorded for an upload of Alice's.
create function pg_temp.stored(p_key text, p_mime text, p_size text)
returns void
language sql
as $$
  insert into storage.objects (bucket_id, name, metadata)
  values ('post-images', '00000000-0000-4000-8000-00000000000a/' || p_key,
          jsonb_build_object('mimetype', p_mime, 'size', p_size));
$$;

-- Alice records one photo of post 1 at a gallery position, as the app does after the upload.
create function pg_temp.attach(p_key text, p_ordinal integer, p_mime text, p_size bigint)
returns text
language sql
as $$
  select pg_temp.as_member('a', format($q$insert into public.post_media (post_id, owner_id, storage_key, ordinal, mime_type, size_bytes)
      values ('40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a',
              '00000000-0000-4000-8000-00000000000a/' || %L, %s, %L, %s)
      returning 'ok'$q$, p_key, p_ordinal, p_mime, p_size));
$$;

create function pg_temp.status_of(p_key text)
returns text
language sql
as $$
  select coalesce((select processing_status from public.post_media
                    where storage_key = '00000000-0000-4000-8000-00000000000a/' || p_key), 'none');
$$;

select plan(14);

insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b']) x;
insert into public.cities (city_id, name_he, name_en, location) values ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)');
insert into public.worlds (slug, label_he, label_en) values ('items', 'items', 'items');
insert into public.post_kinds (id, world_slug, slug, label_he, label_en, direction)
values ('20000000-0000-4000-8000-000000000001', 'items', 'item', 'item', 'item', 'either');
insert into public.posts (id, owner_id, world_slug, kind_id, direction, status, visibility, title, city_id)
values ('40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'items',
        '20000000-0000-4000-8000-000000000001', 'request', 'open', 'Public', 'post 1', 'c1');

-- A row that existed before (written by a server job, no member): it must never be touched.
select pg_temp.stored('old/0.jpg', 'image/jpeg', '500');
insert into public.post_media (post_id, owner_id, storage_key, ordinal, mime_type, size_bytes)
values ('40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a',
        '00000000-0000-4000-8000-00000000000a/old/0.jpg', 4, 'image/jpeg', 500);
select is(pg_temp.status_of('old/0.jpg'), 'pending', 'a server insert (no member) keeps the pending path');

select pg_temp.stored('b1/0.jpg', 'image/jpeg', '1000');
select is(pg_temp.attach('b1/0.jpg', 0, 'image/jpeg', 1000) || '|' || pg_temp.status_of('b1/0.jpg'), 'ok|ready',
  'a member''s photo whose stored object matches the row is ready at once');
select is(current_setting('kc.fsm_role', true), '', 'the system role is not left set after the write');

select is(pg_temp.attach('b1/1.jpg', 1, 'image/jpeg', 1000) || '|' || pg_temp.status_of('b1/1.jpg'), 'ok|pending',
  'a row whose file is not in storage stays pending');
select pg_temp.stored('b1/2.jpg', 'image/jpeg', '999');
select is(pg_temp.attach('b1/2.jpg', 2, 'image/jpeg', 1000) || '|' || pg_temp.status_of('b1/2.jpg'), 'ok|pending',
  'a row whose size differs from the stored object stays pending');
select pg_temp.stored('b1/3.jpg', 'image/png', '1000');
select is(pg_temp.attach('b1/3.jpg', 3, 'image/jpeg', 1000) || '|' || pg_temp.status_of('b1/3.jpg'), 'ok|pending',
  'a row whose type differs from the stored object stays pending');

select is(pg_temp.status_of('old/0.jpg'), 'pending', 'rows that existed before are not backfilled');

select is(pg_temp.as_member('a', $$insert into public.post_media (post_id, owner_id, storage_key, ordinal, mime_type, size_bytes, processing_status)
    values ('40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a',
            '00000000-0000-4000-8000-00000000000a/b1/9.jpg', 1, 'image/jpeg', 1, 'ready') returning 'ok'$$),
  'permission denied for table post_media', 'a device still cannot write the status itself');

select is(pg_temp.as_member('b', $$select string_agg(m ->> 'storage_key', ',')
      from jsonb_array_elements(public.post_detail('40000000-0000-4000-8000-000000000001') -> 'media') m$$),
  '00000000-0000-4000-8000-00000000000a/b1/0.jpg', 'another member sees the ready photo and none of the pending ones');
select is(pg_temp.as_member('b', $$select (cover_media ->> 'storage_key')
      from public.post_cards(array['40000000-0000-4000-8000-000000000001'::uuid])$$),
  '00000000-0000-4000-8000-00000000000a/b1/0.jpg', 'the feed card carries it as the cover');
select is(pg_temp.as_member(null, $$select cover_key from public.post_share_card('40000000-0000-4000-8000-000000000001')$$),
  '00000000-0000-4000-8000-00000000000a/b1/0.jpg', 'the signed-out link preview carries it too');

-- An edit keeps the unchanged first photo and adds a newly stored one through replace_post_media.
select pg_temp.stored('b2/0.jpg', 'image/jpeg', '2000');
select is(pg_temp.as_member('a', $$select 'ok' from public.replace_post_media('40000000-0000-4000-8000-000000000001', jsonb_build_array(
      jsonb_build_object('storage_key', '00000000-0000-4000-8000-00000000000a/b1/0.jpg', 'mime_type', 'image/jpeg', 'size_bytes', 1000),
      jsonb_build_object('storage_key', '00000000-0000-4000-8000-00000000000a/b2/0.jpg', 'mime_type', 'image/jpeg', 'size_bytes', 2000)))$$)
    || '|' || pg_temp.status_of('b1/0.jpg') || '|' || pg_temp.status_of('b2/0.jpg'),
  'ok|ready|ready', 'an edit keeps the processed photo and the newly stored one is ready too');

-- (b) Visibility is still the post's: a ready photo of a draft or a private post stays out of
-- other members' reads and of the signed-out link preview.
insert into public.posts (id, owner_id, world_slug, kind_id, direction, status, visibility, title, city_id)
values ('40000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-00000000000a', 'items',
        '20000000-0000-4000-8000-000000000001', 'request', 'draft', 'Public', 'draft', 'c1'),
       ('40000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-00000000000a', 'items',
        '20000000-0000-4000-8000-000000000001', 'request', 'open', 'OnlyMe', 'only me', 'c1');
select pg_temp.stored('d/0.jpg', 'image/jpeg', '10'), pg_temp.stored('p/0.jpg', 'image/jpeg', '10');
select pg_temp.as_member('a', format($q$insert into public.post_media (post_id, owner_id, storage_key, ordinal, mime_type, size_bytes)
    values (%L, '00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000a/' || %L, 0, 'image/jpeg', 10) returning 'ok'$q$,
    p, k)) from (values ('40000000-0000-4000-8000-000000000002', 'd/0.jpg'), ('40000000-0000-4000-8000-000000000003', 'p/0.jpg')) v (p, k);
select is(pg_temp.as_member('b', $$select count(*)::text from public.post_media
      where post_id in ('40000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000003')$$),
  '0', 'another member cannot read the ready photos of a draft or a private post');
select is(pg_temp.as_member(null, $$select count(*)::text from public.post_share_card('40000000-0000-4000-8000-000000000002')$$)
    || pg_temp.as_member(null, $$select count(*)::text from public.post_share_card('40000000-0000-4000-8000-000000000003')$$),
  '00', 'neither a draft nor a private post gets a link-preview card');

select * from finish();
rollback;
