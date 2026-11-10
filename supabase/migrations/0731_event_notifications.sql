-- 0731_event_notifications | Event registration notifications (G18 "Next: event notifications";
-- PM decision {{D:event-notifications}})
--
-- Until now an event told its attendees only that the organizer cancelled it (0686). This adds:
--
-- 1. `kc_private.event_registration_notify` (after insert or status update on `post_handoffs`,
--    time world only), one push per move:
--    - a join request under the manual policy, to the organizer (`event_join_request`), also when
--      a waitlisted member moves up into a request;
--    - approval, to the registrant (`event_registration_approved`);
--    - moving up from the waitlist, to the registrant (`event_registration_promoted`);
--    - a decline or a removal by the organizer, to the registrant (`event_registration_declined`).
--    The organizer's whole-event cancel (`host_cancelled`) keeps its own push (0686).
-- 2. `event_reminder_sweep()`, hourly: every confirmed attendee hears once, within 24 hours of
--    the start, that the event is tomorrow (`event_reminder`).
-- 3. `event_attendance_prompt_sweep()`, hourly: once an event has ended, its organizer is asked
--    once to mark attendance while confirmed registrations are still unmarked
--    (`event_mark_attendance`); only marked attendance earns karma (D124).

-- ── 1. Registration moves ──────────────────────────────────────────────────────
create or replace function kc_private.event_registration_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old     text := case when tg_op = 'UPDATE' then old.status end;
  v_title   text;
  v_route   jsonb := jsonb_build_object('route', '/post/[id]', 'params', jsonb_build_object('postId', new.post_id::text));
  v_kind    text;
  v_name    text;
begin
  -- Only an event's registrations (`post_type = 'event'`); other time-world handoffs stay silent.
  select p.title into v_title
    from public.posts p
   where p.post_id = new.post_id and p.post_type = 'event';
  if not found then
    return null;
  end if;
  v_title := coalesce(v_title, '');

  -- A new request for the organizer: registering under the manual policy, or moving up into one.
  if new.status = 'reserved' and (v_old is null or v_old = 'waitlisted') then
    select u.display_name into v_name from public.users u where u.user_id = new.recipient_id;
    perform public.enqueue_notification(
      new.owner_id, 'critical', 'event_join_request',
      'notifications.eventJoinRequestTitle', 'notifications.eventJoinRequestBody',
      jsonb_build_object('eventTitle', v_title, 'requesterName', coalesce(v_name, '')),
      v_route, 'event_join_request:' || new.handoff_id::text, false);
  end if;

  if v_old is null or v_old = new.status then
    return null;
  end if;

  -- The registrant's own news.
  v_kind := case
    when v_old = 'reserved' and new.status = 'confirmed' then 'approved'
    when v_old = 'waitlisted' and new.status in ('confirmed', 'reserved') then 'promoted'
    when new.status = 'cancelled' and new.cancel_reason = 'declined' then
      case when v_old = 'confirmed' then 'removed' else 'declined' end
  end;
  if v_kind is null then
    return null;
  end if;

  -- Copy keys are spelled out in full so the push-copy parity test finds each one.
  perform public.enqueue_notification(
    new.recipient_id, 'critical',
    case v_kind when 'removed' then 'event_registration_declined' else 'event_registration_' || v_kind end,
    case v_kind
      when 'approved' then 'notifications.eventRegistrationApprovedTitle'
      when 'promoted' then 'notifications.eventRegistrationPromotedTitle'
      when 'declined' then 'notifications.eventRegistrationDeclinedTitle'
      else 'notifications.eventRegistrationRemovedTitle' end,
    case
      when v_kind = 'approved' then 'notifications.eventRegistrationApprovedBody'
      -- A promotion into a manual event's request still waits for approval, and says so.
      when v_kind = 'promoted' and new.status = 'reserved' then 'notifications.eventRegistrationPromotedPendingBody'
      when v_kind = 'promoted' then 'notifications.eventRegistrationPromotedBody'
      when v_kind = 'declined' then 'notifications.eventRegistrationDeclinedBody'
      else 'notifications.eventRegistrationRemovedBody' end,
    jsonb_build_object('eventTitle', v_title),
    v_route, 'event_registration_' || v_kind || ':' || new.handoff_id::text, false);
  return null;
