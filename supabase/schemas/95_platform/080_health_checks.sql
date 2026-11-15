-- Platform · health checks (design §6 "Monitoring")
--
-- `select * from ops.run_health_checks()` answers "is the background machinery working?"
-- with one row per check: ok, failing, or skipped (the thing it measures is not installed
-- on this server). A monitor calls it every few minutes with the service role and alerts on
-- any `failing` row. The checks are rows of ops.health_checks: what is measured, how much
-- of it is tolerated, and what a failure means for the operator.

create table ops.health_checks (
  name          text primary key check (name ~ '^[a-z][a-z0-9_]{1,62}$'),
  description   text not null,
  -- The check fails when the measured number is above this.
  max_allowed   bigint not null default 0 check (max_allowed >= 0),
  -- Age or look-back period the measurement uses, where it has one.
  period        interval check (period > interval '0'),
  failure_means text not null
);
comment on table ops.health_checks is 'Definition of each health check: tolerance, period and the meaning of a failure.';
alter table ops.health_checks enable row level security;
alter table ops.health_checks force row level security;
revoke insert, delete, truncate on ops.health_checks from service_role;

insert into ops.health_checks (name, description, max_allowed, period, failure_means) values
  ('outbox_backlog', 'Topics whose oldest due event has waited longer than the period.', 0, interval '5 minutes',
   'A consumer is not running or cannot keep up: side effects of that topic (push, system messages, audit) are delayed.'),
  ('outbox_exhausted', 'Unprocessed events that were attempted five times or more.', 0, null,
   'Events a consumer keeps failing on. Read last_error, fix the cause, then release or remove them.'),
  ('outbox_stale_claims', 'Events claimed longer ago than the period and never confirmed.', 0, interval '15 minutes',
   'A worker died or timed out mid-batch; the events are retried, but a growing number means the worker keeps dying.'),
  ('jobs_failing', 'Enabled jobs whose latest run failed.', 0, null,
   'A scheduled job raises or times out. ops.job_runs.error has the reason.'),
  ('jobs_late', 'Enabled jobs without a successful run within their alert_after.', 0, null,
   'A job stopped running or never succeeds: the scheduler is down, the job is unscheduled, or it always fails.'),
  ('jobs_unscheduled', 'Enabled jobs of the registry that are missing from pg_cron.', 0, null,
   'pg_cron is out of step with kc_private.scheduled_jobs. Run select kc_private.jobs_sync().'),
  ('partitions_next_month', 'Partitioned logs without a partition for next month.', 0, null,
   'partitions_ensure is not running; at the turn of the month rows start landing in the default partition.'),
  ('default_partition_rows', 'Rows sitting in a default partition.', 0, null,
   'A month had no partition when its rows arrived. They stay readable; that month cannot be dropped by retention as one partition.'),
  ('push_retries', 'Pushes still waiting after three delivery attempts.', 20, null,
   'The push provider keeps refusing pushes: provider outage, expired credentials or many dead devices.'),
  ('counter_drift', 'Counters repaired by the reconciliation within the period.', 0, interval '24 hours',
   'A counter trigger missed a case. Each ops.counter_drift row is a defect to investigate.'),
  ('warnings', 'Operational warnings seen within the period.', 0, interval '24 hours',
   'See ops.warnings: typically Edge Function invocation is unavailable or unconfigured, or a rate limit has no row.'),
  ('edge_function_responses', 'Edge Function calls that failed or answered 4xx/5xx within the period.', 0, interval '1 hour',
   'A worker started from the database is failing or rejects the service key (rotate the Vault secret).');

