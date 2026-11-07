-- supabase/tests/0624_g1_ride_writers_on_posts.sql | 0624 (G1 step 6a-4b, ADR-006, D-214): the ride
-- writers write and lock the post — `posts` + `ride_post_details` — and the listing follows.
--   1. a series publishes post-owned occurrences: post + ride details + derived listing, the soonest
--      listed in the main feed and the later ones hidden; materializing again creates nothing;
--   2. an occurrence of the older shape (a listing-sourced listing with a mirror post, as the
--      materializer made them before 0624) sits in the same series: the existence check sees it,
--      the readers moved in 0620 / 0623 list and book both shapes alike;
--   3. pause drops the unbooked occurrences of both shapes (post and listing), keeps the booked
--      ones; resume publishes the month again;
--   4. the series sweep exposes the next occurrence when the soonest leaves, on either shape;
--   5. cancel detaches the booked occurrences of both shapes on both sides;
--   6. the offer expiry sweep and the request-occurrence expiry write the ride's record and the
--      other side follows;
--   7. book / confirm / complete / complete-the-ride on a post-owned and a listing-sourced ride:
--      the same returned rows and error codes, and the close lands on both sides;
--   8. the writers lock the post, not the listing; the new helper is internal; the report agrees.
-- STABLE helpers (post_id_of_listing, listing_id_of_post) are read in a statement after the one
-- that creates the row. Places: Tel Aviv 5000, Jerusalem 3000 (official cities, D71).
-- Runs in a rolled-back transaction.

begin;

-- No platform quiet window during the test.
update public.matching_settings set quiet_start = '00:00', quiet_end = '00:00';

create temp table personas as
select kc_test.create_user('rw_driver') as driver,
       kc_test.create_user('rw_rider_a') as rider_a,
       kc_test.create_user('rw_rider_b') as rider_b,
       kc_test.create_user('rw_rider_c') as rider_c;

create temp table ctx (k text primary key, id uuid not null);

-- ── helpers ───────────────────────────────────────────────────────────────────────────────────

/** A departure time two hours ahead, Israel time (the series time of day). */
create function pg_temp.soon() returns time language sql as $$
  select ((now() + interval '2 hours') at time zone 'Asia/Jerusalem')::time $$;

/** The occurrence posts of a series, soonest first, with their listing id (both shapes). */
create function pg_temp.occurrences(p_series uuid)
returns table (post_id uuid, listing_id uuid, departs_at timestamptz, feed_hidden boolean, status text, owns boolean)
language sql
as $$
  select p.post_id, public.listing_id_of_post(p.post_id), r.departs_at, p.feed_hidden, p.status,
         public.post_owns_listing(p)
    from public.ride_post_details r
    join public.posts p on p.post_id = r.post_id
   where r.series_id = p_series
   order by r.departs_at
$$;

/** The n-th occurrence (0-based) of a series. */
create function pg_temp.nth(p_series uuid, p_n int)
returns uuid
language sql
as $$ select o.post_id from pg_temp.occurrences(p_series) o offset p_n limit 1 $$;

/** A ride offer published through the create RPC (post-owned), departing p_in from now. */
create function pg_temp.post_ride(p_owner uuid, p_seats int, p_in interval)
returns uuid
language plpgsql
as $$
begin
  perform kc_test.act_as(p_owner);
  return public.create_marketplace_listing(
    p_kind_id => kc_test.listing_kind_id('rides', 'ride_offer'),
    p_title   => 'Tel Aviv to Jerusalem',
    p_details => kc_test.ride_route_tlv_jlm()
                 || jsonb_build_object('departs_at', kc_test.iso_in(p_in), 'seats_available', p_seats),
    p_city_id => 'tel-aviv');
end $$;

/** Replaces occurrence p_post of a series by a listing-sourced one for the same day, as the
    materializer published occurrences between 0554 and 0624. Returns the new listing id. */
create function pg_temp.make_old_shape(p_owner uuid, p_post uuid)
returns uuid
language plpgsql
as $$
declare
  v_details jsonb;
  v_listing uuid;
