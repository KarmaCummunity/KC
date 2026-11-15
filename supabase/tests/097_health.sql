-- Health: every check is ok on a quiet database and flips to failing on the fixture that
-- stands for its incident — a stuck queue, an event nobody can process, a dead worker, a
-- failing or silent job, a missing partition, a drifted counter.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- 'status' of one check, or 'status: detail' when p_detail.
create function pg_temp.health(p_check text, p_detail boolean default false)
returns text
language sql
as $$
  select h.status || case when p_detail then ': ' || coalesce(h.detail, '') else '' end
    from ops.run_health_checks() h where h.check_name = p_check;
$$;

create function pg_temp.as_role(p_role text, p_sql text)
returns text
language plpgsql
as $$
begin
  begin
    perform set_config('role', p_role, true);
    execute p_sql;
    perform set_config('role', 'none', true);
    return 'ok';
  exception when others then
    perform set_config('role', 'none', true);
    return sqlstate;
  end;
end;
$$;

select plan(33);

-- A scheduler may have been working on this database: start from a quiet state.
delete from ops.warnings;
delete from ops.job_runs;
delete from kc_private.outbox_events;

select is((select count(*) from ops.run_health_checks()), (select count(*) from ops.health_checks),
  'one row per defined check');
select is((select string_agg(h.check_name || '=' || h.status, ' ' order by h.check_name)
             from ops.run_health_checks() h where h.status not in ('ok', 'skipped')), null,
  'a quiet database passes every check');
select is((select count(*) from ops.health_checks c where c.failure_means = '' or c.description = ''), 0::bigint,
  'every check says what its failure means');
select is(pg_temp.as_role('service_role', 'select * from ops.run_health_checks()')
  || '|' || pg_temp.as_role('service_role', 'select * from ops.outbox_stats')
  || '|' || pg_temp.as_role('authenticated', 'select * from ops.run_health_checks()')
  || '|' || pg_temp.as_role('authenticated', 'select * from ops.outbox_stats')
  || '|' || pg_temp.as_role('anon', 'select * from ops.run_health_checks()'), 'ok|ok|42501|42501|42501',
  'the checks and the queue statistics are for the service role only');

-- ── Queue ───────────────────────────────────────────────────────────────────
insert into kc_private.outbox_events (topic, payload, available_at) values
  ('zz_slow', '{}', now() - interval '4 minutes'),
  ('zz_later', '{}', now() + interval '1 hour');
select is(pg_temp.health('outbox_backlog'), 'ok', 'a young backlog and a delayed event are not an incident');
insert into kc_private.outbox_events (topic, payload, available_at)
select 'zz_stuck', '{}', now() - interval '6 minutes' from generate_series(1, 3);
select is(pg_temp.health('outbox_backlog', true), 'failing: zz_stuck: 3 due, oldest 00:06:00',
  'a topic whose oldest due event waited too long fails, and is named');
update kc_private.outbox_events set processed_at = now() where topic = 'zz_stuck';
select is(pg_temp.health('outbox_backlog'), 'ok', 'processing the events clears it');

update kc_private.outbox_events set attempts = 4, last_error = 'boom' where topic = 'zz_slow';
select is(pg_temp.health('outbox_exhausted'), 'ok', 'four attempts are still retries');
update kc_private.outbox_events set attempts = 5 where topic = 'zz_slow';
select is(pg_temp.health('outbox_exhausted', true), 'failing: zz_slow: 1', 'an event attempted five times fails the check');
update kc_private.outbox_events set attempts = 0 where topic = 'zz_slow';

update kc_private.outbox_events set claimed_at = now() - interval '14 minutes' where topic = 'zz_slow';
select is(pg_temp.health('outbox_stale_claims'), 'ok', 'a recent claim is a worker at work');
update kc_private.outbox_events set claimed_at = now() - interval '16 minutes' where topic = 'zz_slow';
select is(pg_temp.health('outbox_stale_claims', true), 'failing: zz_slow: 1', 'a claim nobody confirmed fails the check');

insert into kc_private.outbox_events (topic, payload, attempts)
select 'notification_push', '{}', 3 from generate_series(1, 20);
select is(pg_temp.health('push_retries'), 'ok', 'a few pushes on their third attempt are tolerated');
insert into kc_private.outbox_events (topic, payload, attempts) values ('notification_push', '{}', 3);
select is(pg_temp.health('push_retries'), 'failing', 'more than the tolerance fails the check');

select is((select s.pending || '/' || s.due || '/' || s.claimed || '/' || s.exhausted || '/' || s.processed_last_hour
             from ops.outbox_stats s where s.topic = 'zz_slow')
  || ' ' || (select s.pending || '/' || s.due || '/' || s.processed_last_hour from ops.outbox_stats s where s.topic = 'zz_stuck')
  || ' ' || (select s.pending || '/' || s.due || '/' || coalesce(s.oldest_due_age::text, '-') from ops.outbox_stats s where s.topic = 'zz_later'),
  '1/1/1/0/0 0/0/3 1/0/-', 'the queue statistics count pending, due, claimed and processed events per topic');

