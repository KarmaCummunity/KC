-- Push contract between the database and the `dispatch-notification` worker. Every check
-- that says "every kind" walks kc_private.notification_kinds itself, so a kind registered
-- by any module is covered without editing this file: the push carries exactly the fields
-- the worker reads, or nothing when the kind is not pushed. Then the worker's queues:
-- retries with back-off for the failed devices only, receipt checks, dead devices, chat
-- previews by message id, and who may call any of it.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

create function pg_temp.id(p_who text) returns uuid language sql as
  $$select ('00000000-0000-4000-8000-00000000000' || p_who)::uuid$$;

-- Runs a statement as a signed-in member, or as the service role when p_who is null;
-- returns its first value as text, or the SQLSTATE of an error.
create function pg_temp.run(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  begin
    perform set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.id(p_who), 'role', 'authenticated')::text, true);
    perform set_config('role', case when p_who is null then 'service_role' else 'authenticated' end, true);
    execute p_sql into v_value;
    perform set_config('role', 'none', true);
    return coalesce(nullif(v_value, ''), 'ok');
  exception when others then
    return case sqlstate when 'P0001' then sqlerrm else sqlstate end;
  end;
end;
$$;

-- One delivered event per kind and pass, with what the badge had to be at that moment.
create temp table deliveries (pass text, kind text, result jsonb, unread bigint);

-- Emits one representative event of every registered kind to a member and delivers it.
create function pg_temp.emit_every_kind(p_pass text, p_to text)
returns void
language plpgsql
as $$
declare
  v_kind text;
  v_result jsonb;
begin
  for v_kind in select k.kind from kc_private.notification_kinds k order by k.kind loop
    v_result := kc_private.notifications_deliver(kc_private.outbox_enqueue('notification', jsonb_build_object(
      'kind', v_kind, 'recipient_id', pg_temp.id(p_to), 'actor_id', pg_temp.id('a'),
      'entity', jsonb_build_object('type', 'post', 'id', pg_temp.id('7')),
      'data', jsonb_build_object(
        'post_id', pg_temp.id('7'), 'message_id', pg_temp.id('8'), 'world_slug', 'items',
        'status', 'confirmed', 'dedupe_key', p_pass || ':' || v_kind))));
    insert into deliveries values (p_pass, v_kind, v_result,
      (select count(*) from public.notifications n where n.user_id = pg_temp.id(p_to) and n.read_at is null));
  end loop;
end;
$$;

-- Kinds of a pass for which the condition does not hold (empty = the contract holds).
create function pg_temp.offenders(p_pass text, p_condition text)
returns text[]
language plpgsql
as $$
declare
  v_kinds text[];
begin
  execute format(
    $q$select coalesce(array_agg(d.kind order by d.kind), '{}')
         from deliveries d join kc_private.notification_kinds k using (kind)
         cross join lateral (select d.result -> 'push' as push, d.result -> 'push' <> 'null'::jsonb as pushed) p
        where d.pass = %L and not coalesce((%s), false)$q$, p_pass, p_condition) into v_kinds;
  return v_kinds;
end;
$$;

create function pg_temp.keys(p_object jsonb) returns text[] language sql as
  $$select array(select jsonb_object_keys(p_object) order by 1)$$;

select plan(34);

-- Alice acts; Bob has a device of every platform; Carol has none; Dan has one iPhone.
insert into auth.users (id, email, raw_app_meta_data)
select pg_temp.id(x), x || '@example.test', '{"provider":"google"}'::jsonb from unnest(array['a', 'b', 'c', 'd']) x;
update public.users set display_name = 'Member ' || right(id::text, 1);
insert into public.user_devices (id, user_id, platform, push_token, created_at) values
  (pg_temp.id('1'), pg_temp.id('b'), 'ios', 'token-b-ios', now() - interval '3 days'),
  (pg_temp.id('2'), pg_temp.id('b'), 'android', 'token-b-android', now() - interval '2 days'),
  (pg_temp.id('3'), pg_temp.id('b'), 'web', 'token-b-web', now() - interval '1 day'),
  (pg_temp.id('4'), pg_temp.id('d'), 'ios', 'token-d-ios', now());

