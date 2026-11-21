-- The DEV resource experiment (process-post-media profile `dev-experiment-1024`) hands back a job
-- whose source is over its cap: post_media_processing_release puts it back in the queue untouched,
-- without spending an attempt, and keeps it out of the experiment's way for a day. Only the
-- current lease holder can release; no client role can call it.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(6);

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
values ('post-images', '00000000-0000-4000-8000-00000000000a/b/0.jpg', '{"mimetype":"image/jpeg","size":1000}');
-- The job is queued by the AFTER INSERT trigger (a server insert, as a device's would be).
insert into public.post_media (post_id, owner_id, storage_key, ordinal, mime_type, size_bytes)
values ('40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a',
        '00000000-0000-4000-8000-00000000000a/b/0.jpg', 0, 'image/jpeg', 1000);

create temp table c as select * from public.post_media_processing_claim(1, 300);

select is(public.post_media_processing_release((select media_id from c), gen_random_uuid(), 'experiment_source_over_cap'),
  'stale', 'only the lease holder can release');
select is(public.post_media_processing_release((select media_id from c), (select lease_token from c), 'experiment_source_over_cap'),
  'released', 'the lease holder releases the job');
select is((select state || '|' || attempts || '|' || (lease_token is null)::text || '|' || last_error
             from kc_private.post_media_processing where media_id = (select media_id from c)),
  'queued|0|true|experiment_source_over_cap', 'back in the queue, no attempt spent, lease cleared, reason kept');
select ok((select next_attempt_at > now() + interval '23 hours' from kc_private.post_media_processing
            where media_id = (select media_id from c)),
  'not handed out again for a day');
select is((select processing_status from public.post_media where id = (select media_id from c)), 'pending',
  'the row is untouched (still pending, never failed)');
select is((select string_agg(r || ':' || has_function_privilege(r, 'public.post_media_processing_release(uuid,uuid,text)', 'execute')::text, ',' order by r)
             from unnest(array['anon', 'authenticated']) r),
  'anon:false,authenticated:false', 'no client role may call it');

select * from finish();
rollback;