end;
$$;

comment on function kc_private.event_registration_notify() is
  'G18 (0731): pushes an event registration''s moves: a join request to the organizer; approval, promotion from the waitlist, decline or removal to the registrant.';

revoke all on function kc_private.event_registration_notify() from public, anon, authenticated;

drop trigger if exists post_handoffs_event_notify on public.post_handoffs;
create trigger post_handoffs_event_notify
  after insert or update of status on public.post_handoffs
  for each row when (new.world_slug = 'time')
  execute function kc_private.event_registration_notify();

-- ── 2. The day-before reminder ─────────────────────────────────────────────────
-- Confirmed attendees of events that start within the next 24 hours, once each. A member who
-- registered inside that window just saw the date, so they are not reminded.
create or replace function public.event_reminder_sweep()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  r record;
begin
  for r in
    select h.handoff_id, h.recipient_id, h.post_id, p.title, e.starts_at
      from public.post_handoffs h
      join public.event_post_details e on e.post_id = h.post_id
      join public.posts p on p.post_id = h.post_id
     where h.world_slug = 'time'
       and h.status = 'confirmed'
       and e.starts_at > now()
       and e.starts_at <= now() + interval '24 hours'
       and h.reserved_at <= e.starts_at - interval '24 hours'
  loop
    perform public.enqueue_notification(
      r.recipient_id, 'critical', 'event_reminder',
      'notifications.eventReminderTitle', 'notifications.eventReminderBody',
      jsonb_build_object('eventTitle', coalesce(r.title, ''), 'startsAt', r.starts_at),
      jsonb_build_object('route', '/post/[id]', 'params', jsonb_build_object('postId', r.post_id::text)),
      'event_reminder:' || r.handoff_id::text, false);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

comment on function public.event_reminder_sweep() is
  'G18 (0731, hourly): reminds each confirmed attendee once, within 24 hours of the event''s start.';

revoke all on function public.event_reminder_sweep() from public, anon, authenticated;
grant execute on function public.event_reminder_sweep() to service_role;

-- ── 3. Asking the organizer to mark attendance ─────────────────────────────────
-- Events that ended in the last 24 hours with confirmed registrations still unmarked; once each.
create or replace function public.event_attendance_prompt_sweep()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  r record;
begin
  for r in
    select p.post_id, p.owner_id, p.title, count(*)::integer as unmarked
      from public.event_post_details e
      join public.posts p on p.post_id = e.post_id
      join public.post_handoffs h on h.post_id = e.post_id and h.world_slug = 'time' and h.status = 'confirmed'
     where e.ends_at <= now()
       and e.ends_at > now() - interval '24 hours'
     group by p.post_id, p.owner_id, p.title
  loop
    perform public.enqueue_notification(
      r.owner_id, 'critical', 'event_mark_attendance',
      'notifications.eventMarkAttendanceTitle', 'notifications.eventMarkAttendanceBody',
      jsonb_build_object('eventTitle', coalesce(r.title, ''), 'count', r.unmarked),
      jsonb_build_object('route', '/post/[id]', 'params', jsonb_build_object('postId', r.post_id::text)),
      'event_mark_attendance:' || r.post_id::text, false);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

comment on function public.event_attendance_prompt_sweep() is
  'G18 (0731, hourly): asks an organizer once, after the event ends, to mark the attendance of its confirmed registrations.';

revoke all on function public.event_attendance_prompt_sweep() from public, anon, authenticated;
grant execute on function public.event_attendance_prompt_sweep() to service_role;

-- ── 4. Schedule ────────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'event_reminder_sweep') then
      perform cron.unschedule('event_reminder_sweep');
    end if;
    perform cron.schedule('event_reminder_sweep', '7 * * * *',
      $sql$ select public.event_reminder_sweep(); $sql$);

    if exists (select 1 from cron.job where jobname = 'event_attendance_prompt_sweep') then
      perform cron.unschedule('event_attendance_prompt_sweep');
    end if;
    perform cron.schedule('event_attendance_prompt_sweep', '17 * * * *',
      $sql$ select public.event_attendance_prompt_sweep(); $sql$);
  else
    raise notice 'pg_cron not enabled — event sweeps not scheduled.';
  end if;
end $$;
