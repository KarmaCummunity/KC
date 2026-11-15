-- Worlds · the schedule of a recurring ride, readable through its occurrences (FR-RIDE-046)
--
-- A passenger sees the weekdays and departure time of a recurring ride without reading the
-- owner's ride_series row: rides_feed returns the series day, weekdays and departure time of
-- each occurrence, and ride_occurrence_schedules gives the schedule to the detail screen.

-- The schedule of a series as the readers of its occurrences see it (FR-RIDE-046): days,
-- departure time (Israel time) and last day, while the series is not cancelled. The row
-- itself stays its owner's; this is released only through rides_feed and
-- ride_occurrence_schedules, which reach a series through an occurrence the caller can read.
create function kc_access.ride_series_schedule(p_series_id uuid)
returns table (weekdays smallint, depart_time time, ends_on date)
language sql
stable
security definer
set search_path = ''
as $$
  select s.weekdays, s.depart_time, s.ends_on
    from public.ride_series s
   where s.id = p_series_id and s.status <> 'cancelled';
$$;
comment on function kc_access.ride_series_schedule(uuid) is
  'Weekdays, departure time and last day of a running series; released through readable occurrences only.';
grant execute on function kc_access.ride_series_schedule(uuid) to authenticated;

-- rides_feed gains three columns (series_on, series_weekdays, series_depart_time). A new
-- result row type cannot be set by `create or replace`, so the function is dropped and
-- created again with the comment and grant of the baseline.
drop function public.rides_feed(jsonb, integer, jsonb);

-- One page of the rides feed, soonest departure first. p_filters (every key optional):
--   direction                 'offer' | 'request'
--   origin, dest              an official place each: {city_id, street_id, junction_id};
--                             with either, only rides along that route are returned
--   radius_km                 distance of a ride's ends from the route's ends, default 15
--   departs_after / _before   departure window; the feed never shows a departed ride
-- An occurrence of a recurring ride carries its day and its series' weekdays (bit 0 =
-- Sunday) and departure time, so the feed can mark it (FR-RIDE-046).
-- Keyset on (departs_at, post_id): pass the last row's next_cursor to continue.
--   ride_place_invalid  a route end that is not an official place
create function public.rides_feed(
  p_cursor jsonb default null,
  p_limit integer default 30,
  p_filters jsonb default '{}'::jsonb
)
returns table (
  post_id uuid, owner_id uuid, direction text, title text, departs_at timestamptz, arrives_at timestamptz,
  origin_name text, dest_name text, meeting_points jsonb, seats integer, seats_left integer,
  reward_model text, series_id uuid, series_more integer, series_on date, series_weekdays smallint,
  series_depart_time time, next_cursor jsonb)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_f constant jsonb := coalesce(p_filters, '{}'::jsonb);
  v_origin extensions.geography;
  v_dest extensions.geography;
begin
  select kc_access.place_point(o.city_id, o.street_id, o.junction_id) into v_origin
    from jsonb_to_record(v_f -> 'origin') as o (city_id text, street_id integer, junction_id integer);
  select kc_access.place_point(d.city_id, d.street_id, d.junction_id) into v_dest
    from jsonb_to_record(v_f -> 'dest') as d (city_id text, street_id integer, junction_id integer);
  if (v_f ? 'origin' and v_origin is null) or (v_f ? 'dest' and v_dest is null) then
    raise exception 'ride_place_invalid' using errcode = 'P0001';
  end if;

  return query
  select p.id, p.owner_id, p.direction, p.title, r.departs_at, r.arrives_at,
         kc_access.place_name(r.origin_city_id, r.origin_street_id, r.origin_junction_id),
         kc_access.place_name(r.dest_city_id, r.dest_street_id, r.dest_junction_id),
         r.meeting_points, r.seats::integer, c.seats_left, r.reward_model, r.series_id, c.series_more,
         r.series_on, sch.weekdays, sch.depart_time,
         jsonb_build_object('t', r.departs_at, 'id', p.id)
    from kc_access.ride_candidates(
           v_f ->> 'direction', v_origin, v_dest,
           least(greatest(coalesce((v_f ->> 'radius_km')::double precision, 15), 1), 100) * 1000,
           greatest(now(), coalesce((p_cursor ->> 't')::timestamptz, (v_f ->> 'departs_after')::timestamptz, now())),
           coalesce((p_cursor ->> 'id')::uuid, '00000000-0000-0000-0000-000000000000'),
           (v_f ->> 'departs_before')::timestamptz,
           least(greatest(coalesce(p_limit, 30), 1), 100)) c
    join public.posts p on p.id = c.post_id
    join public.post_ride_details r on r.post_id = c.post_id
    left join lateral kc_access.ride_series_schedule(r.series_id) sch on true
   order by r.departs_at, p.id;
end;
$$;
comment on function public.rides_feed(jsonb, integer, jsonb) is
  'One page of upcoming rides the caller can read, soonest first, optionally along a route.';
grant execute on function public.rides_feed(jsonb, integer, jsonb) to authenticated;

-- The series schedule of the listed ride posts the caller can read (at most 100 ids): one
-- row per occurrence of a running series, with its day, the series' weekdays (bit 0 =
-- Sunday), departure time (Israel time) and last day. A single ride, a cancelled series and
-- a post the caller cannot read give no row. The detail screen of an occurrence reads it.
create function public.ride_occurrence_schedules(p_post_ids uuid[])
returns table (post_id uuid, series_id uuid, series_on date, weekdays smallint, depart_time time, ends_on date)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.post_id, r.series_id, r.series_on, sch.weekdays, sch.depart_time, sch.ends_on
    from public.post_ride_details r
    cross join lateral kc_access.ride_series_schedule(r.series_id) sch
   where r.post_id = any (p_post_ids[1:100]) and r.series_id is not null;
$$;
comment on function public.ride_occurrence_schedules(uuid[]) is
  'Series day, weekdays, departure time and last day of the listed ride occurrences the caller can read.';
grant execute on function public.ride_occurrence_schedules(uuid[]) to authenticated;
