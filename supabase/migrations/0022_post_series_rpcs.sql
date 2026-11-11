-- Worlds · recurring events: create, edit, pause / resume / end, cancel one date
-- (FR-POST-024, issue #2086), and the end of a recurring ride (FR-RIDE-046 AC6)
--
-- PM decisions of 2026-11-11: the publisher may cancel any date of a series, or the whole
-- series, also when people registered; each of them is told. Ending a series cancels every
-- upcoming date, registered ones included — for recurring rides too, where a booked ride
-- used to live on as a one-off ride (D103).
-- Errors: SQLSTATE P0001 — post_series_not_found, post_series_schedule_invalid,
-- post_series_no_occurrence, post_series_date_started, illegal_transition (an ended series),
-- forbidden (42501, an organization the caller may not publish for), and whatever an event
-- itself refuses (event_time_invalid, post_kind_not_allowed, …).

-- Cancels a published post for its owner: every live handoff is cancelled with the reason
-- `post_deleted` and its member is notified, then the post becomes `deleted_no_recipient`
-- (the body of public.delete_post, for server code that already checked the caller).
create function kc_private.post_cancel_by_owner(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_handoff_id uuid;
begin
  for v_handoff_id in
    select h.id from public.post_handoffs h
     where h.post_id = p_post_id and h.status in ('waitlisted', 'reserved', 'confirmed')
  loop
    perform kc_private.handoff_move(v_handoff_id, 'cancelled', 'owner', 'post_deleted');
  end loop;
  perform kc_private.post_move(p_post_id, 'deleted_no_recipient', 'owner');
end;
$$;
comment on function kc_private.post_cancel_by_owner(uuid) is
  'Cancels and notifies the live handoffs of a post, then moves it to deleted_no_recipient.';

-- A deleted date is remembered whichever way it was deleted (the series screen, the post's
-- own delete, an administrator of its organization): the post is purged after a week and
-- the scheduler must not publish that day again.
create function kc_private.posts_remember_deleted_series_date()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into kc_private.post_series_skipped_days (series_id, skipped_on)
  select e.series_id, e.series_on
    from public.post_event_details e
   where e.post_id = new.id and e.series_id is not null
  on conflict do nothing;
  return null;
end;
$$;
comment on function kc_private.posts_remember_deleted_series_date() is
  'Records the day of a deleted date of a recurring event, so it is never published again.';

create trigger posts_remember_deleted_series_date
  after update of status on public.posts
  for each row when (new.status = 'deleted_no_recipient' and new.post_type = 'event')
  execute function kc_private.posts_remember_deleted_series_date();

-- Removes the upcoming dates of a series that nobody registered for. A date somebody
-- registered for (in any state but cancelled) stays.
create function kc_private.post_series_drop_unregistered(p_series_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.posts p
   using public.post_event_details e
   where e.post_id = p.id and e.series_id = p_series_id and e.starts_at > now()
     and p.status in ('open', 'paused')
     and not exists (select 1 from public.post_handoffs h where h.post_id = p.id and h.status <> 'cancelled');
$$;
comment on function kc_private.post_series_drop_unregistered(uuid) is
  'Deletes the upcoming, never-registered dates of a recurring event.';

-- Locks a series of the caller; one error for "no such series" and "not yours".
create function kc_private.post_series_lock(p_series_id uuid)
returns public.post_series
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_active_caller();
  v_series public.post_series;
begin
  select s.* into v_series from public.post_series s
   where s.id = p_series_id and s.owner_id = v_user_id for update;
  if not found then
    raise exception 'post_series_not_found' using errcode = 'P0001';
  end if;
  return v_series;
end;
$$;
comment on function kc_private.post_series_lock(uuid) is 'Row-locks a recurring event owned by the caller.';

-- Creates a recurring event and publishes its dates. p_post and p_event are the payloads
-- of public.create_post_with_details for one event, without its start and end. p_org_id
-- publishes every date for an organization the caller may act for. The first date proves
-- the template: a series that publishes nothing is refused.
create function public.create_post_series(
  p_post jsonb, p_event jsonb, p_start_time time, p_weekdays integer, p_duration_minutes integer,
  p_ends_on date default null, p_time_zone text default 'Asia/Jerusalem', p_org_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_active_caller();
  v_series_id uuid;
begin
  if p_org_id is not null and not kc_private.can_act_as_org(p_org_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  begin
    insert into public.post_series (
      owner_id, beneficiary_org_id, post_template, event_template, start_time, weekdays,
      duration_minutes, ends_on, time_zone, starts_on)
    values (
      v_user_id, p_org_id, p_post - 'id' - 'status',
      p_event - 'starts_at' - 'ends_at' - 'series_id' - 'series_on',
      p_start_time, p_weekdays, p_duration_minutes, p_ends_on, coalesce(p_time_zone, 'Asia/Jerusalem'),
      (now() at time zone coalesce(p_time_zone, 'Asia/Jerusalem'))::date)
    returning id into v_series_id;
  exception when check_violation or not_null_violation or invalid_parameter_value then
    raise exception 'post_series_schedule_invalid' using errcode = 'P0001';
  end;
  if kc_private.post_series_materialize(v_series_id) = 0 then
    raise exception 'post_series_no_occurrence' using errcode = 'P0001';
  end if;
  return v_series_id;
end;
$$;
comment on function public.create_post_series(jsonb, jsonb, time, integer, integer, date, text, uuid) is
  'Creates a recurring event for the caller and publishes its dates for the next 30 days.';
grant execute on function public.create_post_series(jsonb, jsonb, time, integer, integer, date, text, uuid) to authenticated;

-- Edits the whole series: the schedule and, when given, the templates. Upcoming dates
-- nobody registered for are replaced; a date with registrations keeps its time and details.
create function public.update_post_series(
  p_series_id uuid, p_start_time time, p_weekdays integer, p_duration_minutes integer,
  p_ends_on date default null, p_post jsonb default null, p_event jsonb default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_series constant public.post_series := kc_private.post_series_lock(p_series_id);
begin
  if v_series.status = 'ended' then
    raise exception 'post_series_not_found' using errcode = 'P0001';
  end if;
  begin
    update public.post_series s
       set start_time = p_start_time, weekdays = p_weekdays,
           duration_minutes = p_duration_minutes, ends_on = p_ends_on,
           post_template = coalesce(p_post - 'id' - 'status', s.post_template),
           event_template = coalesce(p_event - 'starts_at' - 'ends_at' - 'series_id' - 'series_on', s.event_template)
     where s.id = p_series_id;
  exception when check_violation or not_null_violation then
    raise exception 'post_series_schedule_invalid' using errcode = 'P0001';
  end;
  perform kc_private.post_series_drop_unregistered(p_series_id);
  perform kc_private.post_series_materialize(p_series_id);
end;
$$;
comment on function public.update_post_series(uuid, time, integer, integer, date, jsonb, jsonb) is
  'Edits a recurring event: unregistered upcoming dates follow the new schedule and template.';
grant execute on function public.update_post_series(uuid, time, integer, integer, date, jsonb, jsonb) to authenticated;

-- Pauses, resumes or ends a series (machine `post_series`). Pausing removes the upcoming
-- dates nobody registered for and keeps the others; resuming publishes the next 30 days
-- again; ending is terminal and cancels every upcoming date, telling each registrant.
create function public.set_post_series_status(p_series_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_series constant public.post_series := kc_private.post_series_lock(p_series_id);
  v_post_id uuid;
begin
  if p_status = v_series.status then
    return;
  end if;
  update public.post_series s set status = p_status where s.id = p_series_id;
  if p_status = 'active' then
    perform kc_private.post_series_materialize(p_series_id);
    return;
  end if;
  perform kc_private.post_series_drop_unregistered(p_series_id);
  if p_status = 'ended' then
    for v_post_id in
      select p.id from public.posts p
        join public.post_event_details e on e.post_id = p.id
       where e.series_id = p_series_id and e.starts_at > now() and p.status in ('open', 'paused')
       for update of p
    loop
      perform kc_private.post_cancel_by_owner(v_post_id);
    end loop;
  end if;
end;
$$;
comment on function public.set_post_series_status(uuid, text) is
  'Pauses, resumes or ends a recurring event of the caller; ending cancels its upcoming dates.';
grant execute on function public.set_post_series_status(uuid, text) to authenticated;

-- Cancels one upcoming date of a series the caller owns: its registrants are told and the
-- day is not published again (posts_remember_deleted_series_date).
create function public.cancel_post_series_date(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.post_event_details;
begin
  select e.* into v_event from public.post_event_details e
   where e.post_id = p_post_id and e.series_id is not null;
  if not found then
    raise exception 'post_series_not_found' using errcode = 'P0001';
  end if;
  perform kc_private.post_series_lock(v_event.series_id);
  if v_event.starts_at <= now() then
    raise exception 'post_series_date_started' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.posts p where p.id = p_post_id and p.status in ('open', 'paused')) then
    perform kc_private.post_cancel_by_owner(p_post_id);
  end if;
end;
$$;
comment on function public.cancel_post_series_date(uuid) is
  'Cancels one upcoming date of a recurring event of the caller and tells its registrants.';
grant execute on function public.cancel_post_series_date(uuid) to authenticated;

-- ── Recurring rides: cancelling the series ends its booked rides too ─────────
-- Unbooked upcoming rides are removed as before. An upcoming ride somebody booked is now
-- cancelled like a deleted ride: each passenger's seat ends as `post_deleted` and the
-- passenger is told. Rides that already left are detached and stay as they are.
create or replace function public.set_ride_series_status(p_series_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_series constant public.ride_series := kc_private.ride_series_lock(p_series_id);
  v_post_id uuid;
begin
  if p_status = v_series.status then
    return;
  end if;
  update public.ride_series s set status = p_status where s.id = p_series_id;
  if p_status = 'active' then
    perform kc_private.ride_series_materialize(p_series_id);
    return;
  end if;
  perform kc_private.ride_series_drop_unbooked(p_series_id);
  if p_status = 'cancelled' then
    for v_post_id in
      select p.id from public.posts p
        join public.post_ride_details r on r.post_id = p.id
       where r.series_id = p_series_id and r.departs_at > now() and p.status in ('open', 'paused')
       for update of p
    loop
      perform kc_private.post_cancel_by_owner(v_post_id);
    end loop;
    update public.post_ride_details r set series_id = null where r.series_id = p_series_id;
  end if;
end;
$$;
comment on function public.set_ride_series_status(uuid, text) is
  'Pauses, resumes or cancels a recurring ride of the caller; cancelling ends its upcoming rides, booked ones included.';