-- ── Every kind: the push the worker gets ────────────────────────────────────
select pg_temp.emit_every_kind('day', 'b') \gset
select cmp_ok((select count(*) from deliveries where pass = 'day'), '>=', 57::bigint, 'one event of every registered kind was delivered');
select is(pg_temp.offenders('day', $$d.result ->> 'status' = 'delivered'$$), '{}', 'every kind is delivered to the centre');
select is(pg_temp.offenders('day', 'p.pushed = k.sends_push'), '{}', 'a push is returned exactly for the kinds that send one');
select is(pg_temp.offenders('day', $$not p.pushed or pg_temp.keys(p.push) = '{args,badge,body_key,collapse_key,data,title_key,tokens}'$$), '{}',
  'the push has exactly the fields the worker reads');
select is(pg_temp.offenders('day', $$not p.pushed or pg_temp.keys(p.push -> 'data') = '{category,entity,group_count,kind,notification_id}'$$), '{}',
  '… and its data exactly the fields the app reads on tap');
select is(pg_temp.offenders('day', $$not p.pushed or (p.push -> 'data' ->> 'kind' = k.kind and p.push -> 'data' ->> 'category' = k.category
    and p.push ->> 'title_key' = k.title_key and p.push ->> 'body_key' = k.body_key
    and p.push -> 'data' ->> 'notification_id' = d.result ->> 'notification_id' and (p.push -> 'data' ->> 'group_count')::int = 1)$$), '{}',
  'kind, category and text keys are the registry''s; the notification is named');
select is(pg_temp.offenders('day', $$not p.pushed or p.push -> 'data' -> 'entity' = jsonb_build_object('type', 'post', 'id', pg_temp.id('7'))$$), '{}',
  'the entity is carried as type and id');
select is(pg_temp.offenders('day', $$not p.pushed or (p.push -> 'args' ->> 'actor_display_name' = 'Member a'
    and p.push -> 'args' ->> 'post_id' = pg_temp.id('7')::text and p.push -> 'args' ->> 'message_id' = pg_temp.id('8')::text
    and not p.push -> 'args' ? 'dedupe_key')$$), '{}', 'args are the event data plus the actor''s name, without the dedupe key');
select is(pg_temp.offenders('day', $$not p.pushed or (p.push ->> 'collapse_key' is not null) = (k.group_window is not null)$$), '{}',
  'a collapse key is given exactly for the kinds that group');
select is(pg_temp.offenders('day', $$not p.pushed or (jsonb_typeof(p.push -> 'badge') = 'number' and (p.push ->> 'badge')::bigint = d.unread)$$), '{}',
  'the badge is the member''s unread count, this notification included');
select is(pg_temp.offenders('day', $$not p.pushed or p.push -> 'tokens' = jsonb_build_array(
    jsonb_build_object('device_id', pg_temp.id('1'), 'token', 'token-b-ios', 'platform', 'ios'),
    jsonb_build_object('device_id', pg_temp.id('2'), 'token', 'token-b-android', 'platform', 'android'),
    jsonb_build_object('device_id', pg_temp.id('3'), 'token', 'token-b-web', 'platform', 'web'))$$), '{}',
  'every device of the member is listed with its id, token and platform, oldest first');

select pg_temp.emit_every_kind('nodevice', 'c') \gset
select is(pg_temp.offenders('nodevice', $$not p.pushed and d.result ->> 'status' = 'delivered'$$), '{}', 'a member without a device gets the notification and no push');
select pg_temp.emit_every_kind('one', 'd') \gset
select is(pg_temp.offenders('one', $$not p.pushed or p.push -> 'tokens' = jsonb_build_array(
    jsonb_build_object('device_id', pg_temp.id('4'), 'token', 'token-d-ios', 'platform', 'ios'))$$), '{}', 'a member with one device gets that token only');

-- ── Every kind: quiet hours as returned to the worker ───────────────────────
update public.user_private set notification_preferences = '{"quietHours": {"enabled": true, "start": "00:00", "end": "23:59:59.999"}}'
 where user_id = pg_temp.id('b');
