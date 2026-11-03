-- 0428_cron_run_details_retention_1d | INFRA: shrink pg_cron run-history retention 7d -> 1d
--
-- cron.job_run_details still dominates DB size on the free plan. Keep 1 day of run
-- history instead of 7 (0195). Same job name and same schedule ('17 3 * * *');
-- only the retention interval changes. No other cron job is touched.
-- Guarded on pg_cron; idempotent (unschedule + reschedule by name).

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'purge_cron_run_details') then
      perform cron.unschedule('purge_cron_run_details');
    end if;
    perform cron.schedule(
      'purge_cron_run_details',
      '17 3 * * *',
      $cmd$delete from cron.job_run_details where end_time < now() - interval '1 day'$cmd$
    );
  end if;
end $$;
