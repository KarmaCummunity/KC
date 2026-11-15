-- 0685_fsm_post_events_expire — wave 1b-iii of docs/architecture/state-machines.md (#1989).
--
-- D128 (PM, 2026-11-09): an event post expires automatically when the event ends (clarifies
-- D21 "event & ticket — at their date"). Until now no writer moved an event to `expired`;
-- only food, rides and ride series had expiry sweeps, so a finished event stayed open in the
-- feed forever.
--
-- `events_expired_sweep` moves every open or paused event post whose window has ended
-- (`event_post_details.ends_at <= now()`) to `expired`, on the post graph's existing edges
-- (open → expired, paused → expired). Registrations stay as they are: the organizer marks
-- attendance after the event (`mark_event_attendance` reads the window, not the post status).
-- Scheduled hourly, like the food sweep (0387).

begin;

create or replace function public.events_expired_sweep()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  update public.posts p
     set status = 'expired', updated_at = now()
    from public.event_post_details e
   where e.post_id = p.post_id
     and e.ends_at <= now()
     and p.status in ('open', 'paused');
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.events_expired_sweep() is
  'D128 (0685): moves open or paused event posts whose window has ended to expired. Hourly (pg_cron).';

revoke all on function public.events_expired_sweep() from public, anon, authenticated;
grant execute on function public.events_expired_sweep() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'events_expired_hourly') then
      perform cron.unschedule('events_expired_hourly');
    end if;
    perform cron.schedule(
      'events_expired_hourly',
      '25 * * * *',
      $sql$ select public.events_expired_sweep(); $sql$
    );
  else
    raise notice 'pg_cron not enabled — events expiry sweep not scheduled.';
  end if;
end $$;

commit;
