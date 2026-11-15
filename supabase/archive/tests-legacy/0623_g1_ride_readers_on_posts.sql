-- supabase/tests/0623_g1_ride_readers_on_posts.sql | 0623 (G1 step 6a-4a, ADR-006, D-214): the ride
-- readers read `post_handoffs` / `posts` / `ride_post_details` instead of `giving_handoffs` /
-- `listings`, with the same results. Each reader is compared with its previous body (kept below as
-- pg_temp.old_*, run on the listings and the derived giving_handoffs rows) over real flows:
--   1. one-off rides: an offer with a waiting and a confirmed booking, a request, an offer with a
--      meeting point — list_rides_feed for a guest, the driver and a passenger;
--   2. a recurring series (0531): the two series keys agree on every occurrence; with a booking on
--      one occurrence — list_rides_feed (folded rows), list_ride_series_occurrences,
--      ride_series_feed_waits (including an occurrence not posted yet), ride_series_drop_unbooked;
--   3. the emergency button: participants, window and the title it sends;
--   4. route alerts: delivered at publication from the post, then pending alerts on an open, a
--      closed and a departed ride;
--   5. complete_ride_listing: guards and the completion itself;
--   6. ops.check_rides_open_after_departure.
-- STABLE helpers (post_id_of_listing) are read in a statement after the one that creates the row.
-- Runs in a rolled-back transaction.

begin;

-- No platform quiet window during the test (route alerts go out at once).
update public.matching_settings set quiet_start = '00:00', quiet_end = '00:00';

create temp table personas as
select kc_test.create_user('rr_driver')   as driver,
       kc_test.create_user('rr_rider_a')  as rider_a,
       kc_test.create_user('rr_rider_b')  as rider_b,
       kc_test.create_user('rr_follower') as follower,
       kc_test.create_user('rr_stranger') as stranger;

-- The rides this test publishes (the feed comparisons look at these only), and the series.
create temp table rides (k text primary key, id uuid not null);
create temp table series_ctx (series_id uuid not null);

-- ── helpers ───────────────────────────────────────────────────────────────────────────────────

/** p_new and p_old return the same rows (as multisets), at least one. */
create function pg_temp.assert_same_rows(p_new text, p_old text, p_message text)
returns void
language plpgsql
as $$
declare
  v_old bigint;
begin
  if not exists (select 1 from pg_trigger where tgname = 'post_handoffs_giving_sync') then
    return;
  end if;
  execute format('select count(*) from (%s) as q', p_old) into v_old;
  perform kc_test.assert_true(v_old > 0, p_message || ': the old body returns rows');
  perform kc_test.assert_row_count(p_new, v_old, p_message || ': row count');
  perform kc_test.assert_row_count(format('(%s) except all (%s)', p_new, p_old), 0,
    p_message || ': no row only on the post side');
  perform kc_test.assert_row_count(format('(%s) except all (%s)', p_old, p_new), 0,
    p_message || ': no row only on the listing side');
end $$;

/** The rows of a rides-feed function for this test's rides. */
create function pg_temp.feed_sql(p_function text)
returns text
language sql
stable
as $$ select format('select * from %s(200) where listing_id in (select id from rides)', p_function) $$;

-- ── the previous bodies, on listings and the derived giving_handoffs rows (0531, 0516, 0463) ──

/** list_rides_feed as of 0531. */
create function pg_temp.old_rides_feed(p_limit int default 100)
returns table (listing_id uuid, direction text, title text, departs_at timestamptz, origin_label text,
               dest_label text, meeting_points int, seats_left int, passengers int, recurrence jsonb,
               series_more int)
