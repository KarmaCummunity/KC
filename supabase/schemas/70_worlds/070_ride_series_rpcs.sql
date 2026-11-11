-- Worlds · recurring rides: create, reschedule, pause / resume / cancel, materialise (D103)
--
-- Occurrences are ordinary ride posts created through kc_private.post_create
-- (160_world_post_create.sql) in the role `system`, so they do not count against the
-- owner's open-post limit at publish time and pass every rule of a ride. Errors: SQLSTATE
-- P0001 — ride_series_not_found, ride_series_schedule_invalid, ride_series_no_occurrence,
-- and whatever a ride itself refuses (ride_place_invalid, declaration_required, …).

-- Publishes the occurrence of a series on one day, unless that day is not a ride day, its
-- departure already passed, or the occurrence exists. Returns the number created (0 or 1).
create function kc_private.ride_series_materialize_day(p_series public.ride_series, p_on date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_departs constant timestamptz := (p_on + p_series.depart_time) at time zone 'Asia/Jerusalem';
begin
  if (p_series.weekdays & (1 << extract(dow from p_on)::integer)) = 0 or v_departs <= now()
     or exists (select 1 from public.post_ride_details r
                 where r.series_id = p_series.id and r.series_on = p_on) then
    return 0;
  end if;
  -- The occurrences of a series are one member action, not one post each (95_platform).
  perform set_config('kc.rate_limit_exempt', 'on', true);
  perform kc_private.post_create(
    p_series.owner_id,
    p_series.post_template || jsonb_build_object('post_type', 'ride'),
    p_series.ride_template || jsonb_build_object(
      'departs_at', v_departs,
      'arrives_at', v_departs + make_interval(mins => p_series.duration_minutes),
      'series_id', p_series.id, 'series_on', p_on),
    'system');
  return 1;
exception when unique_violation then
  return 0;  -- a concurrent run published this day first
end;
$$;
comment on function kc_private.ride_series_materialize_day(public.ride_series, date) is
  'Publishes one occurrence of a recurring ride; idempotent per series and day.';

-- Publishes the missing occurrences of active series — one series, or all of them — from
-- today to 30 days ahead (Israel dates). A series whose owner's account is not active is
-- skipped until it is. Run by the scheduler and by the series RPCs.
create function kc_private.ride_series_materialize(p_series_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today constant date := (now() at time zone 'Asia/Jerusalem')::date;
  v_series public.ride_series;
  v_count integer := 0;
begin
  for v_series in
    select s.* from public.ride_series s
      join public.users u on u.id = s.owner_id and u.is_active
     where s.status = 'active' and (p_series_id is null or s.id = p_series_id)
     order by s.created_at
  loop
    select v_count + coalesce(sum(kc_private.ride_series_materialize_day(v_series, d.day::date)), 0)
      into v_count
      from generate_series(greatest(v_series.starts_on, v_today),
                           least(coalesce(v_series.ends_on, v_today + 30), v_today + 30),
                           interval '1 day') as d (day);
  end loop;
  return v_count;
end;
$$;
comment on function kc_private.ride_series_materialize(uuid) is
  'Publishes the missing occurrences of active recurring rides for the next 30 days; returns how many.';

-- Removes the upcoming occurrences of a series that nobody booked. A ride somebody booked
-- (in any state but cancelled) stays: it is an agreed ride (D103).
create function kc_private.ride_series_drop_unbooked(p_series_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.posts p
   using public.post_ride_details r
   where r.post_id = p.id and r.series_id = p_series_id and r.departs_at > now()
     and p.status in ('open', 'paused')
     and not exists (select 1 from public.post_handoffs h where h.post_id = p.id and h.status <> 'cancelled');
$$;
comment on function kc_private.ride_series_drop_unbooked(uuid) is
  'Deletes the upcoming, never-booked occurrences of a recurring ride.';

-- Locks a series of the caller; one error for "no such series" and "not yours".
create function kc_private.ride_series_lock(p_series_id uuid)
returns public.ride_series
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_active_caller();
  v_series public.ride_series;
begin
  select s.* into v_series from public.ride_series s
   where s.id = p_series_id and s.owner_id = v_user_id for update;
  if not found then
    raise exception 'ride_series_not_found' using errcode = 'P0001';
  end if;
  return v_series;
end;
$$;
comment on function kc_private.ride_series_lock(uuid) is 'Row-locks a recurring ride owned by the caller.';

-- Creates a recurring ride and publishes its occurrences. p_post and p_ride are the
-- payloads of public.create_post_with_details for one ride, without departure and arrival.
-- The first occurrence proves the template: a series that publishes nothing is refused.
create function public.create_ride_series(
  p_post jsonb, p_ride jsonb, p_depart_time time, p_weekdays integer,
  p_duration_minutes integer default null, p_ends_on date default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_active_caller();
  v_series_id uuid;
begin
  begin
    insert into public.ride_series (
      owner_id, post_template, ride_template, depart_time, weekdays, duration_minutes, ends_on)
    values (
      v_user_id, p_post - 'id' - 'status', p_ride - 'departs_at' - 'arrives_at' - 'series_id' - 'series_on',
      p_depart_time, p_weekdays, p_duration_minutes, p_ends_on)
    returning id into v_series_id;
  exception when check_violation or not_null_violation then
    raise exception 'ride_series_schedule_invalid' using errcode = 'P0001';
  end;
  if kc_private.ride_series_materialize(v_series_id) = 0 then
    raise exception 'ride_series_no_occurrence' using errcode = 'P0001';
  end if;
  return v_series_id;
end;
$$;
comment on function public.create_ride_series(jsonb, jsonb, time, integer, integer, date) is
  'Creates a recurring ride for the caller and publishes its occurrences for the next 30 days.';
grant execute on function public.create_ride_series(jsonb, jsonb, time, integer, integer, date) to authenticated;

-- Changes the schedule of a series. The route is not editable (publish a new series):
-- upcoming unbooked occurrences are replaced by the new schedule, booked ones stay.
create function public.update_ride_series(
  p_series_id uuid, p_depart_time time, p_weekdays integer,
  p_duration_minutes integer default null, p_ends_on date default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_series constant public.ride_series := kc_private.ride_series_lock(p_series_id);
begin
  if v_series.status = 'cancelled' then
    raise exception 'ride_series_not_found' using errcode = 'P0001';
  end if;
  begin
    update public.ride_series s
       set depart_time = p_depart_time, weekdays = p_weekdays,
           duration_minutes = p_duration_minutes, ends_on = p_ends_on
     where s.id = p_series_id;
  exception when check_violation or not_null_violation then
    raise exception 'ride_series_schedule_invalid' using errcode = 'P0001';
  end;
  perform kc_private.ride_series_drop_unbooked(p_series_id);
  perform kc_private.ride_series_materialize(p_series_id);
end;
$$;
comment on function public.update_ride_series(uuid, time, integer, integer, date) is
  'Reschedules a recurring ride: unbooked upcoming occurrences follow the new schedule.';
grant execute on function public.update_ride_series(uuid, time, integer, integer, date) to authenticated;

-- Pauses, resumes or cancels a series (machine `ride_series`). Pausing and cancelling
-- remove the upcoming unbooked occurrences; cancelling is terminal and detaches the rides
-- that stay, which live on as one-off rides; resuming publishes the next 30 days again.
create function public.set_ride_series_status(p_series_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_series constant public.ride_series := kc_private.ride_series_lock(p_series_id);
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
    update public.post_ride_details r set series_id = null where r.series_id = p_series_id;
  end if;
end;
$$;
comment on function public.set_ride_series_status(uuid, text) is
  'Pauses, resumes or cancels a recurring ride of the caller.';
grant execute on function public.set_ride_series_status(uuid, text) to authenticated;
