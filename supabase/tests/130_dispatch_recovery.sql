-- Real SQL semantics, not string matching. All data is synthetic and rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public;
select no_plan();
create function pg_temp.id(x text) returns uuid language sql immutable as $$select md5('dispatch-test-'||x)::uuid$$;
insert into auth.users(id,email,raw_app_meta_data)
  select pg_temp.id(x),x||'@dispatch.example.test','{"provider":"google"}'::jsonb from unnest(array['a','b','c']) x;
insert into public.user_devices(id,user_id,platform,push_token) values
  (pg_temp.id('b1'),pg_temp.id('b'),'ios','token-b1'),
  (pg_temp.id('b2'),pg_temp.id('b'),'android','token-b2'),
  (pg_temp.id('c1'),pg_temp.id('c'),'ios','token-c1');
create function pg_temp.emit(recipient text, label text) returns bigint language sql as $$
  select kc_private.outbox_enqueue('notification',jsonb_build_object('kind','chat_message',
    'recipient_id',pg_temp.id(recipient),'actor_id',pg_temp.id('a'),
    'entity',jsonb_build_object('type','chat','id',pg_temp.id('chat')),
    'data',jsonb_build_object('message_id',pg_temp.id(label),'chat_id',pg_temp.id('chat'))));
$$;
create temp table origins(label text,id bigint);
insert into origins values ('b',pg_temp.emit('b','message-1')),('c',pg_temp.emit('c','message-c'));
create function pg_temp.scope(label text) returns jsonb language sql as $$
  select jsonb_build_object('event_ids',jsonb_build_array(id)) from origins where origins.label=$1;
$$;
select ok(not kc_private.dispatch_scope_valid('{}'),'empty scope invalid');
select ok(not kc_private.dispatch_scope_valid('{"event_ids":[1,null],"recipient_id":"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"}'),'mixed invalid rejects whole scope');
select ok(not kc_private.dispatch_scope_valid('{"event_ids":[],"device_id":"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"}'),'empty event array cannot broaden device filter');
select ok(not kc_private.dispatch_scope_valid('{"event_ids":[9007199254740992]}'),'unsafe integer invalid');
select ok(not kc_private.dispatch_scope_valid('{"min_event_id":1}'),'caller cutoff forbidden');
select ok(not kc_private.dispatch_scope_valid('{"automatic":true,"event_ids":[1]}'),'automatic cannot mix explicit scope');
select throws_ok($$select kc_private.dispatch_deliver('{}')$$,'P0001','invalid dispatch scope','invalid SQL scope fails closed');
select is(kc_private.dispatch_deliver('{"automatic":true}'),0,'gate absent: no automatic delivery');
select is((select count(*) from kc_private.dispatch_admissions),0::bigint,'preactivation events have no epoch');
select is(kc_private.dispatch_deliver(pg_temp.scope('b')||jsonb_build_object('recipient_id',pg_temp.id('c'))),0,'foreign recipient is empty');
select is(kc_private.dispatch_deliver(pg_temp.scope('b')||jsonb_build_object('device_id',pg_temp.id('c1'))),0,'foreign device is empty');
select is((select sum(attempts) from kc_private.outbox_events where id in(select id from origins)),0::bigint,'foreign scopes did not bump attempts');
select is((select count(*) from public.notifications where user_id in(pg_temp.id('b'),pg_temp.id('c'))),0::bigint,'foreign scopes created no inbox rows');
-- Force job enqueue failure. The real notifications_deliver mutation must roll back.
create function pg_temp.fail_enqueue() returns trigger language plpgsql as $$begin
  if current_setting('test.dispatch_enqueue_fail',true)='on' then raise exception 'synthetic enqueue failure'; end if;
  return new; end;$$;