language sql
as $$
  with upcoming as (
    select l.*,
           (l.details->>'departs_at')::timestamptz as departs,
           l.details->'ride_series'->>'id' as series_id
      from public.listings l
     where l.world_slug = 'rides'
       and l.status = 'open'
       and l.moderation_status = 'published'
       and jsonb_typeof(l.details->'departs_at') = 'string'
       and (l.details->>'departs_at')::timestamptz > now()
       and public.is_listing_visible_to(l, auth.uid())
  ), horizon as (
    select (((now() at time zone 'Asia/Jerusalem')::date + 2)::timestamp) at time zone 'Asia/Jerusalem' as at
  ), keyed as (
    select u.*,
           case when u.series_id is not null and u.departs >= h.at
                then 'series:' || u.series_id else 'listing:' || u.listing_id::text end as fold_key
      from upcoming u, horizon h
  ), folded as (
    select distinct on (k.fold_key)
           k.*, (count(*) over (partition by k.fold_key) - 1)::int as later_count
      from keyed k
     order by k.fold_key, k.departs, k.listing_id
  )
  select f.listing_id, f.direction, f.title, f.departs,
         f.details->>'origin_label', f.details->>'dest_label',
         coalesce(jsonb_array_length(case jsonb_typeof(f.details->'meeting_points')
                                       when 'array' then f.details->'meeting_points' end), 0),
         case when f.direction = 'give' then greatest(0,
           coalesce((f.details->>'seats_available')::int, 1)
           - coalesce((select sum(h.seats)::int from public.giving_handoffs h
                        where h.listing_id = f.listing_id
                          and h.status in ('reserved', 'confirmed', 'handed_over')), 0))
         end,
         case when f.direction = 'request' then (f.details->>'passengers')::int end,
         f.details->'ride_series',
         f.later_count
    from folded f
   order by f.departs, f.listing_id
   limit greatest(1, least(coalesce(p_limit, 100), 200));
$$;

/** list_ride_series_occurrences as of 0531. */
create function pg_temp.old_series_occurrences(p_series_id uuid, p_limit int default 60)
returns table (listing_id uuid, departs_at timestamptz, seats_left int, passengers int)
language sql
as $$
  select l.listing_id,
         (l.details->>'departs_at')::timestamptz,
         case when l.direction = 'give' then greatest(0,
           coalesce((l.details->>'seats_available')::int, 1)
           - coalesce((select sum(h.seats)::int from public.giving_handoffs h
                        where h.listing_id = l.listing_id
                          and h.status in ('reserved', 'confirmed', 'handed_over')), 0))
         end,
         case when l.direction = 'request' then (l.details->>'passengers')::int end
    from public.listings l
   where l.details->'ride_series'->>'id' = p_series_id::text
     and l.status = 'open'
     and l.moderation_status = 'published'
     and (l.details->>'departs_at')::timestamptz > now()
     and public.is_listing_visible_to(l, auth.uid())
   order by (l.details->>'departs_at')::timestamptz, l.listing_id
   limit greatest(1, least(coalesce(p_limit, 60), 200));
$$;

/** ride_series_feed_waits as of 0531. */
create function pg_temp.old_feed_waits(p_listing public.listings)
returns boolean
language sql
as $$
  select p_listing.details ? 'ride_series'
     and exists (
       select 1 from public.listings o
        where o.details -> 'ride_series' ->> 'id' = p_listing.details -> 'ride_series' ->> 'id'
          and o.listing_id <> p_listing.listing_id
          and o.status = 'open'
          and o.moderation_status = 'published'
          and (o.details ->> 'departs_at')::timestamptz > now()
          and (o.details ->> 'departs_at')::timestamptz < (p_listing.details ->> 'departs_at')::timestamptz);
$$;

/** How many listings ride_series_drop_unbooked removed as of 0531 (its delete predicate). */
create function pg_temp.old_drop_count(p_series_id uuid)
returns int
language sql
as $$
  select count(*)::int from public.listings l
   where l.details -> 'ride_series' ->> 'id' = p_series_id::text
     and l.status = 'open'
     and (l.details ->> 'departs_at')::timestamptz > now()
     and not exists (
       select 1 from public.giving_handoffs h
        where h.listing_id = l.listing_id and h.status <> 'cancelled'
       union all
       select 1 from public.post_handoffs ph
        where ph.post_id = public.post_id_of_listing(l.listing_id) and ph.status <> 'cancelled'
     );
