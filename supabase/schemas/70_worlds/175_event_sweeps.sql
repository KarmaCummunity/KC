-- Worlds · event sweeps (run by the scheduler as the service role; scheduled by the ops module)
--
-- Two hourly sweeps around the time of an event, both safe to run twice: the notification
-- ledger keeps one notification per recipient and `dedupe_key`.
--   event_reminder_sweep            every confirmed registrant hears once, within 24 hours of
--                                   the start, that the event is near (`event_reminder`)
--   event_attendance_prompt_sweep   after the end, the organizer is asked once to mark the
--                                   attendance of confirmed registrations still unmarked
--                                   (`event_mark_attendance`); only marked attendance earns
--                                   karma (D124)
-- A registration that was never answered, and a place that never freed up, end with the
-- event itself: `post_expiry_sweep` (170) cancels them as `expired` and the registration
-- notification kinds tell each member.

create function kc_private.event_reminder_sweep(p_limit integer default 1000)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_count integer := 0;
begin
  -- A member who registered inside the window has just seen the date: no reminder for them.
  for v_row in
    select h.id, h.recipient_id, h.post_id, e.starts_at
      from public.post_handoffs h
      join public.post_event_details e on e.post_id = h.post_id
      join public.posts p on p.id = h.post_id
     where h.machine_id = 'event_registration' and h.status = 'confirmed'
       and p.status = 'open'
       and e.starts_at > now() and e.starts_at <= now() + interval '24 hours'
       and h.created_at <= e.starts_at - interval '24 hours'
     order by e.starts_at, h.id
     limit least(greatest(p_limit, 1), 10000)
  loop
    perform kc_private.outbox_enqueue('notification', jsonb_build_object(
      'kind', 'event_reminder', 'recipient_id', v_row.recipient_id, 'actor_id', null,
      'entity', jsonb_build_object('type', 'post', 'id', v_row.post_id),
      'data', jsonb_build_object(
        'world_slug', 'time', 'starts_at', v_row.starts_at,
        'dedupe_key', 'event_reminder:' || v_row.id)));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
comment on function kc_private.event_reminder_sweep(integer) is
  'Reminds each confirmed registrant, within 24 hours of an open event''s start; returns how many were queued.';

create function kc_private.event_attendance_prompt_sweep(p_limit integer default 500)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_count integer := 0;
begin
  for v_row in
    select p.id, p.owner_id, count(*)::integer as unmarked
      from public.post_event_details e
      join public.posts p on p.id = e.post_id
      join public.post_handoffs h on h.post_id = e.post_id
       and h.machine_id = 'event_registration' and h.status = 'confirmed'
     where e.ends_at <= now() and e.ends_at > now() - interval '24 hours'
     group by p.id, p.owner_id
     order by min(e.ends_at)
     limit least(greatest(p_limit, 1), 5000)
  loop
    perform kc_private.outbox_enqueue('notification', jsonb_build_object(
      'kind', 'event_mark_attendance', 'recipient_id', v_row.owner_id, 'actor_id', null,
      'entity', jsonb_build_object('type', 'post', 'id', v_row.id),
      'data', jsonb_build_object(
        'world_slug', 'time', 'count', v_row.unmarked,
        'dedupe_key', 'event_mark_attendance:' || v_row.id)));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
comment on function kc_private.event_attendance_prompt_sweep(integer) is
  'Asks an organizer once, after the event ended, to mark confirmed registrations; returns how many were queued.';
