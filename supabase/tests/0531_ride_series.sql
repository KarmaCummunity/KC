-- 0531_ride_series.sql | Recurring rides (FR-RIDE-046, #1413): a series materializes one
-- ride listing per upcoming day, only its soonest occurrence reaches the main feed, a follower
-- is alerted once, pause / resume / cancel / reschedule respect booked occurrences.
begin;

update public.matching_settings set quiet_start = '00:00', quiet_end = '00:00';

create temp table personas as
select kc_test.create_user('rsr_driver') as driver, kc_test.create_user('rsr_rider') as rider;

create temp table clock as
select (now() at time zone 'Asia/Jerusalem')::date as today,
       ((now() + interval '2 hours') at time zone 'Asia/Jerusalem')::time as soon;

create function pg_temp.soon() returns time language sql as $$ select soon from clock $$;

create function pg_temp.series(
  p_owner uuid, p_weekdays int default 127, p_time time default pg_temp.soon(),
  p_ends_on date default null, p_kind text default 'ride_offer',
  p_direction text default 'give', p_extra jsonb default jsonb_build_object('seats_available', 3)
) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  perform kc_test.act_as(p_owner);
  select r.series_id into v_id from public.create_ride_series(
    kc_test.listing_kind_id('rides', p_kind), 'Tel Aviv to Jerusalem',
    kc_test.ride_route_tlv_jlm() || p_extra, p_direction, p_time, p_weekdays, null, 60, p_ends_on) r;
  return v_id;
end $$;

create function pg_temp.occurrences(p_series uuid) returns setof public.listings language sql as $$
  select l.* from public.listings l
   where l.details -> 'ride_series' ->> 'id' = p_series::text and l.status = 'open'
   order by (l.details ->> 'departs_at')::timestamptz
$$;

create function pg_temp.expected_days(p_weekdays int, p_time time) returns bigint language sql as $$
  select count(*) from clock c, generate_series(c.today, c.today + 30, interval '1 day') d
   where (p_weekdays & (1 << extract(dow from d)::int)) <> 0
     and ((d::date + p_time) at time zone 'Asia/Jerusalem') > now()
$$;

-- 1) A series publishes one occurrence per matching day of the coming week, as real rides.
do $$
declare
  p personas; c clock; v_series uuid; v_first_id uuid; v_first public.listings;
begin
  select * into p from personas; select * into c from clock;
  perform kc_test.act_as(p.driver);
  select r.series_id, r.first_listing_id into v_series, v_first_id
    from public.create_ride_series(kc_test.listing_kind_id('rides', 'ride_offer'), 'Tel Aviv to Jerusalem',
      kc_test.ride_route_tlv_jlm() || jsonb_build_object('seats_available', 3), 'give', c.soon, 127, null, 60, null) r;
  perform kc_test.assert_eq((select count(*) from pg_temp.occurrences(v_series)),
    pg_temp.expected_days(127, c.soon), 'every day of the coming month gets an occurrence');
  perform kc_test.assert_eq(public.ride_series_materialize(v_series), 0,
    'materializing again creates nothing: one occurrence per series and day');
  select * into v_first from pg_temp.occurrences(v_series) limit 1;
  perform kc_test.assert_eq(v_first.details -> 'ride_series' ->> 'time', to_char(c.soon, 'HH24:MI'),
    'an occurrence carries the series time');
  perform kc_test.assert_eq((v_first.details -> 'ride_series' ->> 'weekdays')::int, 127,
    'an occurrence carries the series weekdays');
  perform kc_test.assert_eq(((v_first.details ->> 'departs_at')::timestamptz at time zone 'Asia/Jerusalem')::time,
    c.soon, 'the departure is the series time in Israel');
  perform kc_test.assert_eq((v_first.details ->> 'arrives_at')::timestamptz,
    (v_first.details ->> 'departs_at')::timestamptz + interval '60 minutes', 'the estimated end follows the series duration');
  perform kc_test.assert_eq(v_first.expires_at, (v_first.details ->> 'arrives_at')::timestamptz + interval '30 minutes',
    'an occurrence closes like any ride offer (0514)');
  perform kc_test.assert_true((v_first.details ->> 'origin_lat') is not null,
    'the places of an occurrence are official and canonical (0512)');
  perform kc_test.assert_eq(v_first_id, v_first.listing_id, 'the RPC hands back the soonest occurrence');
  perform kc_test.act_as_anon();
  perform kc_test.assert_true(
    (select f.recurrence ->> 'id' from public.list_rides_feed(200) f where f.listing_id = v_first.listing_id) = v_series::text,
    'the rides feed returns the recurrence of an occurrence');
  perform kc_test.assert_eq(
    (select count(*) from public.posts po
      where po.listing_id in (select listing_id from pg_temp.occurrences(v_series)) and not po.feed_hidden),
    1::bigint, 'only one occurrence of a series is listed in the main feed');
  perform kc_test.assert_true(exists (select 1 from public.posts po where po.listing_id = v_first.listing_id and not po.feed_hidden),
    'the listed occurrence is the soonest one');
  perform kc_test.assert_eq(
    (select count(*) from public.posts po where po.listing_id in (select listing_id from pg_temp.occurrences(v_series))),
    (select count(*) from pg_temp.occurrences(v_series)), 'every occurrence has its post');