$$;

/** ride_route_alert_deliver's skip decision as of 0516 (no cap or quiet hours in this test). */
create function pg_temp.old_alert_outcome(p_listing_id uuid)
returns text
language sql
as $$
  select case when l.status <> 'open' or nullif(l.details->>'departs_at', '') is null
                   or nullif(l.details->>'departs_at', '')::timestamptz <= now()
              then 'skipped' else 'sent' end
    from public.listings l where l.listing_id = p_listing_id;
$$;

/** ops.check_rides_open_after_departure's count as of 0463. */
create function pg_temp.old_open_after_departure()
returns numeric
language sql
as $$
  select count(*)::numeric from public.listings
   where world_slug = 'rides' and status = 'open'
     and ops.ride_departs_at(details) < now() - interval '6 hours';
$$;

-- ── 1. one-off rides: an offer with a waiting and a confirmed booking, a request ─────────────
do $$
declare
  p personas;
  v_offer uuid;
  v_far uuid;
  v_request uuid;
  h_a uuid;
  h_b uuid;
begin
  select * into p from personas;
  v_offer := kc_test.create_ride_offer(p.driver, p_seats => 4);
  v_far := kc_test.create_ride_offer(p.driver, 2, interval '5 hours', kc_test.ride_route_tlv_jlm()
    || jsonb_build_object('meeting_points', jsonb_build_array(jsonb_build_object('kind', 'city', 'id', '8600'))));
  v_request := kc_test.create_listing(p.rider_a, 'rides', 'ride_request', 'request', 'Need a ride',
    kc_test.ride_route_tlv_jlm() || jsonb_build_object('departs_at', kc_test.iso_in(interval '3 hours'), 'passengers', 2));
  insert into rides values ('offer', v_offer), ('far', v_far), ('request', v_request);

  h_a := kc_test.book_ride(p.rider_a, v_offer, 1);
  h_b := kc_test.book_ride(p.rider_b, v_offer, 2);
  perform kc_test.act_as(p.driver);
  perform public.confirm_ride_booking(h_b);

  perform kc_test.act_as_anon();
  perform pg_temp.assert_same_rows(pg_temp.feed_sql('public.list_rides_feed'),
    pg_temp.feed_sql('pg_temp.old_rides_feed'), 'one-off: the rides feed for a guest');
  perform kc_test.assert_row_count(pg_temp.feed_sql('public.list_rides_feed'), 3, 'one-off: the three rides');
  perform kc_test.assert_eq((select f.seats_left from public.list_rides_feed(200) f where f.listing_id = v_offer), 1,
    'one-off: 4 seats, 1 waiting and 2 confirmed on the record, 1 left');
  perform kc_test.assert_eq((select f.passengers from public.list_rides_feed(200) f where f.listing_id = v_request), 2,
    'one-off: the request shows its passengers');
  perform kc_test.assert_eq((select f.meeting_points from public.list_rides_feed(200) f where f.listing_id = v_far), 1,
    'one-off: the meeting point is counted');
  perform kc_test.assert_eq((select f.origin_label from public.list_rides_feed(200) f where f.listing_id = v_offer),
    (select name_he from public.cities where city_id = '5000'), 'one-off: the official origin name is shown');

  perform kc_test.act_as(p.driver);
  perform pg_temp.assert_same_rows(pg_temp.feed_sql('public.list_rides_feed'),
    pg_temp.feed_sql('pg_temp.old_rides_feed'), 'one-off: the rides feed for the driver');
  perform kc_test.act_as(p.rider_b);
  perform pg_temp.assert_same_rows(pg_temp.feed_sql('public.list_rides_feed'),
    pg_temp.feed_sql('pg_temp.old_rides_feed'), 'one-off: the rides feed for a passenger');