begin
  select details into v_details from public.posts where post_id = p_post;
  delete from public.posts where post_id = p_post; -- its derived listing goes too
  perform kc_test.act_as(p_owner);
  insert into public.listings (
    owner_id, world_slug, kind_id, direction, title, summary, details, origin, moderation_status, expires_at
  ) values (
    p_owner, 'rides', kc_test.listing_kind_id('rides', 'ride_offer'), 'give', 'Tel Aviv to Jerusalem', null,
    v_details, 'native', 'published', (v_details ->> 'departs_at')::timestamptz + interval '30 minutes'
  )
  returning listing_id into v_listing;
  return v_listing;
end $$;

-- ── 1. a series publishes post-owned occurrences ──────────────────────────────────────────────
do $$
declare
  p personas;
  v_series uuid;
  v_first uuid;
  v_n int;
begin
  select * into p from personas;
  perform kc_test.act_as(p.driver);
  select r.series_id, r.first_listing_id into v_series, v_first
    from public.create_ride_series(
      kc_test.listing_kind_id('rides', 'ride_offer'), 'Tel Aviv to Jerusalem',
      kc_test.ride_route_tlv_jlm() || jsonb_build_object('seats_available', 3), 'give',
      pg_temp.soon(), 127, null, 60, (now() at time zone 'Asia/Jerusalem')::date + 5) r;
  insert into ctx values ('series', v_series);

  v_n := (select count(*) from pg_temp.occurrences(v_series));
  perform kc_test.assert_true(v_n >= 5, 'series: the coming days are published');
  perform kc_test.assert_row_count(format('select 1 from pg_temp.occurrences(%L) where owns', v_series), v_n,
    'series: every new occurrence is a post that owns its listing');
  perform kc_test.assert_row_count(format($q$
    select 1 from pg_temp.occurrences(%L) o
      join public.listings l on l.listing_id = o.listing_id
      join public.posts po on po.post_id = o.post_id
      join public.ride_post_details r on r.post_id = o.post_id
     where l.legacy_post_id = o.post_id and l.origin = 'native' and l.status = 'open'
       and l.details -> 'ride_series' ->> 'id' = %1$L
       and r.series_on::text = l.details -> 'ride_series' ->> 'on'
       and po.details = l.details
       and po.expires_at = l.expires_at
       and l.expires_at = r.arrives_at + interval '30 minutes'
       and r.arrives_at = r.departs_at + interval '60 minutes'
       and r.seats_available = 3$q$, v_series), v_n,
    'series: each occurrence has its ride details and a derived listing carrying the marker and the schedule');
  perform kc_test.assert_eq(v_first, (select o.listing_id from pg_temp.occurrences(v_series) o limit 1),
    'series: the RPC hands back the soonest occurrence''s listing');
  perform kc_test.assert_row_count(format('select 1 from pg_temp.occurrences(%L) where not feed_hidden', v_series), 1,
    'series: one occurrence is listed in the main feed');
  perform kc_test.assert_true(not (select o.feed_hidden from pg_temp.occurrences(v_series) o limit 1),
    'series: the listed one is the soonest');
  perform kc_test.assert_eq(public.ride_series_materialize(v_series), 0, 'series: materializing again creates nothing');

  perform kc_test.act_as_anon();
  perform kc_test.assert_row_count(format('select 1 from public.list_ride_series_occurrences(%L)', v_series), v_n,
    'series: a guest sees every date');
end $$;

-- ── 2. an occurrence of the older shape in the same series; bookings on both ──────────────────
do $$
declare
  p personas;
  v_series uuid := (select id from ctx where k = 'series');
  v_new uuid;
  v_old_booked uuid;
  v_old_free uuid;
  h_new public.giving_handoffs;
  h_old public.giving_handoffs;