create trigger test_dispatch_enqueue_fail before insert on kc_private.dispatch_jobs for each row execute function pg_temp.fail_enqueue();
select set_config('test.dispatch_enqueue_fail','on',true);
select is(kc_private.dispatch_deliver(pg_temp.scope('b')),0,'enqueue failure returns no delivered event');
select is((select count(*) from public.notifications where user_id=pg_temp.id('b')),0::bigint,'inbox mutation rolled back with enqueue');
select ok((select processed_at is null from kc_private.outbox_events where id=(select id from origins where label='b')),'origin completion rolled back');
select set_config('test.dispatch_enqueue_fail','off',true);
update kc_private.outbox_events set available_at=now() where id in(select id from origins);
select is(kc_private.dispatch_deliver(pg_temp.scope('b')||jsonb_build_object('device_id',pg_temp.id('b1'))),1,'bounded delivery creates inbox');
select is((select count(*) from kc_private.dispatch_jobs),2::bigint,'both native device jobs durable; omitted device pending');
select is(kc_private.dispatch_deliver(pg_temp.scope('b')),0,'repeat origin delivery is idempotent');
select is((select count(*) from public.notifications where user_id=pg_temp.id('b')),1::bigint,'one inbox row');
select is((select attempts from kc_private.outbox_events where id=(select id from origins where label='c')),0,'other origin untouched');
create temp table claimed(job jsonb);
insert into claimed select * from kc_private.dispatch_claim(pg_temp.scope('b'),'pending');
select is((select count(*) from claimed),2::bigint,'both per-device jobs claimable');
select is((select count(*) from kc_private.dispatch_claim(pg_temp.scope('b'),'pending')),0::bigint,'live leases cannot be reclaimed');
select ok((select bool_and(job ->> 'lease_id' is not null) from claimed),'fresh lease on each job');
select is((select count(*) from kc_private.dispatch_begin_send(pg_temp.scope('b'),
  (select jsonb_agg(jsonb_build_object('id',job -> 'id','lease_id',job -> 'lease_id')) from claimed))),2::bigint,'whole batch authorised before POST');
select lives_ok($q$select kc_private.dispatch_settle(pg_temp.scope('b'),(select jsonb_agg(jsonb_build_object(
  'id',job -> 'id','lease_id',job -> 'lease_id','state',case when (job ->> 'device_id')::uuid=pg_temp.id('b1') then 'accepted' else 'retry' end,
  'ticket_id','synthetic-ticket-b1')) from claimed))$q$,'accepted A and transient B settle independently');
select is((select phase from kc_private.dispatch_jobs where device_id=pg_temp.id('b1')),'receipt','accepted A awaits stored ticket receipt');
select is((select phase from kc_private.dispatch_jobs where device_id=pg_temp.id('b2')),'pending','transient B alone retries');
select throws_ok($q$select kc_private.dispatch_settle(pg_temp.scope('b'),(select jsonb_agg(jsonb_build_object(
  'id',job -> 'id','lease_id',job -> 'lease_id','state','unknown')) from claimed))$q$,'P0001','stale dispatch lease','duplicate settlement cannot overwrite ticket');
select is((select ticket_id from kc_private.dispatch_jobs where device_id=pg_temp.id('b1')),'synthetic-ticket-b1','accepted ticket immutable');
update kc_private.dispatch_jobs set available_at=now();
truncate claimed;
insert into claimed select * from kc_private.dispatch_claim(pg_temp.scope('b'),'receipt');
select is((select count(*) from claimed),1::bigint,'receipt claim uses stored accepted job only');
select lives_ok($q$select kc_private.dispatch_settle(pg_temp.scope('b'),(select jsonb_agg(jsonb_build_object(
  'id',job -> 'id','lease_id',job -> 'lease_id','state','receipt_pending')) from claimed))$q$,'missing receipt polls, never resends');
select is((select phase from kc_private.dispatch_jobs where device_id=pg_temp.id('b1')),'receipt','missing receipt stays receipt');
update kc_private.dispatch_jobs set available_at=now();
truncate claimed;
insert into claimed select * from kc_private.dispatch_claim(pg_temp.scope('b'),'receipt');
update public.user_devices set push_token='replacement-token-b1' where id=pg_temp.id('b1');
select lives_ok($q$select kc_private.dispatch_settle(pg_temp.scope('b'),(select jsonb_agg(jsonb_build_object(
  'id',job -> 'id','lease_id',job -> 'lease_id','state','device_gone')) from claimed))$q$,'old receipt device gone can settle');