-- The number each check measures, with a short detail. A check whose subject is not
-- installed on this server returns no row.
create function ops.health_measurements()
returns table (check_name text, measured bigint, detail text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_next constant date := (date_trunc('month', now() at time zone 'UTC') + interval '1 month')::date;
begin
  return query
    select 'outbox_backlog', count(*), string_agg(format('%s: %s due, oldest %s', t.topic, t.due, t.oldest), '; ')
      from (select e.topic, count(*) as due, date_trunc('second', now() - min(e.available_at)) as oldest
              from kc_private.outbox_events e
             where e.processed_at is null and e.available_at <= now()
             group by e.topic) t
     where t.oldest > (select c.period from ops.health_checks c where c.name = 'outbox_backlog');
  return query
    select 'outbox_exhausted', coalesce(sum(t.n), 0)::bigint, string_agg(format('%s: %s', t.topic, t.n), '; ')
      from (select e.topic, count(*) as n from kc_private.outbox_events e
             where e.processed_at is null and e.attempts >= 5 group by e.topic) t;
  return query
    select 'outbox_stale_claims', coalesce(sum(t.n), 0)::bigint, string_agg(format('%s: %s', t.topic, t.n), '; ')
      from (select e.topic, count(*) as n from kc_private.outbox_events e
             where e.processed_at is null
               and e.claimed_at < now() - (select c.period from ops.health_checks c where c.name = 'outbox_stale_claims')
             group by e.topic) t;
  return query
    select 'jobs_failing', count(*), string_agg(j.name || ': ' || left(l.error, 120), '; ')
      from kc_private.scheduled_jobs j
     cross join lateral (select r.status, r.error from ops.job_runs r
                          where r.job_name = j.name order by r.finished_at desc limit 1) l
     where j.enabled and l.status = 'failed';
  return query
    select 'jobs_late', count(*), string_agg(j.name, ', ')
      from kc_private.scheduled_jobs j
     where j.enabled and j.created_at <= now() - j.alert_after
       and not exists (select 1 from ops.job_runs r
                        where r.job_name = j.name and r.status = 'succeeded'
                          and r.finished_at > now() - j.alert_after);
  if to_regclass('cron.job') is not null then
    return query execute
      $q$select 'jobs_unscheduled', count(*), string_agg(j.name, ', ')
           from kc_private.scheduled_jobs j
          where j.enabled
            and not exists (select 1 from cron.job c where c.jobname = j.name and c.active)$q$;
  end if;
  return query
    select 'partitions_next_month', count(*), string_agg(p.name, ', ')
      from (values ('public.feed_impressions_' || to_char(v_next, 'YYYY_MM')),
                   ('kc_private.notifications_y' || to_char(v_next, 'YYYY"m"MM')),
                   ('audit.events_y' || to_char(v_next, 'YYYY"m"MM'))) p (name)
     where to_regclass(p.name) is null;
  return query
    select 'default_partition_rows', sum(d.n)::bigint,
           string_agg(d.name || ': ' || d.n, '; ') filter (where d.n > 0)
      from (select 'feed_impressions' as name, count(*) as n from public.feed_impressions_default
            union all select 'notifications', count(*) from kc_private.notifications_default
            union all select 'audit.events', count(*) from audit.events_default) d;
  return query
    select 'push_retries', count(*), null::text
      from kc_private.outbox_events e
     where e.topic = 'notification_push' and e.processed_at is null and e.attempts >= 3;
  return query
    select 'counter_drift', count(*), string_agg(distinct d.counter_table || '.' || d.counter_name, ', ')
      from ops.counter_drift d
     where d.detected_at > now() - (select c.period from ops.health_checks c where c.name = 'counter_drift');
  return query
    select 'warnings', count(*), string_agg(w.key, ', ')
      from ops.warnings w
     where w.last_seen > now() - (select c.period from ops.health_checks c where c.name = 'warnings');
  if to_regclass('net._http_response') is not null then
    return query execute
      $q$select 'edge_function_responses', count(*), string_agg(distinct coalesce(r.status_code::text, 'no response'), ', ')
           from net._http_response r
          where r.created > now() - $1 and (r.status_code is null or r.status_code >= 400)$q$
      using (select c.period from ops.health_checks c where c.name = 'edge_function_responses');
  end if;
end;
$$;
comment on function ops.health_measurements() is 'Measures every health check; internal to ops.run_health_checks().';

-- One row per check. Service role only (the `ops` schema is closed to members).
create function ops.run_health_checks()
returns table (check_name text, status text, measured bigint, max_allowed bigint, detail text, failure_means text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.name,
         case when m.check_name is null then 'skipped'
              when m.measured > c.max_allowed then 'failing'
              else 'ok' end,
         m.measured, c.max_allowed, m.detail, c.failure_means
    from ops.health_checks c
    left join ops.health_measurements() m on m.check_name = c.name
   order by c.name;
$$;
comment on function ops.run_health_checks() is
  'Runs every health check: one row each with status ok, failing or skipped, the measured value and the meaning of a failure.';

-- Queue depth per topic at a glance.
create view ops.outbox_stats with (security_invoker = true) as
  select e.topic,
         count(*) filter (where e.processed_at is null) as pending,
         count(*) filter (where e.processed_at is null and e.available_at <= now()) as due,
         now() - min(e.available_at) filter (where e.processed_at is null and e.available_at <= now()) as oldest_due_age,
         count(*) filter (where e.processed_at is null and e.claimed_at is not null) as claimed,
         count(*) filter (where e.processed_at is null and e.attempts >= 5) as exhausted,
         count(*) filter (where e.processed_at > now() - interval '1 hour') as processed_last_hour
    from kc_private.outbox_events e
   group by e.topic;
comment on view ops.outbox_stats is 'Per-topic depth of the outbox: pending, due, oldest due age, claimed, exhausted, processed in the last hour.';