begin
  select * into p from personas;
  v_old_booked := pg_temp.make_old_shape(p.driver, pg_temp.nth(v_series, 2));
  v_old_free := pg_temp.make_old_shape(p.driver, pg_temp.nth(v_series, 3));
  insert into ctx values ('old_booked', v_old_booked), ('old_free', v_old_free);

  perform kc_test.assert_row_count(format($q$
    select 1 from public.listings l join public.posts po on po.listing_id = l.listing_id
     where l.listing_id in (%L, %L) and l.legacy_post_id is null and not public.post_owns_listing(po)
       and po.feed_hidden$q$, v_old_booked, v_old_free), 2,
    'old shape: a listing-sourced listing with a hidden mirror post');
  perform kc_test.assert_row_count(format('select 1 from pg_temp.occurrences(%L) where not owns', v_series), 2,
    'old shape: its ride details carry the series');
  perform kc_test.assert_eq(public.ride_series_materialize(v_series), 0,
    'old shape: the existence check sees its day on the post side');

  v_new := (select o.listing_id from pg_temp.occurrences(v_series) o offset 1 limit 1);
  insert into ctx values ('new_booked', v_new);
  perform kc_test.act_as(p.rider_a);
  h_new := public.book_ride_seat(v_new, 1);
  h_old := public.book_ride_seat(v_old_booked, 2);
  perform kc_test.assert_eq(h_new.listing_id, v_new, 'both shapes: a booking returns the occurrence''s listing id (new)');
  perform kc_test.assert_eq(h_old.listing_id, v_old_booked, 'both shapes: a booking returns the occurrence''s listing id (old)');
  perform kc_test.assert_eq((select post_id from public.post_handoffs where handoff_id = h_new.handoff_id),
    public.post_id_of_listing(v_new), 'both shapes: the record sits under the post (new)');
  perform kc_test.assert_eq((select post_id from public.post_handoffs where handoff_id = h_old.handoff_id),
    public.post_id_of_listing(v_old_booked), 'both shapes: the record sits under the post (old)');
  perform kc_test.assert_raises(format('select public.book_ride_seat(%L, 1)', v_new), 'already_booked',
    'both shapes: one live booking per passenger');
  perform kc_test.act_as(p.rider_b);
  perform kc_test.assert_raises(format('select public.book_ride_seat(%L, 2)', v_old_booked), 'seats_exhausted',
    'both shapes: seats are counted on the record');

  perform kc_test.act_as(p.driver);
  perform kc_test.assert_eq((public.confirm_ride_booking(h_new.handoff_id)).status, 'confirmed', 'both shapes: confirm (new)');
  perform kc_test.assert_eq((public.confirm_ride_booking(h_old.handoff_id)).status, 'confirmed', 'both shapes: confirm (old)');
  perform kc_test.assert_row_count(format('select 1 from public.list_ride_bookings(%L)', v_new), 1,
    'both shapes: the driver lists the booking (new)');
  perform kc_test.assert_row_count(format('select 1 from public.list_ride_bookings(%L)', v_old_booked), 1,
    'both shapes: the driver lists the booking (old)');
  perform kc_test.assert_true(p.rider_a in (select public.ride_listing_participants(v_new))
    and p.rider_a in (select public.ride_listing_participants(v_old_booked)),
    'both shapes: the confirmed passenger is on the ride');

  perform kc_test.act_as_anon();
  perform kc_test.assert_eq(
    (select o.seats_left from public.list_ride_series_occurrences(v_series) o where o.listing_id = v_new), 2,
    'both shapes: seats left on the new occurrence');
  perform kc_test.assert_eq(
    (select o.seats_left from public.list_ride_series_occurrences(v_series) o where o.listing_id = v_old_booked), 1,
    'both shapes: seats left on the old occurrence');
  perform kc_test.assert_row_count(format(
    'select 1 from public.list_rides_feed(200) f where f.listing_id in (%L, %L)', v_new,
    (select o.listing_id from pg_temp.occurrences(v_series) o limit 1)), 2,
    'both shapes: the rides feed lists today''s and tomorrow''s occurrences');
end $$;

-- ── 3. pause drops the unbooked occurrences of both shapes; resume republishes ────────────────
do $$
declare
  p personas;
  v_series uuid := (select id from ctx where k = 'series');
  v_before int := (select count(*) from pg_temp.occurrences((select id from ctx where k = 'series')));
  v_free_post uuid := public.post_id_of_listing((select id from ctx where k = 'old_free'));