-- ── Jobs ────────────────────────────────────────────────────────────────────
insert into ops.job_runs (job_name, started_at, finished_at, status, duration_ms, error) values
  ('post_expiry', now() - interval '10 minutes', now() - interval '10 minutes', 'failed', 5, 'boom'),
  ('post_expiry', now() - interval '5 minutes', now() - interval '5 minutes', 'succeeded', 5, null);
select is(pg_temp.health('jobs_failing'), 'ok', 'a job that recovered is not failing');
insert into ops.job_runs (job_name, started_at, finished_at, status, duration_ms, error) values
  ('post_expiry', now(), now(), 'failed', 5, '57014: canceling statement due to statement timeout');
select is(pg_temp.health('jobs_failing', true), 'failing: post_expiry: 57014: canceling statement due to statement timeout',
  'a job whose latest run failed fails the check, with its error');
update kc_private.scheduled_jobs set enabled = false where name = 'post_expiry';
select is(pg_temp.health('jobs_failing'), 'ok', 'a disabled job is not reported');
update kc_private.scheduled_jobs set enabled = true where name = 'post_expiry';

select is(pg_temp.health('jobs_late'), 'ok', 'a job is not late before it had its first period to run');
update kc_private.scheduled_jobs set created_at = now() - interval '3 hours' where name in ('post_expiry', 'audit_consume');
select is(pg_temp.health('jobs_late', true), 'failing: audit_consume',
  'a job without a successful run within its alert period is late; a failed run does not count');
insert into ops.job_runs (job_name, started_at, finished_at, status, duration_ms)
values ('audit_consume', now() - interval '11 minutes', now() - interval '11 minutes', 'succeeded', 1);
select is(pg_temp.health('jobs_late'), 'failing', 'a success older than the alert period does not help');
insert into ops.job_runs (job_name, started_at, finished_at, status, duration_ms)
values ('audit_consume', now(), now(), 'succeeded', 1);
select is(pg_temp.health('jobs_late'), 'ok', 'a fresh success does');

create function pg_temp.unscheduled_tests()
returns setof text
language plpgsql
as $$
begin
  if to_regclass('cron.job') is null then
    return next is(pg_temp.health('jobs_unscheduled'), 'skipped', 'without pg_cron the scheduler check is skipped');
    return query select skip('pg_cron is not loaded on this server', 1);
    return;
  end if;
  return next is(pg_temp.health('jobs_unscheduled'), 'ok', 'the registry and pg_cron agree');
  perform cron.unschedule('post_expiry');
  return next is(pg_temp.health('jobs_unscheduled', true), 'failing: post_expiry', 'a job missing from pg_cron fails the check');
end;
$$;
select * from pg_temp.unscheduled_tests();

-- ── Partitions ──────────────────────────────────────────────────────────────
select is(pg_temp.health('partitions_next_month'), 'ok', 'next month''s partitions exist after the baseline');
do $$
begin
  execute format('drop table public.%I', 'feed_impressions_' || to_char(now() at time zone 'UTC' + interval '1 month', 'YYYY_MM'));
  execute format('drop table audit.%I', 'events_y' || to_char(now() at time zone 'UTC' + interval '1 month', 'YYYY"m"MM'));
end $$;
select is((select h.status || ' ' || h.measured from ops.run_health_checks() h where h.check_name = 'partitions_next_month'),
  'failing 2', 'each missing partition of next month is counted');
select lives_ok('select kc_private.partitions_ensure()', 'the maintenance job creates them');
select is(pg_temp.health('partitions_next_month'), 'ok', 'and the check passes again');

insert into auth.users (id, email, raw_app_meta_data)
values ('00000000-0000-4000-8000-00000000000a', 'a@example.test', '{"provider":"google"}');
select is(pg_temp.health('default_partition_rows'), 'ok', 'no row sits in a default partition');
insert into public.feed_impressions (user_id, post_id, seen_at)
values ('00000000-0000-4000-8000-00000000000a', gen_random_uuid(), now() + interval '3 months');
select is(pg_temp.health('default_partition_rows', true), 'failing: feed_impressions: 1',
  'a row that found no partition fails the check');

-- ── Drift, warnings, Edge Function responses ────────────────────────────────
insert into ops.counter_drift (counter_table, counter_name, subject_id, stored_value, actual_value, detected_at)
values ('post_stats', 'comments_count', gen_random_uuid(), 1, 2, now() - interval '25 hours');
select is(pg_temp.health('counter_drift'), 'ok', 'old drift is history');
insert into ops.counter_drift (counter_table, counter_name, subject_id, stored_value, actual_value)
values ('post_stats', 'comments_count', gen_random_uuid(), 1, 2);
select is(pg_temp.health('counter_drift', true), 'failing: post_stats.comments_count', 'a counter repaired today fails the check');

do $$ begin perform kc_private.ops_warn('zz_warning', 'something to look at'); end $$;
select is(pg_temp.health('warnings', true), 'failing: zz_warning', 'a recent warning fails the check');
select is(pg_temp.health('edge_function_responses'),
  case when to_regclass('net._http_response') is null then 'skipped' else 'ok' end,
  'the response check is skipped where pg_net is absent');

select * from finish();
rollback;
