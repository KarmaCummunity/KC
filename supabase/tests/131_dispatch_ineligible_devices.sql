-- Queue cleanup must use immutable job lineage, not hide stale devices in a join.
-- Synthetic fixtures only; all mutations roll back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public;
select no_plan();
create function pg_temp.id(x text) returns uuid language sql immutable as $$select md5('dispatch-cleanup-'||x)::uuid$$;
insert into auth.users(id,email,raw_app_meta_data)
  select pg_temp.id(x),x||'@cleanup.example.test','{"provider":"google"}'::jsonb
  from unnest(array['actor','deleted','deactivated','reassigned','foreign','unknown']) x;
insert into public.user_devices(id,user_id,platform,push_token)
  select pg_temp.id(x||'-device'),pg_temp.id(x),'ios','synthetic-'||x
  from unnest(array['deleted','deactivated','reassigned','unknown']) x;
create temp table origins(label text,id bigint);
insert into origins select x,kc_private.outbox_enqueue('notification',jsonb_build_object(
  'kind','chat_message','recipient_id',pg_temp.id(x),'actor_id',pg_temp.id('actor'),
  'entity',jsonb_build_object('type','chat','id',pg_temp.id('chat-'||x)),
  'data',jsonb_build_object('message_id',pg_temp.id('message-'||x),'chat_id',pg_temp.id('chat-'||x))))
  from unnest(array['deleted','deactivated','reassigned','unknown']) x;
create function pg_temp.scope(label text) returns jsonb language sql as $$
  select jsonb_build_object('event_ids',jsonb_build_array(id)) from origins where origins.label=$1;
$$;
select is(kc_private.dispatch_deliver(pg_temp.scope(label)),1,label||': queued before eligibility change') from origins order by label;
create temp table before_inbox as select * from public.notifications where user_id in
  (select pg_temp.id(label) from origins);
select is((select count(*) from kc_private.dispatch_jobs where origin_event_id in(select id from origins)),4::bigint,'four pending jobs queued');
-- Actual device deactivation deletes its registration; there is no device active flag.
delete from public.user_devices where id=pg_temp.id('deleted-device');
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id('deactivated'),'role','authenticated')::text,true);
select public.request_account_deletion();
select ok(not exists(select 1 from public.user_devices where id=pg_temp.id('deactivated-device')),'account deactivation deletes device registration');
update public.user_devices set user_id=pg_temp.id('foreign') where id=pg_temp.id('reassigned-device');
-- An ambiguous send remains held even after its device disappears.
update kc_private.dispatch_jobs set phase='send_unknown',last_error='synthetic_ambiguous_send'
  where origin_event_id=(select id from origins where label='unknown');
delete from public.user_devices where id=pg_temp.id('unknown-device');
create temp table before_jobs as select * from kc_private.dispatch_jobs where origin_event_id in(select id from origins);
-- Caller-supplied foreign ownership still fails preflight with NO cleanup side effects.
select is((select count(*) from kc_private.dispatch_claim(pg_temp.scope('reassigned')||jsonb_build_object(
  'device_id',pg_temp.id('reassigned-device')),'pending')),0::bigint,'explicit device now owned by foreign user is empty');
select is((select count(*) from kc_private.dispatch_claim(pg_temp.scope('deleted')||jsonb_build_object(
  'device_id',pg_temp.id('deleted-device')),'pending')),0::bigint,'explicit missing-device scope is empty');
select is((select count(*) from kc_private.dispatch_claim(pg_temp.scope('reassigned')||jsonb_build_object(
  'recipient_id',pg_temp.id('foreign')),'pending')),0::bigint,'explicit foreign recipient is empty');
select is((select count(*) from (select * from kc_private.dispatch_jobs where origin_event_id in(select id from origins)
  except select * from before_jobs) x),0::bigint,'foreign scopes leave all job fields unchanged');
-- Event-only scope can terminalize its own now-ineligible jobs without authorising POST.
select is((select count(*) from kc_private.dispatch_claim(pg_temp.scope(label),'pending')),0::bigint,
  label||': no provider-send candidate returned') from origins order by label;
select is((select phase from kc_private.dispatch_jobs where origin_event_id=o.id),'skipped',
  label||': terminal ineligible disposition') from origins o where label<>'unknown' order by label;
select ok((select finished_at is not null and last_error='no_longer_pushable' and attempts=0
  and lease_id is null and lease_until is null from kc_private.dispatch_jobs where origin_event_id=o.id),
  label||': terminal without attempt bump or send lease') from origins o where label<>'unknown' order by label;
select is((select count(*) from (select * from kc_private.dispatch_jobs where origin_event_id=(select id from origins where label='unknown')
  except select * from before_jobs where origin_event_id=(select id from origins where label='unknown')) x),0::bigint,
  'unknown send remains byte-for-byte held, never retried or skipped');
select is((select user_id from public.user_devices where id=pg_temp.id('reassigned-device')),pg_temp.id('foreign'),
  'cleanup does not alter the new owner device');
select is((select count(*) from before_inbox),4::bigint,'all four inbox fixtures existed');
select is((select count(*) from (select * from before_inbox except select * from public.notifications) x),0::bigint,
  'cleanup leaves every inbox row unchanged');
select is((select count(*) from kc_private.dispatch_claim(jsonb_build_object('event_ids',
  (select jsonb_agg(id) from origins)),'pending')),0::bigint,'repeat cleanup returns no provider candidates');
select * from finish();
rollback;