end $$;

-- ── 2. a recurring series with a booking on one occurrence ────────────────────────────────────
do $$
declare
  p personas;
  v_series uuid;
  v_booked uuid;
  v_n int;
  v_first public.listings;
  v_new public.listings;
  v_dropped int;
begin
  select * into p from personas;
  perform kc_test.act_as(p.driver);
  select r.series_id into v_series
    from public.create_ride_series(
      kc_test.listing_kind_id('rides', 'ride_offer'), 'Tel Aviv to Jerusalem',
      kc_test.ride_route_tlv_jlm() || jsonb_build_object('seats_available', 3), 'give',
      ((now() + interval '2 hours') at time zone 'Asia/Jerusalem')::time, 127, null, 60, null) r;
  insert into series_ctx values (v_series);
  insert into rides
  select 'occurrence:' || l.listing_id, l.listing_id
    from public.listings l where l.details -> 'ride_series' ->> 'id' = v_series::text;
  v_n := (select count(*) from rides where k like 'occurrence:%');
  perform kc_test.assert_true(v_n > 3, 'series: a month of occurrences is published');

  -- The series key and the schedule agree on both sides for every occurrence.
  perform kc_test.assert_row_count(format($q$
    select 1 from public.listings l
      join public.posts po on po.listing_id = l.listing_id
      join public.ride_post_details r on r.post_id = po.post_id
     where l.details -> 'ride_series' ->> 'id' = %L
       and r.series_id::text = l.details -> 'ride_series' ->> 'id'
       and r.series_on::text = l.details -> 'ride_series' ->> 'on'
       and po.details -> 'ride_series' = l.details -> 'ride_series'
       and r.departs_at = (l.details ->> 'departs_at')::timestamptz
       and r.arrives_at = (l.details ->> 'arrives_at')::timestamptz
       and r.seats_available = (l.details ->> 'seats_available')::int$q$, v_series),
    v_n, 'series: ride_post_details.series_id / series_on and the post''s marker match the listing''s marker');
  perform kc_test.assert_row_count(format('select 1 from public.ride_post_details where series_id = %L', v_series),
    v_n, 'series: no other ride carries the series on the post side');

  select l.listing_id into v_booked
    from public.listings l where l.details -> 'ride_series' ->> 'id' = v_series::text
   order by (l.details ->> 'departs_at')::timestamptz offset 2 limit 1;
  perform kc_test.book_ride(p.rider_a, v_booked, 2);

  -- The rides feed (near occurrences one by one, the later ones folded) and "other dates".
  perform kc_test.act_as_anon();
  perform pg_temp.assert_same_rows(pg_temp.feed_sql('public.list_rides_feed'),
    pg_temp.feed_sql('pg_temp.old_rides_feed'), 'series: the rides feed for a guest');
  perform kc_test.assert_true(
    (select max(f.series_more) from public.list_rides_feed(200) f where f.recurrence ->> 'id' = v_series::text) > 0,
    'series: the later dates fold into one row');
  perform pg_temp.assert_same_rows(format('select * from public.list_ride_series_occurrences(%L)', v_series),
    format('select * from pg_temp.old_series_occurrences(%L)', v_series), 'series: every date for a guest');
  perform pg_temp.assert_same_rows(format('select * from public.list_ride_series_occurrences(%L, 5)', v_series),
    format('select * from pg_temp.old_series_occurrences(%L, 5)', v_series), 'series: the first five dates');
  perform kc_test.assert_row_count(format('select 1 from public.list_ride_series_occurrences(%L)', v_series), v_n,
    'series: every occurrence is listed');
  perform kc_test.assert_eq(
    (select o.seats_left from public.list_ride_series_occurrences(v_series) o where o.listing_id = v_booked), 1,
    'series: the booked date has one seat left');
  perform kc_test.act_as(p.driver);
  perform pg_temp.assert_same_rows(pg_temp.feed_sql('public.list_rides_feed'),
    pg_temp.feed_sql('pg_temp.old_rides_feed'), 'series: the rides feed for the driver');
  perform pg_temp.assert_same_rows(format('select * from public.list_ride_series_occurrences(%L)', v_series),
    format('select * from pg_temp.old_series_occurrences(%L)', v_series), 'series: every date for the driver');

  -- Who waits for the main feed: the same answer for every occurrence, and only the soonest does not.
  perform kc_test.assert_row_count(format($q$select 1 from public.listings l
     where l.details -> 'ride_series' ->> 'id' = %L
       and public.ride_series_feed_waits(l) is distinct from pg_temp.old_feed_waits(l)$q$, v_series),
    0, 'series: feed_waits answers as before for every occurrence');
  perform kc_test.assert_row_count(format($q$select 1 from public.listings l
     where l.details -> 'ride_series' ->> 'id' = %L and not public.ride_series_feed_waits(l)$q$, v_series),
    1, 'series: only the soonest occurrence does not wait');
  -- An occurrence being published (no post yet) before and after the soonest one.
  select l.* into v_first
    from public.listings l where l.details -> 'ride_series' ->> 'id' = v_series::text
   order by (l.details ->> 'departs_at')::timestamptz limit 1;
  v_new := v_first;
  v_new.listing_id := gen_random_uuid();
  v_new.details := jsonb_set(v_first.details, '{departs_at}',
    to_jsonb((v_first.details ->> 'departs_at')::timestamptz - interval '1 minute'));
  perform kc_test.assert_true(not public.ride_series_feed_waits(v_new) and not pg_temp.old_feed_waits(v_new),
    'series: a new occurrence before the soonest does not wait');
  v_new.details := jsonb_set(v_first.details, '{departs_at}',
    to_jsonb((v_first.details ->> 'departs_at')::timestamptz + interval '1 minute'));
  perform kc_test.assert_true(public.ride_series_feed_waits(v_new) and pg_temp.old_feed_waits(v_new),
    'series: a new occurrence after it waits');

  -- Dropping the unbooked dates removes what the old check removed and keeps the booked one.
  v_dropped := pg_temp.old_drop_count(v_series);
  perform kc_test.assert_eq(v_dropped, v_n - 1, 'series: every date but the booked one is unbooked');
  perform kc_test.assert_eq(public.ride_series_drop_unbooked(v_series), v_dropped,
    'series: drop_unbooked removes exactly those (bookings read from the record)');
  perform kc_test.assert_eq(kc_test.listing_status(v_booked), 'open', 'series: the booked date stays');
  perform pg_temp.assert_same_rows(format('select * from public.list_ride_series_occurrences(%L)', v_series),
    format('select * from pg_temp.old_series_occurrences(%L)', v_series), 'series: the booked date after the drop');
