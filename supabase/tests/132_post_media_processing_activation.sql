-- Activation of the sanitized post-photo copies (KC#2316): the copy keeps the upload's type and
-- pixel size within the worker's caps, completion checks the stored type against the key, a new
-- job starts the worker, a minute job is the safety net, and photos queued before activation are
-- picked up once. The DEV experiment's release call is gone.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(16);

-- The error message of a statement, or 'ok'.
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
values ('00000000-0000-4000-8000-00000000000a', 'a@example.test', '{"provider":"google"}');
insert into public.cities (city_id, name_he, name_en, location) values ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)');
insert into public.worlds (slug, label_he, label_en) values ('items', 'items', 'items');
insert into public.post_kinds (id, world_slug, slug, label_he, label_en, direction)
values ('20000000-0000-4000-8000-000000000001', 'items', 'item', 'item', 'item', 'either');
insert into public.posts (id, owner_id, world_slug, kind_id, direction, status, visibility, title, city_id)
values ('40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'items',
        '20000000-0000-4000-8000-000000000001', 'request', 'open', 'Public', 'p', 'c1');
insert into storage.objects (bucket_id, name, metadata)
values ('post-images', '00000000-0000-4000-8000-00000000000a/b/0.png', '{"mimetype":"image/png","size":1000}');
-- The job is queued by the AFTER INSERT trigger, as for a device's insert.
insert into public.post_media (post_id, owner_id, storage_key, ordinal, mime_type, size_bytes)
values ('40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a',
        '00000000-0000-4000-8000-00000000000a/b/0.png', 0, 'image/png', 1000);

select is(kc_private.post_media_derivative_key('00000000-0000-4000-8000-00000000000a',
            '50000000-0000-4000-8000-000000000001', 2, 'image/png'),
  'derived/00000000-0000-4000-8000-00000000000a/50000000-0000-4000-8000-000000000001-a2.png',
  'a PNG copy gets a .png key');
select is(kc_private.post_media_derivative_key('00000000-0000-4000-8000-00000000000a',
            '50000000-0000-4000-8000-000000000001', 2),
  'derived/00000000-0000-4000-8000-00000000000a/50000000-0000-4000-8000-000000000001-a2.jpg',
  'a JPEG copy (the default) gets a .jpg key');

create temp table c as select * from public.post_media_processing_claim(1, 300);
create temp table k as
  select kc_private.post_media_derivative_key(owner_id, media_id, attempt, 'image/png') as png,
         kc_private.post_media_derivative_key(owner_id, media_id, attempt, 'image/jpeg') as jpg
    from c;
insert into storage.objects (bucket_id, name, metadata)
select 'post-images', k.png, '{"mimetype":"image/png","size":900}' from k;

select is(pg_temp.err(format('select public.post_media_processing_complete(%L, %L, %L, 900, 3000, 2000)',
            (select media_id from c), (select lease_token from c), (select jpg from k))),
  'derivative_not_stored', 'a .jpg key needs a stored JPEG: the type is checked against the key');
select is(pg_temp.err(format('select public.post_media_processing_complete(%L, %L, %L, 900, 4096, 4097)',
            (select media_id from c), (select lease_token from c), (select png from k))),
  'invalid_derivative', 'an edge over 4096 px is refused');
select is(pg_temp.err(format('select public.post_media_processing_complete(%L, %L, %L, 900, 0, 10)',
            (select media_id from c), (select lease_token from c), (select png from k))),
  'invalid_derivative', 'an empty dimension is refused');
select is(public.post_media_processing_complete((select media_id from c), (select lease_token from c),
            (select png from k), 900, 3000, 2000),
  'ready', 'a PNG copy larger than 2048 px (within the caps) completes');
select is((select mime_type || '|' || width || 'x' || height || '|' || (storage_key = (select png from k))::text
             from public.post_media where id = (select media_id from c)),
  'image/png|3000x2000|true', 'the row points at the PNG copy with its type and size');

select hasnt_function('public', 'post_media_processing_release', 'the DEV experiment release call is gone');

-- Starting the worker.
select has_trigger('kc_private', 'post_media_processing', 'post_media_processing_kick', 'a new job starts the worker');
select is((select debounce from kc_private.edge_function_kicks where function_name = 'process-post-media'),
  interval '2 seconds', 'the start is debounced to one call per 2 s');
select is((select schedule || '|' || command || '|' || enabled::text from kc_private.scheduled_jobs where name = 'post_media_process'),
  '* * * * *|select kc_private.post_media_process_tick()|true', 'a minute job is the safety net');

-- The tick asks for the worker only when a job is due. This server has no pg_net, so an attempted
-- call shows up as the "unavailable" warning naming the function.
delete from ops.warnings;
select is(kc_private.post_media_process_tick(), false, 'nothing due: no call');
select is((select count(*)::integer from ops.warnings), 0, 'nothing due: nothing attempted');

-- Photos from before activation: a pending row without a job is queued once.
delete from kc_private.post_media_processing;
insert into public.post_media (post_id, owner_id, storage_key, ordinal, mime_type, size_bytes)
values ('40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a',
        '00000000-0000-4000-8000-00000000000a/b/1.jpg', 1, 'image/jpeg', 1000);
delete from kc_private.post_media_processing;
select is(array[kc_private.post_media_processing_backfill(), kc_private.post_media_processing_backfill()],
  array[1, 0], 'the pending photo is queued once (the ready one is not); a second run queues nothing');
select is(kc_private.post_media_process_tick(), false, 'a due job: the tick tries a call (none is queued without pg_net)');
select is((select detail from ops.warnings where key = 'edge_invocation_unavailable'),
  'pg_net or Vault is not installed; process-post-media was not invoked', 'the attempted call named process-post-media');

select * from finish();
rollback;
