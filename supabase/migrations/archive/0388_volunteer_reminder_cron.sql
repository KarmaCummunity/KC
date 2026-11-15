-- 0388_volunteer_reminder_cron | Schedule volunteer_shift_reminder_sweep via pg_cron.

begin;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'volunteer_shift_reminder_hourly') then
      perform cron.unschedule('volunteer_shift_reminder_hourly');
    end if;
    perform cron.schedule(
      'volunteer_shift_reminder_hourly',
      '0 * * * *',
      $sql$ select public.volunteer_shift_reminder_sweep(); $sql$
    );
  else
    raise notice 'pg_cron not enabled — volunteer_shift_reminder_hourly not scheduled.';
  end if;
end $$;

commit;
