-- Platform · scheduled jobs (design §6)
--
-- Every piece of background work is one row of kc_private.scheduled_jobs: its name, when
-- it runs and the statement it runs. The rows are the vocabulary of the scheduler (they
-- live in 900_job_registry.sql); kc_private.jobs_sync() turns them into pg_cron jobs, and
-- every job runs through kc_private.job_run(), which records the outcome in ops.job_runs.
-- So a job that fails, or silently stops running, shows up in the health checks instead of
-- in a log nobody reads.
--
-- pg_cron is part of the platform (required on Supabase). On a server without it (a plain local PostgreSQL) the
-- registry and the wrapper still exist and jobs_sync() does nothing.

-- pg_cron itself is created by 00_foundation/016_platform_extensions.sql.

create table kc_private.scheduled_jobs (
  name        text primary key check (name ~ '^[a-z][a-z0-9_]{1,62}$'),
  -- pg_cron schedule: five-field cron expression (UTC) or '<n> seconds'.
  schedule    text not null check (char_length(schedule) between 1 and 100),
  -- One SQL statement, run as the owner of the schema.
  command     text not null check (char_length(command) between 1 and 2000),
  -- The run is cancelled after this long and recorded as failed.
  timeout     interval not null default interval '60 seconds'
              check (timeout between interval '1 second' and interval '1 hour'),
  -- Health: the job is late when its last successful run is older than this.
  alert_after interval not null check (alert_after > interval '0'),
  enabled     boolean not null default true,
  description text not null check (char_length(description) between 1 and 500),
  -- A job is not reported late before it had `alert_after` to run for the first time.
  created_at  timestamptz not null default now()
);
comment on table kc_private.scheduled_jobs is 'Registry of background jobs; reconciled into pg_cron by kc_private.jobs_sync().';
alter table kc_private.scheduled_jobs enable row level security;
alter table kc_private.scheduled_jobs force row level security;
revoke insert, update, delete, truncate on kc_private.scheduled_jobs from service_role;

-- Runs one registered job and records the outcome. Returns whether it succeeded. The job's
-- own error — including the cancellation by its timeout — is caught and stored, never
-- raised: the scheduler sees a finished run, the health checks see the failure.
create function kc_private.job_run(p_name text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job kc_private.scheduled_jobs;
  v_started constant timestamptz := clock_timestamp();
  v_error text;
begin
  select j.* into v_job from kc_private.scheduled_jobs j where j.name = p_name;
  if not found then
    v_error := 'job is not registered';
  elsif not v_job.enabled then
    return false;
  else
    begin
      execute v_job.command;
    exception
      when query_canceled then
        v_error := 'cancelled (timeout ' || v_job.timeout || '): ' || sqlerrm;
      when others then
        v_error := sqlstate || ': ' || sqlerrm;
    end;
  end if;

  insert into ops.job_runs (job_name, started_at, finished_at, status, duration_ms, error)
  values (p_name, v_started, clock_timestamp(),
          case when v_error is null then 'succeeded' else 'failed' end,
          (extract(epoch from clock_timestamp() - v_started) * 1000)::integer,
          left(v_error, 1000));
  return v_error is null;
end;
$$;
comment on function kc_private.job_run(text) is
  'Runs a registered job and records success or failure in ops.job_runs; never raises the job''s error.';

-- The pg_cron command of a job: its timeout for the session, then the wrapper.
create function kc_private.job_cron_command(p_job kc_private.scheduled_jobs)
returns text
language sql
immutable
set search_path = ''
as $$
  select format('set statement_timeout = %s; select kc_private.job_run(%L);',
                (extract(epoch from p_job.timeout) * 1000)::bigint, p_job.name);
$$;
comment on function kc_private.job_cron_command(kc_private.scheduled_jobs) is
  'The statement pg_cron runs for a registered job.';

-- Makes pg_cron match the registry: schedules enabled jobs that are missing or changed,
-- unschedules jobs that are disabled or no longer registered. Only jobs that run through
-- kc_private.job_run are touched, so a job an operator scheduled by hand is left alone.
-- Idempotent; returns the number of pg_cron jobs it created, changed or removed, and 0 on
-- a server without pg_cron.
create function kc_private.jobs_sync()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job kc_private.scheduled_jobs;
  v_stale text;
  v_changes integer := 0;
begin
  if to_regclass('cron.job') is null then
    return 0;
  end if;

  for v_job in select j.* from kc_private.scheduled_jobs j where j.enabled order by j.name loop
    if not exists (select 1 from cron.job c
                    where c.jobname = v_job.name and c.schedule = v_job.schedule
                      and c.command = kc_private.job_cron_command(v_job) and c.active) then
      perform cron.schedule(v_job.name, v_job.schedule, kc_private.job_cron_command(v_job));
      v_changes := v_changes + 1;
    end if;
  end loop;

  for v_stale in
    select c.jobname from cron.job c
     where c.command like '%kc_private.job_run(%'
       and not exists (select 1 from kc_private.scheduled_jobs j where j.name = c.jobname and j.enabled)
  loop
    perform cron.unschedule(v_stale);
    v_changes := v_changes + 1;
  end loop;
  return v_changes;
end;
$$;
comment on function kc_private.jobs_sync() is
  'Reconciles kc_private.scheduled_jobs into pg_cron (create, alter, unschedule); idempotent, no-op without pg_cron.';

-- The registry is the single source: any change to it is applied to the scheduler in the
-- same transaction.
create function kc_private.scheduled_jobs_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform kc_private.jobs_sync();
  return null;
end;
$$;

create trigger scheduled_jobs_sync
  after insert or update or delete on kc_private.scheduled_jobs
  for each statement execute function kc_private.scheduled_jobs_sync();