select is((select push_token from public.user_devices where id=pg_temp.id('b1')),'replacement-token-b1','old DeviceNotRegistered never deletes replacement token');
truncate claimed;
insert into claimed select * from kc_private.dispatch_claim(pg_temp.scope('b'),'pending');
select count(*) from kc_private.dispatch_begin_send(pg_temp.scope('b'),
  (select jsonb_agg(jsonb_build_object('id',job -> 'id','lease_id',job -> 'lease_id')) from claimed));
update kc_private.dispatch_jobs set lease_until=now()-interval '1 second' where phase='sending';
select is((select count(*) from kc_private.dispatch_claim(pg_temp.scope('b'),'pending')),0::bigint,'expired sending lease never resends');
select is((select phase from kc_private.dispatch_jobs where device_id=pg_temp.id('b2')),'send_unknown','crash after POST permission held unknown');
-- Admission is by insertion epoch, not id/max arithmetic. Existing roots stay held.
select kc_private.dispatch_activate('synthetic test epoch');
select is(kc_private.dispatch_deliver('{"automatic":true}'),0,'activation does not adopt old backlog');
insert into origins values('new',pg_temp.emit('b','message-2'));
select is(kc_private.dispatch_deliver('{"automatic":true}'),1,'new event automatically eligible');
select is((select snapshot -> 'args' ->> 'message_id' from kc_private.dispatch_jobs where origin_event_id=(select id from origins where label='b') limit 1),pg_temp.id('message-1')::text,'group merge cannot overwrite earlier job message id');
select is((select count(*) from public.notifications where user_id=pg_temp.id('b')),1::bigint,'grouped new origin still one inbox row');
select kc_private.dispatch_deactivate();
select is((select count(*) from kc_private.dispatch_claim('{"automatic":true}','pending')),0::bigint,'disabled gate blocks new claims');
select kc_private.dispatch_activate('second epoch');
select is((select count(*) from kc_private.dispatch_claim('{"automatic":true}','pending')),0::bigint,'reactivation does not adopt previous epoch jobs');
-- Fencing adversaries on new explicit-origin jobs, independent of automatic gate.
truncate claimed;
insert into claimed select * from kc_private.dispatch_claim(pg_temp.scope('new'),'pending');
select throws_ok($q$select * from kc_private.dispatch_begin_send(pg_temp.scope('new'),
  (select jsonb_agg(jsonb_build_object('id',job -> 'id','lease_id',job -> 'lease_id')) ||
    jsonb_build_array(jsonb_build_object('id',-1,'lease_id','00000000-0000-0000-0000-000000000000')) from claimed))$q$,
  'P0001','stale dispatch lease','one foreign member rejects entire send batch');
select is((select count(*) from kc_private.dispatch_jobs where phase='sending'),0::bigint,'batch validation precedes all phase mutations');
select throws_ok($q$select * from kc_private.dispatch_begin_send(pg_temp.scope('new'),
  (select jsonb_agg(jsonb_build_object('id',job -> 'id','lease_id',job -> 'lease_id')) ||
    jsonb_agg(jsonb_build_object('id',job -> 'id','lease_id',job -> 'lease_id')) from claimed))$q$,
  'P0001','duplicate job','duplicate send entries fail atomically');
update kc_private.dispatch_jobs set lease_until=now()-interval '1 second' where origin_event_id=(select id from origins where label='new');
create temp table reclaimed(job jsonb);
insert into reclaimed select * from kc_private.dispatch_claim(pg_temp.scope('new'),'pending');
select ok((select bool_and(c.job ->> 'lease_id' <> r.job ->> 'lease_id') from claimed c join reclaimed r on c.job ->> 'id'=r.job ->> 'id'),'reclaim generates a new lease token');
select throws_ok($q$select * from kc_private.dispatch_begin_send(pg_temp.scope('new'),
  (select jsonb_agg(jsonb_build_object('id',job -> 'id','lease_id',job -> 'lease_id')) from claimed))$q$,
  'P0001','stale dispatch lease','old generation cannot send after reclaim');
