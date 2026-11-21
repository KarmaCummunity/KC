-- Outbox: events are claimed once, retried after a failure or a lost worker, and are out of
-- reach of client roles.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(12);

select lives_ok(
  $$select kc_private.outbox_enqueue('notification', '{"kind":"probe","n":1}')$$,
  'an event is recorded');
select kc_private.outbox_enqueue('notification', '{"kind":"probe","n":2}');
select kc_private.outbox_enqueue('match', '{"post_id":"x"}');
select kc_private.outbox_enqueue('notification', '{"kind":"later"}', now() + interval '1 hour');

select throws_ok(
  $$select kc_private.outbox_enqueue('Bad Topic', '{}')$$,
  '23514', null, 'a malformed topic is rejected');

create temp table claimed as select * from kc_private.outbox_claim('notification', 10);
select is((select count(*) from claimed), 2::bigint, 'a claim returns only due events of its topic');
select is((select array_agg(payload ->> 'n' order by id) from claimed), array['1', '2'], 'events are claimed oldest first');
select is((select count(*) from kc_private.outbox_claim('notification', 10)), 0::bigint,
  'a claimed event is not handed out again');

-- First event succeeds; second fails and is retried at once.
select kc_private.outbox_complete((select min(id) from claimed));
select kc_private.outbox_complete((select max(id) from claimed), 'provider timeout', interval '0 seconds');
select is(
  (select count(*) from kc_private.outbox_claim('notification', 10)), 1::bigint,
  'a failed event becomes claimable again and a processed one does not');
select is(
  (select attempts || '|' || last_error from kc_private.outbox_events where id = (select max(id) from claimed)),
  '2|provider timeout', 'attempts and the last error are kept');

-- A worker that died: its claim expires after the visibility timeout.
select is(
  (select count(*) from kc_private.outbox_claim('notification', 10, interval '0 seconds')), 1::bigint,
  'an expired claim is handed out again');

select ok(
  not has_function_privilege('authenticated', 'kc_private.outbox_enqueue(text, jsonb, timestamptz)', 'execute')
  and not has_table_privilege('authenticated', 'kc_private.outbox_events', 'select'),
  'client roles cannot enqueue or read events');
select ok(
  has_function_privilege('service_role', 'kc_private.outbox_claim(text, integer, interval)', 'execute'),
  'the service role can claim events');

-- A claim never takes more than its limit, whatever plan the server picks (#2494). With the
-- subquery re-run on the inner side of a nested loop, the row the statement had just claimed was
-- skipped as locked and the next one returned, so every due event was claimed.
delete from kc_private.outbox_events where topic = 'zz_limit';
select count(*) from (
  select kc_private.outbox_enqueue('zz_limit', jsonb_build_object('n', n)) from generate_series(1, 5) n) q;
set local enable_hashagg = off;
set local enable_sort = off;
set local enable_material = off;
set local enable_hashjoin = off;
set local enable_mergejoin = off;
select is((select count(*) from kc_private.outbox_claim('zz_limit', 1)), 1::bigint,
  'a claim of one takes exactly one event under a nested-loop plan');
select is((select count(*) from kc_private.outbox_events
            where topic = 'zz_limit' and claimed_at is null and attempts = 0), 4::bigint,
  'the events past the limit stay unclaimed, with their attempts untouched');
reset enable_hashagg;
reset enable_sort;
reset enable_material;
reset enable_hashjoin;
reset enable_mergejoin;

select * from finish();
rollback;