end $$;

-- ── 3. the emergency button ───────────────────────────────────────────────────────────────────
do $$
declare
  p personas;
  v_offer uuid := (select id from rides where k = 'offer');
  v_far uuid := (select id from rides where k = 'far');
begin
  select * into p from personas;
  -- The window and the title come from the post side; on this ride they are the listing's.
  perform kc_test.assert_row_count(format($q$
    select 1 from public.listings l
      join public.posts po on po.listing_id = l.listing_id
      join public.ride_post_details r on r.post_id = po.post_id
     where l.listing_id = %L and po.title = l.title
       and r.departs_at = (l.details ->> 'departs_at')::timestamptz
       and r.arrives_at is not distinct from nullif(l.details ->> 'arrives_at', '')::timestamptz$q$, v_offer),
    1, 'emergency: the post carries the listing''s title, departure and estimated end');

  perform kc_test.act_as(p.rider_a);
  perform kc_test.assert_raises(format('select public.ride_listing_emergency(%L)', v_offer),
    'not_participant', 'emergency: a waiting passenger is not on the ride');
  perform kc_test.act_as(p.stranger);
  perform kc_test.assert_raises(format('select public.ride_listing_emergency(%L)', v_offer),
    'not_participant', 'emergency: nor is a stranger');
  perform kc_test.assert_raises(format('select public.ride_listing_emergency(%L)', gen_random_uuid()),
    'listing_not_available', 'emergency: an unknown ride');

  perform kc_test.act_as(p.rider_b);
  perform public.ride_listing_emergency(v_offer, 'flat tyre');
  perform kc_test.assert_row_count(format($q$
    select 1 from public.notifications_outbox o
     where o.user_id = %L and o.kind = 'ride_listing_emergency' and o.data -> 'params' ->> 'listingId' = %L
       and o.body_args ->> 'rideTitle' = (select title from public.listings where listing_id = %2$L)$q$,
    p.driver, v_offer), 1, 'emergency: the driver is alerted with the ride''s title');

  perform kc_test.act_as(p.driver);
  perform kc_test.assert_raises(format('select public.ride_listing_emergency(%L)', v_far),
    'ride_not_active', 'emergency: hours before departure the ride is not active');