begin
  select * into p from personas;
  perform kc_test.act_as(p.driver);
  perform public.set_ride_series_status(v_series, 'paused');

  perform kc_test.assert_row_count(format('select 1 from pg_temp.occurrences(%L)', v_series), 2,
    'pause: only the two booked occurrences remain');
  perform kc_test.assert_row_count(format('select 1 from pg_temp.occurrences(%L) where listing_id in (%L, %L)',
    v_series, (select id from ctx where k = 'new_booked'), (select id from ctx where k = 'old_booked')), 2,
    'pause: the booked ones of both shapes stay');
  perform kc_test.assert_row_count(format(
    $q$select 1 from public.listings where details -> 'ride_series' ->> 'id' = %L$q$, v_series), 2,
    'pause: the unbooked occurrences'' listings are gone');
  perform kc_test.assert_true(
    not exists (select 1 from public.listings where listing_id = (select id from ctx where k = 'old_free'))
    and not exists (select 1 from public.posts where post_id = v_free_post),
    'pause: an unbooked old-shape occurrence goes with its post');
  perform kc_test.assert_eq(kc_test.listing_status((select id from ctx where k = 'old_booked')), 'open',
    'pause: the booked old-shape occurrence stays an open ride');

  perform public.set_ride_series_status(v_series, 'active');
  perform kc_test.assert_row_count(format('select 1 from pg_temp.occurrences(%L)', v_series), v_before,
    'resume: the dates are published again');
  perform kc_test.assert_row_count(format('select 1 from pg_temp.occurrences(%L) where not owns', v_series), 1,
    'resume: the republished dates are post-owned');
end $$;

-- ── 4. the sweep exposes the next occurrence when the soonest leaves, on either shape ─────────
do $$
declare
  v_series uuid := (select id from ctx where k = 'series');
  v_first uuid := pg_temp.nth((select id from ctx where k = 'series'), 0);
  v_second uuid := pg_temp.nth((select id from ctx where k = 'series'), 1);
