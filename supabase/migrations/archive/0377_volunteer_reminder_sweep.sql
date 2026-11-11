-- 0377_volunteer_reminder_sweep | Upcoming shift reminders into notifications_outbox.

begin;

create or replace function public.volunteer_shift_reminder_sweep()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  r record;
begin
  for r in
    select su.user_id, su.signup_id, s.shift_id, s.starts_at, o.title, o.opportunity_id
      from public.volunteer_shift_signups su
      join public.volunteer_shifts s on s.shift_id = su.shift_id
      join public.volunteer_opportunities o on o.opportunity_id = s.opportunity_id
     where su.status = 'registered'
       and s.starts_at > now()
       and s.starts_at <= now() + interval '24 hours'
  loop
    perform public.enqueue_notification(
      r.user_id,
      'social',
      'volunteer_shift_reminder',
      'notifications.volunteerReminderTitle',
      'notifications.volunteerReminderBody',
      jsonb_build_object('title', r.title, 'starts_at', r.starts_at),
      jsonb_build_object(
        'route', '/(tabs)/donations/time/opportunity/' || r.opportunity_id::text,
        'shift_id', r.shift_id
      ),
      'volunteer_reminder:' || r.shift_id::text || ':' || r.user_id::text,
      false
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.volunteer_shift_reminder_sweep() from public;
grant execute on function public.volunteer_shift_reminder_sweep() to service_role;

commit;
