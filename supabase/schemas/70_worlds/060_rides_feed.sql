-- Worlds · rides feed and route search (D72, D75)
--
-- One query for the rides world: upcoming ride offers and requests, soonest first,
-- optionally only those running along a route. Candidates are found through the departure
-- and GiST indexes by a definer function (a distance test is not leak-proof, so under row
-- security it could not use an index); the rows themselves are then read with the caller's
-- rights, so RLS on `posts` decides what comes back.

-- Display name of an official place: the junction, "street, city", or the city.
create function kc_access.place_name(p_city_id text, p_street_id integer, p_junction_id integer)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_junction_id is not null then
      (select j.name_he from public.road_junctions j where j.junction_id = p_junction_id)
    else
      (select coalesce(s.name_he || ', ', '') || c.name_he
         from public.cities c
         left join public.streets s on s.city_id = c.city_id and s.street_id = p_street_id
        where c.city_id = p_city_id)
  end;
$$;
comment on function kc_access.place_name(text, integer, integer) is 'Hebrew display name of an official place.';
grant execute on function kc_access.place_name(text, integer, integer) to authenticated;

-- Ids of open rides departing after the cursor, soonest first, with what only the server
-- can count: free seats of an offer, and for a recurring ride the number of later dates
-- folded into this row. Filters: direction, departure before p_before, and a route — the
-- ride's origin or one of its meeting points within p_radius_m of p_origin and its
-- destination within p_radius_m of p_dest. Occurrences of one series beyond tomorrow
-- (Israel time) fold into the soonest of them (D103). The audience test here only keeps
-- pages full; the caller's own row access is the real gate.
create function kc_access.ride_candidates(
  p_direction text,
  p_origin extensions.geography,
  p_dest extensions.geography,
  p_radius_m double precision,
  p_after timestamptz,
  p_after_id uuid,
  p_before timestamptz,
  p_limit integer
)
returns table (post_id uuid, seats_left integer, series_more integer)
language sql
stable
security definer
set search_path = ''
as $$
  with horizon as (
    -- Midnight that starts the day after tomorrow, Israel time.
    select (((now() at time zone 'Asia/Jerusalem')::date + 2)::timestamp at time zone 'Asia/Jerusalem') as at
  )
  select r.post_id,
         case p.direction when 'offer' then greatest(r.seats - kc_private.handoff_seats_taken(r.post_id), 0) end,
         case when r.series_id is not null and r.departs_at >= h.at then
           (select count(*)::integer
              from public.post_ride_details o join public.posts op on op.id = o.post_id
             where o.series_id = r.series_id and o.departs_at > r.departs_at and op.status = 'open')
         else 0 end
    from public.post_ride_details r
    join public.posts p on p.id = r.post_id
   cross join horizon h
   where p.status = 'open'
     and (r.departs_at, r.post_id) > (p_after, p_after_id)
     and (p_before is null or r.departs_at < p_before)
     and (p_direction is null or p.direction = p_direction)
     and (p_dest is null or extensions.st_dwithin(r.dest_point, p_dest, p_radius_m))
     and (p_origin is null
          or extensions.st_dwithin(r.origin_point, p_origin, p_radius_m)
          or exists (select 1 from jsonb_array_elements(r.meeting_points) m
                      where extensions.st_dwithin(
                              extensions.st_setsrid(extensions.st_makepoint(
                                (m ->> 'lng')::float8, (m ->> 'lat')::float8), 4326)::extensions.geography,
                              p_origin, p_radius_m)))
     and (p.owner_id = (select auth.uid())
          or p.visibility = 'Public'
          or (p.visibility = 'FollowersOnly'
              and exists (select 1 from public.follows f
                           where f.follower_id = (select auth.uid()) and f.followed_id = p.owner_id)))
     and (r.series_id is null or r.departs_at < h.at
          or not exists (select 1 from public.post_ride_details o join public.posts op on op.id = o.post_id
                          where o.series_id = r.series_id and o.departs_at >= h.at
                            and o.departs_at < r.departs_at and op.status = 'open'))
   order by r.departs_at, r.post_id
   limit p_limit;
$$;
comment on function kc_access.ride_candidates(
  text, extensions.geography, extensions.geography, double precision, timestamptz, uuid, timestamptz, integer) is
  'Ids of upcoming open rides matching a direction, time window and route, with free seats and folded series dates.';
grant execute on function kc_access.ride_candidates(
  text, extensions.geography, extensions.geography, double precision, timestamptz, uuid, timestamptz, integer)
  to authenticated;

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