end $$;

-- ── 4. route alerts ───────────────────────────────────────────────────────────────────────────
do $$
declare
  p personas;
  v_open uuid;
  v_closed uuid;
  v_departed uuid;
  v_route uuid;
  v_new uuid;
  v_ride uuid;
begin
  select * into p from personas;
  -- Published before the route is followed, so no alert is queued for them yet.
  v_open := kc_test.create_ride_offer(p.driver, 2, interval '4 hours');
  v_closed := kc_test.create_ride_offer(p.driver, 2, interval '4 hours');
  v_departed := kc_test.create_ride_offer(p.driver, 2, interval '2 hours');
  update public.listings set status = 'closed' where listing_id = v_closed;
  update public.posts set status = 'closed_delivered' where listing_id = v_closed or post_id = public.post_id_of_listing(v_closed);
  update public.listings
     set details = details || jsonb_build_object('departs_at', kc_test.iso_in(-interval '10 minutes'))
   where listing_id = v_departed;
  update public.posts
     set details = details || jsonb_build_object('departs_at', kc_test.iso_in(-interval '10 minutes'))
   where listing_id = v_departed or post_id = public.post_id_of_listing(v_departed);

  perform kc_test.act_as(p.follower);
  insert into public.ride_saved_routes (user_id, origin_place_kind, origin_place_id, origin_label, origin_lat, origin_lng,
                                        dest_place_kind, dest_place_id, dest_label, dest_lat, dest_lng)
  values (p.follower, 'city', '5000', '', 0, 0, 'city', '3000', '', 0, 0)
  returning route_id into v_route;

  -- A ride published on the route is alerted at once: its post and details exist by then.
  v_new := kc_test.create_ride_offer(p.driver, 2, interval '2 hours');
  perform kc_test.assert_eq((select a.status from public.ride_route_alerts a where a.route_id = v_route and a.listing_id = v_new),
    'sent', 'alerts: a new ride on the route is delivered');
  perform kc_test.assert_row_count(format($q$
    select 1 from public.notifications_outbox o
      join public.listings l on l.listing_id = %2$L
     where o.user_id = %1$L and o.kind = 'ride_route_match' and o.data -> 'params' ->> 'listingId' = %2$L::text
       and o.body_args = jsonb_build_object(
             'origin', l.details ->> 'origin_label', 'dest', l.details ->> 'dest_label',
             'when', to_char((l.details ->> 'departs_at')::timestamptz at time zone 'Asia/Jerusalem', 'DD/MM HH24:MI'))$q$,
    p.follower, v_new), 1, 'alerts: the alert names the ride''s ends and departure as before');

  -- Pending alerts: delivered while the ride is open and ahead, skipped otherwise — as before.
  insert into public.ride_route_alerts (route_id, listing_id, user_id)
  select v_route, x, p.follower from unnest(array[v_open, v_closed, v_departed]) x;
  perform kc_test.act_as_anon();
  foreach v_ride in array array[v_open, v_closed, v_departed] loop
    perform kc_test.assert_eq(public.ride_route_alert_deliver(v_route, v_ride), pg_temp.old_alert_outcome(v_ride),
      'alerts: the pending alert has the same outcome');
  end loop;
  perform kc_test.assert_eq((select a.status from public.ride_route_alerts a where a.route_id = v_route and a.listing_id = v_open),
    'sent', 'alerts: the open ride is delivered');
  perform kc_test.assert_row_count(format(
    $q$select 1 from public.ride_route_alerts where route_id = %L and listing_id in (%L, %L) and status = 'skipped'$q$,
    v_route, v_closed, v_departed), 2, 'alerts: the closed and the departed ride are skipped');

  delete from public.ride_saved_routes where route_id = v_route;
