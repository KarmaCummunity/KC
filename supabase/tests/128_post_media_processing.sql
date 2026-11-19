-- KC#2316: real server-only FSM transitions, leases and backlog (no public RPC).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select plan(14);

insert into auth.users(id, email, raw_app_meta_data)
values ('00000000-0000-4000-8000-00000000000a', 'media@example.test', '{"provider":"google"}');
insert into public.cities(city_id, name_he, name_en) values ('media-city', 'test', 'test');
insert into public.worlds(slug, label_he, label_en) values ('items', 'test', 'test');
insert into public.post_kinds(id, world_slug, slug, label_he, label_en, direction)
values ('20000000-0000-4000-8000-000000000001', 'items', 'item', 'test', 'test', 'either');
insert into public.posts(id, owner_id, world_slug, kind_id, direction, status, visibility, title, city_id)
values ('40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'items',
 '20000000-0000-4000-8000-000000000001', 'offer', 'open', 'Public', 'photo test', 'media-city');
insert into public.post_media(id, post_id, owner_id, storage_key, ordinal, mime_type, size_bytes, created_at)
select ('50000000-0000-4000-8000-00000000000' || n)::uuid, '40000000-0000-4000-8000-000000000001',
 '00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000a/' || n || '.jpg', n,
 'image/jpeg', 100, now() - interval '1 year' from generate_series(0, 1) n;
select is((select cover_media from public.post_cards(array['40000000-0000-4000-8000-000000000001']::uuid[])),
 null::jsonb, 'pending photo has no feed cover');
select is((select count(*) from kc_private.claim_post_media()), 2::bigint, 'claims old backlog without a lookback cutoff');
select is((select count(*) from kc_private.claim_post_media()), 0::bigint, 'active leases cannot be claimed twice');
select is(kc_private.finish_post_media('50000000-0000-4000-8000-000000000000', 99, true), false, 'stale token refused');
select is(kc_private.finish_post_media('50000000-0000-4000-8000-000000000000', 1, true), true, 'successful processing completes');
select is((select processing_status from public.post_media where ordinal = 0), 'ready', 'system FSM transition persisted');
select ok((select cover_media is not null from public.post_cards(array['40000000-0000-4000-8000-000000000001']::uuid[])),
 'newly processed photo is the feed cover');
select is(coalesce(current_setting('kc.fsm_role', true), ''), '', 'system role does not leak');
select is(kc_private.finish_post_media('50000000-0000-4000-8000-000000000001', 1, false), false, 'first failure stays pending');
update kc_private.post_media_work set attempts = 3 where media_id = '50000000-0000-4000-8000-000000000001';
select is(kc_private.finish_post_media('50000000-0000-4000-8000-000000000001', 3, false), true, 'exhausted retries complete as failure');
select is((select processing_status from public.post_media where ordinal = 1), 'failed', 'bad photo is not stuck pending');
select is((select count(*) from kc_private.claim_post_media()), 0::bigint, 'terminal rows are never requeued');
select ok(not has_function_privilege('authenticated', 'kc_private.finish_post_media(uuid,integer,boolean)', 'execute'),
 'a device cannot mark media ready');
select ok(not has_function_privilege('anon', 'kc_private.claim_post_media()', 'execute'), 'anonymous callers cannot lease work');
select * from finish();
rollback;
