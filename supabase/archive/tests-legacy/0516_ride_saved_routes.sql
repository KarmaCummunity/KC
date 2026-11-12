-- 0516_ride_saved_routes.sql | Saved routes and their alerts (G48, D74, S44 urgency rule).
-- Places: Tel Aviv 5000, Jerusalem 3000, Haifa 4000, Ramat Gan 8600 (official cities, D71).

begin;

-- No platform quiet window during the test; quiet hours are set per user where tested.
update public.matching_settings set quiet_start = '00:00', quiet_end = '00:00';

create temp table personas as
select kc_test.create_user('sr_driver') as driver,
       kc_test.create_user('sr_rider') as rider;

create function pg_temp.follow(p_user uuid, p_from text, p_to text, p_extra jsonb default '{}'::jsonb)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  perform kc_test.act_as(p_user);
  insert into public.ride_saved_routes (user_id, origin_place_kind, origin_place_id, origin_label, origin_lat, origin_lng,
                                        dest_place_kind, dest_place_id, dest_label, dest_lat, dest_lng, weekdays)
  values (p_user, 'city', p_from, '', 0, 0, 'city', p_to, '', 0, 0, (p_extra->>'weekdays')::smallint)
  returning route_id into v_id;
  return v_id;
end;
$$;

create function pg_temp.alerts(p_user uuid, p_listing uuid)
returns bigint
language sql
as $$
  select count(*) from public.notifications_outbox
   where user_id = p_user and kind = 'ride_route_match' and data->'params'->>'listingId' = p_listing::text
$$;

create function pg_temp.ride(p_route jsonb default kc_test.ride_route_tlv_jlm(), p_in interval default interval '3 hours')
returns uuid
language sql
as $$
  select kc_test.create_ride_offer((select driver from personas), 3, p_in, p_route);
$$;

-- 1) A followed route hears about a new ride on it; names and coordinates are official.
do $$
declare
  p personas;
  v_route uuid;
  v_ride uuid;
begin
  select * into p from personas;
  v_route := pg_temp.follow(p.rider, '5000', '3000');
  perform kc_test.assert_eq((select origin_lat from public.ride_saved_routes where route_id = v_route),
    (select lat from public.cities where city_id = '5000'), 'a saved route stores the official place');

  v_ride := pg_temp.ride();
  perform kc_test.assert_eq(pg_temp.alerts(p.rider, v_ride), 1::bigint, 'the follower is alerted to a ride on the route');

  v_ride := pg_temp.ride(jsonb_build_object('origin_place_kind', 'city', 'origin_place_id', '5000',
                                            'dest_place_kind', 'city', 'dest_place_id', '4000'));
  perform kc_test.assert_eq(pg_temp.alerts(p.rider, v_ride), 0::bigint, 'a ride to another destination is not an alert');
end $$;

-- 2) A meeting point near the followed origin is a match too; the owner never alerts themselves.
do $$
declare
  p personas;
  v_ride uuid;
begin
  select * into p from personas;
  perform pg_temp.follow(p.rider, '8600', '3000');
  perform pg_temp.follow(p.driver, '5000', '3000');
  v_ride := pg_temp.ride(kc_test.ride_route_tlv_jlm() || jsonb_build_object('origin_place_id', '4000',
    'meeting_points', jsonb_build_array(jsonb_build_object('kind', 'city', 'id', '8600'))));
  perform kc_test.assert_eq(pg_temp.alerts(p.rider, v_ride), 1::bigint, 'a pickup point on the route counts');
  perform kc_test.assert_eq(pg_temp.alerts(p.driver, v_ride), 0::bigint, 'the publisher is not alerted to their own ride');
end $$;

-- 3) Followed weekdays filter rides.
do $$
declare
  p personas;
  v_ride uuid;
  v_other_day smallint;
begin
  select * into p from personas;
  delete from public.ride_saved_routes where user_id = p.rider;
  -- Every weekday except the ride's (Israel time).
  v_other_day := 127 - (1 << extract(dow from (now() + interval '3 hours') at time zone 'Asia/Jerusalem')::int);
  perform pg_temp.follow(p.rider, '5000', '3000', jsonb_build_object('weekdays', v_other_day));
  v_ride := pg_temp.ride();
  perform kc_test.assert_eq(pg_temp.alerts(p.rider, v_ride), 0::bigint, 'a ride on an unfollowed day is not an alert');
end $$;

-- 4) Quiet hours: a ride after the window waits; a ride leaving before it ends goes out now (S44).
do $$
declare
  p personas;
  v_late uuid;
  v_urgent uuid;
begin
  select * into p from personas;
  delete from public.ride_saved_routes where user_id = p.rider;
  perform pg_temp.follow(p.rider, '5000', '3000');
  update public.users set notification_preferences = notification_preferences || jsonb_build_object('quietHours', jsonb_build_object(
    'enabled', true, 'timezone', 'UTC',
    'start', to_char(now() at time zone 'UTC' - interval '1 hour', 'HH24:MI'),
    'end', to_char(now() at time zone 'UTC' + interval '2 hours', 'HH24:MI')))
   where user_id = p.rider;

  v_late := pg_temp.ride(p_in => interval '5 hours');
  v_urgent := pg_temp.ride(p_in => interval '1 hour');
  perform kc_test.assert_eq(pg_temp.alerts(p.rider, v_late), 0::bigint, 'a ride after the quiet window waits');
  perform kc_test.assert_eq(pg_temp.alerts(p.rider, v_urgent), 1::bigint, 'a ride leaving before the window ends goes out now');

  update public.users set notification_preferences = notification_preferences - 'quietHours' where user_id = p.rider;
  perform kc_test.act_as_anon();
  perform public.ride_route_alerts_sweep();
  perform kc_test.assert_eq(pg_temp.alerts(p.rider, v_late), 1::bigint, 'the waiting alert goes out after quiet hours');
end $$;

-- 5) At most 10 route alerts a day: rides on the route use up the day's alerts, the next is capped.
do $$
declare
  p personas;
  v_ride uuid;
  v_sent_today int;
begin
  select * into p from personas;
  v_sent_today := (select count(*) from public.ride_route_alerts where user_id = p.rider and status = 'sent');
  perform pg_temp.ride() from generate_series(1, 10 - v_sent_today);
  v_ride := pg_temp.ride();
  perform kc_test.assert_eq(pg_temp.alerts(p.rider, v_ride), 0::bigint, 'an 11th alert in a day is not sent');
  perform kc_test.assert_eq((select status from public.ride_route_alerts where user_id = p.rider and listing_id = v_ride),
    'capped', 'it is recorded as capped');
end $$;

-- 6) Official places only, and at most 10 routes.
do $$
declare
  p personas;
begin
  select * into p from personas;
  perform kc_test.assert_raises(format('select pg_temp.follow(%L, %L, %L)', p.driver, 'no-such-city', '3000'),
    'ride_place_invalid', 'a saved route needs official places');
  delete from public.ride_saved_routes where user_id = p.driver;
  perform pg_temp.follow(p.driver, c.city_id, '3000')
     from (select city_id from public.cities where lat is not null and city_id <> '3000' order by city_id limit 10) c;
  perform kc_test.assert_raises(format('select pg_temp.follow(%L, %L, %L)', p.driver, '4000', '5000'),
    'saved_routes_limit', 'an 11th saved route is refused');
end $$;

rollback;

\echo '✓ 0516_ride_saved_routes.sql passed'