select pg_temp.emit_every_kind('night', 'b') \gset
select is(pg_temp.offenders('night', 'p.pushed = (k.sends_push and (k.bypass_quiet_hours or k.bypass_preferences))'), '{}',
  'in quiet hours only the kinds that pass them are pushed');
select is(pg_temp.offenders('night', $$d.result ->> 'status' = 'delivered'$$), '{}', '… and every kind still reaches the centre');
update public.user_private set notification_preferences = '{}' where user_id = pg_temp.id('b');

-- ── The push of a notification, narrowed to devices ─────────────────────────
create temp table one as
  select n.id from public.notifications n where n.user_id = pg_temp.id('b') and n.kind = 'mark_recipient' limit 1;
create function pg_temp.one() returns public.notifications language sql as
  $$select n from public.notifications n where n.id = (select id from one)$$;
select is((select jsonb_agg(t ->> 'platform') from jsonb_array_elements(kc_private.notification_push(pg_temp.one(), array[pg_temp.id('2')]) -> 'tokens') t),
  '["android"]', 'a push can be narrowed to listed devices');
select is(kc_private.notification_push(pg_temp.one(), array[pg_temp.id('4')]), null,
  'another member''s device is never part of it');

-- ── Retries: only the failed devices, with back-off, through outbox_complete ─
select lives_ok(format($$select kc_private.notification_push_settle('{"defer": [{"notification_id": "%s", "device_ids": ["%s"], "retry_in_seconds": 30}]}')$$,
  (select id from one), pg_temp.id('2')), 'the worker defers a push the provider did not take');
select is((select count(*) from kc_private.notification_push_retry_batch()), 0::bigint, 'a deferred push is not due before its back-off');
update kc_private.outbox_events set available_at = now() where topic = 'notification_push';
create temp table retry as select r from kc_private.notification_push_retry_batch() r;
select is((select (r ->> 'status') || '|' || (r ->> 'attempts') || '|' || (r ->> 'notification_id' = (select id::text from one))
              || '|' || (select jsonb_agg(t ->> 'device_id') = jsonb_build_array(pg_temp.id('2')) from jsonb_array_elements(r -> 'push' -> 'tokens') t)
            from retry), 'retry|1|true|true', 'when due it is handed out once, rebuilt for the failed device');
select is((select count(*) from kc_private.notification_push_retry_batch()), 0::bigint, 'a claimed retry is not handed to a second worker');
select lives_ok(format($$select kc_private.notification_push_settle('{"retry": [{"event_id": %s, "device_ids": [], "error": "provider_unavailable", "retry_in_seconds": 120}]}')$$,
  (select r ->> 'event_id' from retry)), 'the worker releases it for a later attempt');
select is((select (e.processed_at is null) || '|' || e.last_error || '|' || (e.available_at > now() + interval '110 seconds') || '|' || (e.payload -> 'device_ids') || '|' || e.attempts
            from kc_private.outbox_events e where e.id = (select (r ->> 'event_id')::bigint from retry)),
  'true|provider_unavailable|true|[]|1', 'the event keeps its error, waits out the back-off and is narrowed');
update kc_private.outbox_events set available_at = now(), payload = payload || jsonb_build_object('device_ids', jsonb_build_array(pg_temp.id('1')))
 where topic = 'notification_push';
select is((select r ->> 'attempts' from kc_private.notification_push_retry_batch() r), '2', 'the next claim counts the attempt');
select kc_private.outbox_enqueue('audit', '{"kind": "not_the_workers"}') as foreign_event \gset
select lives_ok(format($$select kc_private.notification_push_settle('{"done": [%s, %s], "retry": [{"event_id": %s, "error": "x", "retry_in_seconds": 5}]}')$$,
  (select r ->> 'event_id' from retry), :foreign_event, :foreign_event), 'the worker confirms a finished retry');
select is((select count(*) from kc_private.outbox_events where topic = 'notification_push' and processed_at is null) || '|'
    || (select (processed_at is null) || '|' || (last_error is null) from kc_private.outbox_events where id = :foreign_event),
  '0|true|true', 'the retry is done; settle never touches an event of another topic');