end $$;

-- 2) When the mirrored occurrence departs, the sweep hands the main feed to the next one.
do $$
declare
  p personas; v_series uuid; v_first uuid; v_second uuid;
begin
  select * into p from personas;
  v_series := pg_temp.series(p.driver);
  select listing_id into v_first from pg_temp.occurrences(v_series) limit 1;
  select listing_id into v_second from pg_temp.occurrences(v_series) offset 1 limit 1;
  update public.listings set status = 'expired' where listing_id = v_first;
  update public.posts set status = 'expired' where listing_id = v_first;
  perform kc_test.act_as_anon();
  perform public.ride_series_sweep();
  perform kc_test.assert_true(exists (select 1 from public.posts po where po.listing_id = v_second and not po.feed_hidden),
    'the next occurrence is listed in the feed once it is the soonest');
end $$;

-- 2b) The rides feed lists today's and tomorrow's occurrences and folds the later ones into one row.
do $$
declare
  p personas; v_series uuid; v_total bigint; v_near bigint;
  v_horizon timestamptz := (((now() at time zone 'Asia/Jerusalem')::date + 2)::timestamp) at time zone 'Asia/Jerusalem';
begin
  select * into p from personas;
  v_series := pg_temp.series(p.driver);
  v_total := (select count(*) from pg_temp.occurrences(v_series));
  v_near := (select count(*) from pg_temp.occurrences(v_series) o where (o.details ->> 'departs_at')::timestamptz < v_horizon);
  perform kc_test.act_as_anon();
  perform kc_test.assert_eq(
    (select count(*) from public.list_rides_feed(200) f where f.recurrence ->> 'id' = v_series::text),
    v_near + 1, 'the feed lists the near occurrences one by one and the later ones as one row');
  perform kc_test.assert_eq(
    (select max(f.series_more) from public.list_rides_feed(200) f where f.recurrence ->> 'id' = v_series::text),
    (v_total - v_near - 1)::int, 'the folded row counts the later dates');
  perform kc_test.assert_eq((select count(*) from public.list_ride_series_occurrences(v_series)),
    v_total, 'a guest sees every upcoming date of a public recurring ride');
  perform kc_test.assert_true(
    (select bool_and(o.seats_left = 3) from public.list_ride_series_occurrences(v_series) o),
    'each date carries its free seats');
end $$;

-- 3) A saved-route follower hears about a recurring ride once, not every day.
do $$
declare
  p personas; v_series uuid;
begin
  select * into p from personas;
  perform kc_test.act_as(p.rider);
  insert into public.ride_saved_routes (user_id, origin_place_kind, origin_place_id, origin_label, origin_lat, origin_lng,
                                        dest_place_kind, dest_place_id, dest_label, dest_lat, dest_lng)
  values (p.rider, 'city', '5000', '', 0, 0, 'city', '3000', '', 0, 0);
  v_series := pg_temp.series(p.driver);
  perform kc_test.assert_eq(
    (select count(*) from public.ride_route_alerts a
      where a.user_id = p.rider and a.listing_id in (select listing_id from pg_temp.occurrences(v_series))),
    1::bigint, 'one route alert per follower per series');
  delete from public.ride_saved_routes where user_id = p.rider;