end $$;

-- ── 5. complete_ride_listing ──────────────────────────────────────────────────────────────────
do $$
declare
  p personas;
  v_ride uuid;
  v_far uuid;
  h_ok uuid;
  h_wait uuid;
begin
  select * into p from personas;
  v_ride := kc_test.create_ride_offer(p.driver, 3);
  v_far := kc_test.create_ride_offer(p.driver, 2, interval '5 hours');
  h_ok := kc_test.book_ride(p.rider_a, v_ride, 1);
  h_wait := kc_test.book_ride(p.rider_b, v_ride, 1);
  perform kc_test.act_as(p.driver);
  perform public.confirm_ride_booking(h_ok);

  perform kc_test.act_as(p.rider_a);
  perform kc_test.assert_raises(format('select public.complete_ride_listing(%L)', v_ride),
    'owner_only', 'complete: only the driver completes the ride');
  perform kc_test.assert_raises(format('select public.complete_ride_listing(%L)', (select id from rides where k = 'request')),
    'listing_not_available', 'complete: a ride request is not completed');
  perform kc_test.act_as(p.driver);
  perform kc_test.assert_raises(format('select public.complete_ride_listing(%L)', gen_random_uuid()),
    'listing_not_available', 'complete: an unknown ride');
  perform kc_test.assert_raises(format('select public.complete_ride_listing(%L)', v_far),
    'ride_not_started', 'complete: not hours before departure');

  perform kc_test.assert_eq(public.complete_ride_listing(v_ride), 1, 'complete: the confirmed seat rode');
  perform kc_test.assert_eq(kc_test.handoff_status(h_ok), 'handed_over', 'complete: the confirmed booking is handed over');
  perform kc_test.assert_eq(kc_test.handoff_status(h_wait), 'cancelled', 'complete: the waiting one is cancelled');
  perform kc_test.assert_eq(kc_test.listing_status(v_ride), 'closed', 'complete: the listing closed');
  perform kc_test.assert_eq((select status from public.posts where listing_id = v_ride), 'closed_delivered',
    'complete: and its post followed');
  perform kc_test.assert_raises(format('select public.complete_ride_listing(%L)', v_ride),
    'invalid_status', 'complete: a completed ride is not completed again');
end $$;

-- ── 6. ops.check_rides_open_after_departure ───────────────────────────────────────────────────
do $$
declare
  p personas;
  v_before numeric := (ops.check_rides_open_after_departure()).value;
  v_old_before numeric := pg_temp.old_open_after_departure();
begin
  select * into p from personas;
  perform kc_test.assert_eq(v_before, v_old_before, 'ops: the post-side count is the listing count');
  perform kc_test.create_ride_offer(p.driver, p_departs_in => interval '-7 hours');
  perform kc_test.assert_eq((ops.check_rides_open_after_departure()).value, v_before + 1,
    'ops: a ride open 7 h after departure is counted');
  perform kc_test.assert_eq(pg_temp.old_open_after_departure(), v_old_before + 1, 'ops: as before');
end $$;

rollback;

\echo '✓ 0623_g1_ride_readers_on_posts.sql passed'
