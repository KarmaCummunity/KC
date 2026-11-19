-- kc-dev tuning of background jobs and their logs. DEV ONLY.
--
-- kc-dev runs on the smallest compute tier, where the standing write drip of the job fleet
-- drains the host's IO budget (#2492) and the busiest job runs far more often than a handful
-- of testers need (#2488). The migrations keep the production values; this seed overrides
-- them on kc-dev only. Every dev deploy runs it after the migrations (deploy-db.yml, step
-- "Job tuning (kc-dev only)"), so a migration that resets a value is overridden again on the
-- same deploy.
--
-- Session setting the caller sets first (deploy-db.yml does):
--   kc.seed_target = 'dev'   (required)
-- Run: psql --single-transaction -f load.sql
do $$
begin
  if coalesce(current_setting('kc.seed_target', true), '') <> 'dev' then
    raise exception 'refusing to tune jobs: set kc.seed_target=dev';
  end if;
end $$;

-- Shorter log retention (#2492): the two run logs are the largest objects on kc-dev's disk.
-- Production keeps ops.job_runs 30 days and pg_cron's run log 7 days.
update kc_private.retention_rules r
   set keep = v.keep
  from (values
    ('job_runs', interval '7 days'),
    ('cron_run_history', interval '1 day')
  ) as v(name, keep)
 where r.name = v.name
   and r.keep is distinct from v.keep;

-- Slower system-message consumer (#2488): production runs it every 10 seconds. Its
-- alert_after (5 minutes) still covers three periods, so jobs_late keeps its meaning.
-- The update reconciles pg_cron through the scheduled_jobs_sync trigger; the guard on the
-- current value keeps a re-run from rescheduling an unchanged job.
update kc_private.scheduled_jobs j
   set schedule = '30 seconds'
 where j.name = 'chat_system_messages'
   and j.schedule is distinct from '30 seconds';