begin
  perform kc_test.assert_true((select feed_hidden from public.posts where post_id = v_second),
    'sweep: the second occurrence waits its turn');
  -- The soonest leaves on its post (as the driver's completion closes it); the listing follows.
  update public.posts set status = 'closed_delivered', updated_at = now() where post_id = v_first;
  perform kc_test.assert_eq(kc_test.listing_status(public.listing_id_of_post(v_first)), 'closed',
    'sweep: the derived listing follows its post');
  perform kc_test.act_as_anon();
  perform public.ride_series_sweep();
  perform kc_test.assert_true(not (select feed_hidden from public.posts where post_id = v_second),
    'sweep: the next occurrence (post-owned) is listed');

  -- The next one is the booked old-shape occurrence once the second leaves too.
  update public.posts set status = 'closed_delivered', updated_at = now() where post_id = v_second;
  perform public.ride_series_sweep();
  perform kc_test.assert_true(
    not (select feed_hidden from public.posts where listing_id = (select id from ctx where k = 'old_booked')),
    'sweep: an old-shape occurrence is exposed on its post');
  perform kc_test.assert_row_count(format('select 1 from pg_temp.occurrences(%L) where status = %L and not feed_hidden',
    v_series, 'open'), 1, 'sweep: one open occurrence is listed');
end $$;

-- ── 5. cancel detaches the booked occurrences of both shapes ──────────────────────────────────
do $$
declare
  p personas;
  v_series uuid := (select id from ctx where k = 'series');
  v_old uuid := (select id from ctx where k = 'old_booked');
begin
  select * into p from personas;
  perform kc_test.act_as(p.driver);
  perform public.set_ride_series_status(v_series, 'cancelled');
  perform kc_test.assert_row_count(format('select 1 from pg_temp.occurrences(%L)', v_series), 0,
    'cancel: no ride carries the series on the post side');
  perform kc_test.assert_row_count(format(
    $q$select 1 from public.listings where details -> 'ride_series' ->> 'id' = %L$q$, v_series), 0,
    'cancel: nor on the listing side');
  perform kc_test.assert_true(
    not ((select details from public.listings where listing_id = v_old) ? 'ride_series')
    and not ((select details from public.posts where listing_id = v_old) ? 'ride_series')
    and (select r.series_id from public.ride_post_details r where r.post_id = public.post_id_of_listing(v_old)) is null,
    'cancel: the old-shape booked ride is detached on its listing and its post follows');
  perform kc_test.assert_eq(kc_test.listing_status(v_old), 'open', 'cancel: it goes on as a single ride');
  perform kc_test.assert_raises(format('select public.set_ride_series_status(%L, %L)', v_series, 'active'),
    'ride_series_cancelled', 'cancel: a cancelled series cannot be resumed');
end $$;

-- ── 6. the expiry sweeps write the ride's record ──────────────────────────────────────────────
do $$
declare
  p personas;
  v_post_owned uuid;
  v_listing_sourced uuid;
  v_future uuid;
  v_series uuid;
  v_req uuid;
begin
  select * into p from personas;
  v_post_owned := pg_temp.post_ride(p.driver, 2, interval '2 hours');
  v_listing_sourced := kc_test.create_ride_offer(p.driver, 2, interval '2 hours');
  v_future := pg_temp.post_ride(p.driver, 2, interval '2 hours');
  -- The listing side computes the expiry (0514); it flows to the post on both shapes.
  update public.listings set expires_at = now() - interval '1 minute' where listing_id in (v_post_owned, v_listing_sourced);
  perform kc_test.assert_row_count(format('select 1 from public.posts where listing_id in (%L, %L) and expires_at < now()',
    v_post_owned, v_listing_sourced), 2, 'expiry: the post carries the listing''s expiry');

  perform kc_test.act_as_anon();
  perform kc_test.assert_true(public.rides_expired_listings_sweep() >= 2, 'expiry: the sweep counts the overdue offers');
  perform kc_test.assert_eq((select status from public.posts where listing_id = v_post_owned), 'expired',
    'expiry: a post-owned offer expires on its post');
  perform kc_test.assert_eq(kc_test.listing_status(v_post_owned), 'expired', 'expiry: and its listing follows');
  perform kc_test.assert_eq(kc_test.listing_status(v_listing_sourced), 'expired',
    'expiry: a listing-sourced offer expires on its listing');
  perform kc_test.assert_eq((select status from public.posts where listing_id = v_listing_sourced), 'expired',
    'expiry: and its post follows');
  perform kc_test.assert_eq(kc_test.listing_status(v_future), 'open', 'expiry: a future offer stays open');

  -- A request occurrence whose departure passed expires on its post.
  perform kc_test.act_as(p.rider_c);
  select r.series_id into v_series
    from public.create_ride_series(
      kc_test.listing_kind_id('rides', 'ride_request'), 'Need a ride',
      kc_test.ride_route_tlv_jlm() || jsonb_build_object('passengers', 1), 'request',
      pg_temp.soon(), 127, null, null, (now() at time zone 'Asia/Jerusalem')::date + 2) r;
  v_req := pg_temp.nth(v_series, 0);
  perform kc_test.assert_eq(
    (select l.expires_at - r.departs_at from public.listings l, public.ride_post_details r
      where l.legacy_post_id = v_req and r.post_id = v_req),
    interval '30 minutes', 'expiry: a request occurrence expires 30 minutes after its departure');
  update public.listings set expires_at = now() - interval '1 minute' where legacy_post_id = v_req;
  perform kc_test.act_as_anon();
  perform public.ride_series_sweep();
  perform kc_test.assert_eq((select status from public.posts where post_id = v_req), 'expired',
    'expiry: the series sweep expires the departed request occurrence on its post');
  perform kc_test.assert_eq(kc_test.listing_status(public.listing_id_of_post(v_req)), 'expired',
    'expiry: and its listing follows');
  perform kc_test.assert_row_count(format('select 1 from pg_temp.occurrences(%L) where status = %L', v_series, 'open'),
    (select count(*) from pg_temp.occurrences(v_series)) - 1, 'expiry: the later request occurrences stay open');
end $$;

-- ── 7. booking writers on a post-owned and a listing-sourced ride ─────────────────────────────
do $$
declare
  p personas;
  v_ride uuid;
  v_post uuid;
  v_old uuid;
  v_request uuid;
  h1 public.giving_handoffs;
  h2 public.giving_handoffs;
begin
  select * into p from personas;

  -- Post-owned, two seats, leaving in 30 minutes: book by post id and by listing id.
  v_ride := pg_temp.post_ride(p.driver, 2, interval '30 minutes');
  v_post := public.post_id_of_listing(v_ride);
  perform kc_test.act_as(p.rider_a);
  h1 := public.book_ride_seat(v_post, 1);
  perform kc_test.assert_eq(h1.listing_id, v_ride, 'post-owned: a booking by post id returns the listing id');
  perform kc_test.assert_eq(h1.status, 'reserved', 'post-owned: reserved');
  perform kc_test.assert_eq(h1.confirm_by, least(now() + interval '12 hours',
    (select departs_at from public.ride_post_details where post_id = v_post)), 'post-owned: confirm by the departure');
  perform kc_test.assert_raises(format('select public.book_ride_seat(%L, 1)', v_ride), 'already_booked',
    'post-owned: one live booking per passenger');
  perform kc_test.act_as(p.rider_b);
  h2 := public.book_ride_seat(v_ride, 1);
  perform kc_test.act_as(p.rider_c);
  perform kc_test.assert_raises(format('select public.book_ride_seat(%L, 1)', v_ride), 'seats_exhausted',
    'post-owned: two seats are taken');
  perform kc_test.act_as(p.driver);
  perform kc_test.assert_raises(format('select public.book_ride_seat(%L, 1)', v_ride), 'own_listing',
    'post-owned: the driver does not book their own ride');
  h1 := public.confirm_ride_booking(h1.handoff_id);
  h2 := public.confirm_ride_booking(h2.handoff_id);
  perform kc_test.assert_eq(h2.status, 'confirmed', 'post-owned: confirmed');

  perform kc_test.act_as(p.rider_a);
  h1 := public.complete_ride_trip(h1.handoff_id);
  perform kc_test.assert_eq(h1.status, 'handed_over', 'post-owned: the first trip is completed');
  perform kc_test.assert_eq((select status from public.posts where post_id = v_post), 'open',
    'post-owned: one seat of two ridden keeps the ride open');
  perform kc_test.act_as(p.rider_b);
  h2 := public.complete_ride_trip(h2.handoff_id);
  perform kc_test.assert_eq((select status from public.posts where post_id = v_post), 'closed_delivered',
    'post-owned: every seat ridden closes the ride on its post');
  perform kc_test.assert_eq(kc_test.listing_status(v_ride), 'closed', 'post-owned: and its listing follows');
  perform kc_test.assert_raises(format('select public.book_ride_seat(%L, 1)', v_ride), 'listing_not_available',
    'post-owned: a closed ride takes no booking');

  -- Post-owned: the seats are reduced on the post after the booking (as 0533's flow test does on
  -- the listing); approval rechecks them on the ride's details.
  v_ride := pg_temp.post_ride(p.driver, 2, interval '3 hours');
  perform kc_test.act_as(p.rider_a);
  h1 := public.book_ride_seat(v_ride, 2);
  update public.posts set details = jsonb_set(details, '{seats_available}', '1'::jsonb)
   where post_id = public.post_id_of_listing(v_ride);
  perform kc_test.assert_eq((select seats_available from public.ride_post_details where post_id = public.post_id_of_listing(v_ride)), 1,
    'post-owned: the ride details follow the post');
  perform kc_test.act_as(p.driver);
  perform kc_test.assert_raises(format('select public.confirm_ride_booking(%L)', h1.handoff_id), 'ride_seats_exhausted',
    'post-owned: approval fails when the booking no longer fits');
  perform kc_test.assert_raises(format('select public.complete_ride_listing(%L)', v_ride), 'ride_not_started',
    'post-owned: the ride is not completed hours before departure');

  -- Listing-sourced, three seats, leaving in 30 minutes: the driver completes the whole ride.
  v_old := kc_test.create_ride_offer(p.driver, 3, interval '30 minutes');
  perform kc_test.act_as(p.rider_a);
  h1 := public.book_ride_seat(v_old, 1);
  perform kc_test.assert_eq(h1.listing_id, v_old, 'listing-sourced: a booking returns the listing id');
  perform kc_test.act_as(p.rider_b);
  h2 := public.book_ride_seat(public.post_id_of_listing(v_old), 1);
  perform kc_test.act_as(p.rider_a);
  perform kc_test.assert_raises(format('select public.complete_ride_listing(%L)', v_old), 'owner_only',
    'listing-sourced: only the driver completes the ride');
  perform kc_test.act_as(p.driver);
  perform public.confirm_ride_booking(h1.handoff_id);
  perform kc_test.assert_eq(public.complete_ride_listing(v_old), 1, 'listing-sourced: the confirmed seat rode');
  perform kc_test.assert_eq(kc_test.handoff_status(h1.handoff_id), 'handed_over', 'listing-sourced: handed over');
  perform kc_test.assert_eq(kc_test.handoff_status(h2.handoff_id), 'cancelled', 'listing-sourced: the waiting one is cancelled');
  perform kc_test.assert_eq(kc_test.listing_status(v_old), 'closed', 'listing-sourced: the ride closes on its listing');
  perform kc_test.assert_eq((select status from public.posts where listing_id = v_old), 'closed_delivered',
    'listing-sourced: and its post follows');
  perform kc_test.assert_raises(format('select public.complete_ride_listing(%L)', v_old), 'invalid_status',
    'listing-sourced: a completed ride is not completed again');

  -- The other guards, unchanged.
  v_old := kc_test.create_ride_offer(p.driver, 2, -interval '10 minutes');
  v_ride := pg_temp.post_ride(p.driver, 2, -interval '10 minutes');
  v_request := kc_test.create_listing(p.rider_c, 'rides', 'ride_request', 'request', 'Need a ride',
    kc_test.ride_route_tlv_jlm() || jsonb_build_object('departs_at', kc_test.iso_in(interval '3 hours'), 'passengers', 1));
  perform kc_test.act_as(p.rider_a);
  perform kc_test.assert_raises(format('select public.book_ride_seat(%L, 1)', v_old), 'ride_departed',
    'guards: a departed listing-sourced ride');
  perform kc_test.assert_raises(format('select public.book_ride_seat(%L, 1)', v_ride), 'ride_departed',
    'guards: a departed post-owned ride');
  perform kc_test.assert_raises(format('select public.book_ride_seat(%L, 1)', v_request), 'not_ride_offer',
    'guards: a ride request is not booked');
  perform kc_test.assert_raises(format('select public.book_ride_seat(%L, 1)', gen_random_uuid()), 'listing_not_available',
    'guards: an unknown id');
  perform kc_test.assert_raises(format('select public.confirm_ride_booking(%L)', gen_random_uuid()), 'handoff_not_found',
    'guards: an unknown booking');
end $$;

-- ── 8. the writers lock the post; the helper is internal; the report agrees ───────────────────
do $$
declare
  r jsonb := public.post_unification_report();
begin
  perform kc_test.assert_row_count($q$
    select 1 from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('book_ride_seat', 'confirm_ride_booking', 'complete_ride_trip', 'complete_ride_listing')
       and p.prosrc ~* 'from public\.posts[^;]*for update'
       and p.prosrc !~* 'from public\.listings[^;]*for update'$q$, 4,
    'locks: the four ride writers lock the post, not the listing');
  perform kc_test.assert_row_count($q$
    select 1 from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('ride_series_materialize_day', 'ride_series_drop_unbooked', 'ride_series_sweep',
                         'rides_expired_listings_sweep', 'complete_ride_trip', 'complete_ride_listing')
       and p.prosrc ~* 'update public\.listings\s+set status'$q$, 0,
    'writes: no ride writer sets a listing status itself (ride_post_set_status does, for the older shape)');
  perform kc_test.assert_true(
    not has_function_privilege('authenticated', 'public.ride_post_set_status(public.posts, text)', 'execute')
    and not has_function_privilege('anon', 'public.ride_post_set_status(public.posts, text)', 'execute')
    and has_function_privilege('authenticated', 'public.book_ride_seat(uuid, int, jsonb)', 'execute')
    and has_function_privilege('authenticated', 'public.create_ride_series(uuid, text, jsonb, text, time, int, text, int, date)', 'execute')
    and not has_function_privilege('authenticated', 'public.rides_expired_listings_sweep()', 'execute'),
    'grants: the helper and the sweeps are internal; the RPCs keep their grants');
  perform kc_test.assert_eq((r ->> 'mirror_field_mismatches')::int, 0, 'report: every post agrees with its listing');
  perform kc_test.assert_eq((r ->> 'ride_field_mismatches')::int, 0, 'report: every ride''s details agree');
  perform kc_test.assert_eq((r ->> 'handoff_field_mismatches')::int, 0, 'report: both handoff sides agree');
end $$;

rollback;

\echo '✓ 0624_g1_ride_writers_on_posts.sql passed'
