-- 0077_notifications_backlog_alert | TD-64
-- Daily check: raise a NOTICE (visible in Supabase logs) when the
-- notifications_outbox has more than 10 rows undispatched for > 15 minutes.
--
-- In the absence of external alerting infra (Grafana, PagerDuty), a NOTICE in
-- the Supabase PostgreSQL logs is the best available signal. Operators watch
-- the Logs tab in the Supabase dashboard or pipe logs to an external sink.
--
-- Requires pg_cron (same operator note as 0016/0045/0076).

create or replace function public.notifications_backlog_check()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stale_count integer;
begin
  select count(*)
    into v_stale_count
    from public.notifications_outbox
   where dispatched_at is null
     and created_at < now() - interval '15 minutes';

  if v_stale_count > 10 then
    raise notice
      'ALERT notifications_backlog: % undelivered rows older than 15 minutes in notifications_outbox',
      v_stale_count;
  end if;
end $$;

revoke execute on function public.notifications_backlog_check() from public, authenticated, anon;

-- Daily at 06:00 UTC — after the 03:00 and 04:00 crons.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'notifications_backlog_daily') then
      perform cron.unschedule('notifications_backlog_daily');
    end if;
    perform cron.schedule(
      'notifications_backlog_daily',
      '0 6 * * *',
      $sql$ select public.notifications_backlog_check(); $sql$
    );
  else
    raise notice
      'pg_cron not enabled — notifications_backlog_daily not scheduled.';
  end if;
end $$;

-- end of 0077_notifications_backlog_alert
