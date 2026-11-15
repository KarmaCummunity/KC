-- 0195_cron_run_details_retention | INFRA (security audit 2026-06-14, Finding 4)
--
-- pg_cron appends a row to cron.job_run_details on every job execution and never
-- prunes it. With ~15 scheduled jobs this table grew unbounded — observed at
-- ~48,500 rows / 66 MB on dev with zero retention (the single largest object in
-- the database). Schedule a daily purge that keeps 7 days of run history.
--
-- Guarded on pg_cron being installed (created in 0058) — matches the pattern used
-- by 0080 / 0153 / 0190 — so a local stack without the extension is a no-op.
-- Idempotent: unschedule any prior same-named job before re-creating it.

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'purge_cron_run_details') then
      perform cron.unschedule('purge_cron_run_details');
    end if;
    perform cron.schedule(
      'purge_cron_run_details',
      '17 3 * * *',
      $cmd$delete from cron.job_run_details where end_time < now() - interval '7 days'$cmd$
    );
  end if;
end $$;