end $$;

-- 4) A request series: its occurrences leave the feed once their day has passed.
do $$
declare
  p personas; v_series uuid; v_first uuid;
begin
  select * into p from personas;
  v_series := pg_temp.series(p.driver, p_kind => 'ride_request', p_direction => 'request',
                             p_extra => jsonb_build_object('passengers', 1));
  select listing_id into v_first from pg_temp.occurrences(v_series) limit 1;
  perform kc_test.assert_eq(
    (select l.expires_at from public.listings l where l.listing_id = v_first),
    (select (l.details ->> 'departs_at')::timestamptz + interval '30 minutes' from public.listings l where l.listing_id = v_first),
    'a request occurrence expires 30 minutes after its departure');
  update public.listings set expires_at = now() - interval '1 minute' where listing_id = v_first;
  update public.posts set expires_at = now() - interval '1 minute' where listing_id = v_first;
  perform kc_test.act_as_anon();
  perform public.ride_series_sweep();
  perform kc_test.assert_eq(kc_test.listing_status(v_first), 'expired', 'the sweep expires a departed request occurrence');
end $$;

-- 5) Pause removes the upcoming occurrences nobody booked; a booked one stays; resume republishes.
do $$
declare
  p personas; c clock; v_series uuid; v_booked uuid; v_before bigint;
begin
  select * into p from personas; select * into c from clock;
  v_series := pg_temp.series(p.driver);
  v_before := (select count(*) from pg_temp.occurrences(v_series));
  select listing_id into v_booked from pg_temp.occurrences(v_series) limit 1;
  perform kc_test.book_ride(p.rider, v_booked, 1);
  perform kc_test.act_as(p.driver);
  perform public.set_ride_series_status(v_series, 'paused');
  perform kc_test.assert_eq((select status from public.ride_series where series_id = v_series), 'paused', 'the series is paused');
  perform kc_test.assert_eq((select count(*) from pg_temp.occurrences(v_series)), 1::bigint,
    'pausing keeps only the booked occurrence');
  perform kc_test.assert_eq(kc_test.listing_status(v_booked), 'open', 'the booked occurrence stays an open ride');
  perform kc_test.assert_eq(public.ride_series_materialize(v_series), 0, 'a paused series does not materialize');
  perform public.set_ride_series_status(v_series, 'active');
  perform kc_test.assert_eq((select count(*) from pg_temp.occurrences(v_series)), v_before,
    'resuming publishes the month again');
end $$;

-- 6) Rescheduling replaces the unbooked occurrences; a booked one keeps its agreed time.
do $$
declare
  p personas; c clock; v_series uuid; v_booked uuid; v_later time;
begin
  select * into p from personas; select * into c from clock;
  v_later := case when c.soon < time '23:00' then c.soon + interval '45 minutes' else c.soon - interval '45 minutes' end;
  v_series := pg_temp.series(p.driver);
  select listing_id into v_booked from pg_temp.occurrences(v_series) limit 1;
  perform kc_test.book_ride(p.rider, v_booked, 1);
  perform kc_test.act_as(p.driver);
  perform public.update_ride_series(v_series, v_later, 127, 90, null);
  perform kc_test.assert_eq(
    (select count(*) from pg_temp.occurrences(v_series) o where o.details -> 'ride_series' ->> 'time' = to_char(v_later, 'HH24:MI')),
    pg_temp.expected_days(127, v_later) - 1, 'the unbooked days are published again at the new time');
  perform kc_test.assert_eq(
    (select o.details -> 'ride_series' ->> 'time' from pg_temp.occurrences(v_series) o where o.listing_id = v_booked),
    to_char(c.soon, 'HH24:MI'), 'the booked occurrence keeps its agreed time');
end $$;