select kc_private.notification_push_settle(jsonb_build_object('defer', jsonb_build_array(
  jsonb_build_object('notification_id', (select id from one), 'device_ids', jsonb_build_array(pg_temp.id('1')), 'retry_in_seconds', 0)))) \gset
select is(pg_temp.run('b', 'select public.notifications_mark_all_read()')::int > 0, true, 'the member reads the centre meanwhile');
create temp table dropped as select r ->> 'status' as status from kc_private.notification_push_retry_batch() r;
select is((select string_agg(status, ',') from dropped) || '|'
    || (select count(*) from kc_private.outbox_events where topic = 'notification_push' and processed_at is null),
  'skipped|0', 'a retry for a notification already read is dropped');

-- ── Dead devices and receipt checks ─────────────────────────────────────────
select kc_private.notification_push_settle(jsonb_build_object(
  'forget_devices', jsonb_build_array(pg_temp.id('3'), pg_temp.id('9')),
  'receipts', '[[{"id": "t1", "device_id": "d1"}, {"id": "t2", "device_id": "d2"}], [{"id": "t3", "device_id": "d3"}], []]'::jsonb,
  'receipt_delay_seconds', 900)) \gset
select is((select string_agg(platform, ',' order by platform) from public.user_devices where user_id = pg_temp.id('b')), 'android,ios',
  'a device the provider reports as gone is deleted');
select is((select count(*) || '|' || bool_and(available_at > now() + interval '14 minutes') || '|' || sum(jsonb_array_length(payload -> 'tickets'))
            from kc_private.outbox_events where topic = 'notification_push_receipt'),
  '2|true|3', 'accepted tickets wait for their receipt check, one event per list');

-- ── Chat preview: by message id, at send time, from a real message ──────────
select pg_temp.run('a', format('select (public.open_direct_chat(%L)).id', pg_temp.id('d'))) as chat \gset
select pg_temp.run('a', format('select public.send_message(%L, %L)', :'chat', repeat('x', 79) || 'yz and the rest')) \gset
create temp table chat_push as
  select r -> 'push' as push from kc_private.notifications_deliver_batch(500) r where r -> 'push' -> 'data' ->> 'kind' = 'chat_message';
select is((select (push -> 'data' -> 'entity' ->> 'type') || '|' || (push -> 'args' ? 'message_id') || '|' || (push::text like '%xxxx%') from chat_push),
  'chat|true|false', 'a chat push names the message and carries none of its text');
select is((select preview from kc_private.notification_message_previews(array[(select (push -> 'args' ->> 'message_id')::uuid from chat_push), pg_temp.id('9')])),
  repeat('x', 79) || 'y', 'the worker reads the first 80 characters by message id');

-- ── Who may call the worker functions ───────────────────────────────────────
select is(pg_temp.run('b', $$select kc_private.notification_push_settle('{}')$$) || '|' || pg_temp.run('b', 'select count(*) from kc_private.notification_push_retry_batch()')
    || '|' || pg_temp.run('b', $$select count(*) from kc_private.notification_message_previews('{}')$$)
    || '|' || pg_temp.run('b', 'select count(*) from kc_private.notifications_deliver_batch(1)'),
  '42501|42501|42501|42501', 'nothing of the worker is callable from a device');
select is(pg_temp.run(null, 'select count(*) from kc_private.notifications_deliver_batch(50::integer) r') || '|'
    || pg_temp.run(null, 'select count(*) from kc_private.notification_push_retry_batch(50::integer) r') || '|'
    || pg_temp.run(null, $$select count(*) from kc_private.outbox_claim('notification_push_receipt', 0::integer) e$$) || '|'
    || pg_temp.run(null, $$select count(*) from kc_private.notification_message_previews('{}'::uuid[]) p$$) || '|'
    || pg_temp.run(null, $$select kc_private.notification_push_settle('{}'::jsonb)$$),
  '0|0|0|0|ok', 'the service role runs every statement of the worker');

select * from finish();
rollback;