update public.user_devices set push_token='newer-token-b1' where id=pg_temp.id('b1');
select throws_ok($q$select * from kc_private.dispatch_begin_send(pg_temp.scope('new'),
  (select jsonb_agg(jsonb_build_object('id',job -> 'id','lease_id',job -> 'lease_id')) from reclaimed))$q$,
  'P0001','device token changed','token replacement between claim and POST rejects whole batch');
select is((select count(*) from kc_private.dispatch_jobs where phase='sending'),0::bigint,'token change authorised no sends');
-- A prior accepted ticket older than the provider retention window is terminal, not resent.
update kc_private.dispatch_jobs set phase='receipt',ticket_id='expired-ticket',accepted_at=now()-interval '25 hours',
  available_at=now(),lease_id=null,lease_until=null where device_id=pg_temp.id('b2') and origin_event_id=(select id from origins where label='new');
select is((select count(*) from kc_private.dispatch_claim(pg_temp.scope('new'),'receipt')),0::bigint,'expired receipt is never returned for send');
select is((select last_error from kc_private.dispatch_jobs where ticket_id='expired-ticket'),'receipt_expired','receipt expiry recorded terminally');
select ok(not has_function_privilege('anon','kc_private.dispatch_deliver(jsonb,integer)','execute'),'anon cannot execute worker');
select ok(not has_function_privilege('authenticated','kc_private.dispatch_deliver(jsonb,integer)','execute'),'member cannot execute worker');
select ok(has_function_privilege('service_role','kc_private.dispatch_deliver(jsonb,integer)','execute'),'service role can execute fenced worker');
select ok(not has_function_privilege('service_role','kc_private.dispatch_activate(text)','execute'),'service role cannot activate gate');
select ok((select bool_and(not has_function_privilege('anon',p.oid,'execute')
  and not has_function_privilege('authenticated',p.oid,'execute')) from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace where n.nspname='kc_private'
  and p.proname in ('dispatch_scope_valid','dispatch_matches','dispatch_preflight','dispatch_deliver',
    'dispatch_lock_gate','dispatch_claim','dispatch_begin_send','dispatch_settle','invoke_dispatch_scoped','dispatch_activate','dispatch_deactivate','dispatch_kick')),
  'all new functions deny direct member/anon execution');
select ok(not has_table_privilege('service_role','kc_private.dispatch_jobs','insert,update,delete')
  and not has_table_privilege('service_role','kc_private.dispatch_gate','insert,update,delete')
  and not has_table_privilege('service_role','kc_private.dispatch_admissions','insert,update,delete'),
  'service role cannot bypass fenced functions with direct table mutations');
-- Terminal metadata follows the existing processed-outbox retention period, but held
-- unknown work is not silently destroyed. Account deletion overrides the hold.
update kc_private.dispatch_jobs set finished_at=now()-interval '8 days'
  where origin_event_id=(select id from origins where label='b') and device_id=pg_temp.id('b1');
select kc_private.outbox_purge(interval '7 days');
select is((select count(*) from kc_private.dispatch_jobs where origin_event_id=(select id from origins where label='b')
  and device_id=pg_temp.id('b1')),0::bigint,'terminal job metadata expires with processed-outbox retention');
select is((select phase from kc_private.dispatch_jobs where origin_event_id=(select id from origins where label='b')
  and device_id=pg_temp.id('b2')),'send_unknown','unresolved unknown job remains held');
delete from public.users where id=pg_temp.id('b');
select is((select count(*) from kc_private.dispatch_jobs where recipient_id=pg_temp.id('b')),0::bigint,
  'account deletion removes even held recipient jobs');
select * from finish();
rollback;