-- 7) Cancel is terminal: unbooked occurrences go, booked ones go on as single rides.
do $$
declare
  p personas; v_series uuid; v_booked uuid;
begin
  select * into p from personas;
  v_series := pg_temp.series(p.driver);
  select listing_id into v_booked from pg_temp.occurrences(v_series) limit 1;
  perform kc_test.book_ride(p.rider, v_booked, 1);
  perform kc_test.act_as(p.driver);
  perform public.set_ride_series_status(v_series, 'cancelled');
  perform kc_test.assert_eq((select count(*) from pg_temp.occurrences(v_series)), 0::bigint,
    'no occurrence carries a cancelled series');
  perform kc_test.assert_eq(kc_test.listing_status(v_booked), 'open', 'the booked ride goes on as a single ride');
  perform kc_test.assert_true(not ((select details from public.listings where listing_id = v_booked) ? 'ride_series'),
    'the booked ride is detached from the series');
  perform kc_test.assert_raises(format('select public.set_ride_series_status(%L, %L)', v_series, 'active'),
    'ride_series_cancelled', 'a cancelled series cannot be resumed');
  perform kc_test.assert_raises(format('select public.update_ride_series(%L, %L, 127)', v_series, '08:00'),
    'ride_series_cancelled', 'a cancelled series cannot be rescheduled');
end $$;

-- 8) Only the owner manages a series; schedules are checked; a series must have an occurrence.
do $$
declare
  p personas; c clock; v_series uuid;
  v_kind uuid := kc_test.listing_kind_id('rides', 'ride_offer');
  v_route jsonb := kc_test.ride_route_tlv_jlm() || jsonb_build_object('seats_available', 3);
begin
  select * into p from personas; select * into c from clock;
  v_series := pg_temp.series(p.driver);
  perform kc_test.act_as(p.rider);
  perform kc_test.assert_raises(format('select public.set_ride_series_status(%L, %L)', v_series, 'paused'),
    'ride_series_not_found', 'another member cannot pause my series');
  perform kc_test.assert_true(
    (select count(*) from public.ride_series where owner_id = p.driver) >= 1
    and not exists (select 1 from public.ride_series where owner_id = p.rider),
    'series rows are owner-scoped');
  perform kc_test.act_as(p.driver);
  perform kc_test.assert_raises(
    format('select public.create_ride_series(%L, %L, %L, %L, %L, 0)', v_kind, 'x', v_route, 'give', c.soon),
    'ride_series_weekdays_invalid', 'at least one weekday is required');
  perform kc_test.assert_raises(
    format('select public.create_ride_series(%L, %L, %L, %L, %L, 127, null, null, %L)', v_kind, 'x', v_route, 'give', c.soon, c.today - 1),
    'ride_series_ends_in_past', 'the end date cannot be in the past');
  perform kc_test.assert_raises(
    format('select public.create_ride_series(%L, %L, %L, %L, %L, %s, null, null, %L)', v_kind, 'x', v_route, 'give', c.soon,
      127 - (1 << extract(dow from c.today)::int), c.today),
    'ride_series_no_occurrence', 'a series that never runs is refused');
  perform kc_test.assert_raises(
    format('select public.create_ride_series(%L, %L, %L, %L, %L, 127)', v_kind, 'x',
      jsonb_build_object('origin_place_kind', 'city', 'origin_place_id', '5000', 'dest_place_kind', 'city', 'dest_place_id', 'nowhere'),
      'give', c.soon),
    'ride_place_invalid', 'an occurrence needs official places like any ride');
  perform kc_test.act_as_anon();
  perform kc_test.assert_true(
    not has_function_privilege('anon', 'public.create_ride_series(uuid, text, jsonb, text, time, int, text, int, date)', 'execute')
    and has_function_privilege('authenticated', 'public.create_ride_series(uuid, text, jsonb, text, time, int, text, int, date)', 'execute')
    and not has_function_privilege('authenticated', 'public.ride_series_materialize(uuid)', 'execute'),
    'members publish series; the materializer is internal');
end $$;

rollback;

\echo '✓ 0531_ride_series.sql passed'
