-- supabase/tests/0556_ride_knowledge_bookings_on_posts.sql | 0556 (G1 step 3b, ADR-006, D19,
-- D-217): the ride and knowledge booking RPCs write post_handoffs as the record and giving_handoffs
-- is derived (same id, same fields); seat and slot capacity is counted on the record; the RPCs
-- and readers accept a post id as well as a listing id; the sweep and the owner completion act on
-- the record; ratings and the generic cancel work on it; the report agrees.

begin;

create temp table personas as
select kc_test.create_user('rb_driver')  as driver,
       kc_test.create_user('rb_pass1')   as pass1,
       kc_test.create_user('rb_pass2')   as pass2,
       kc_test.create_user('rb_pass3')   as pass3,
       kc_test.create_user('rb_mentor')  as mentor,
       kc_test.create_user('rb_learner') as learner,
       kc_test.create_user('rb_late')    as late;

-- Knowledge publishes only for a verified identity (worlds.requires_verification).
update public.users set verified_at = now() where user_id = (select mentor from personas);

/** The post_handoffs record with p_id (fails when there is none). */
create function pg_temp.record_of(p_id uuid)
returns public.post_handoffs
language plpgsql
as $$
declare
  v public.post_handoffs;
begin
  select * into v from public.post_handoffs where handoff_id = p_id;
  if not found then
    perform kc_test.fail('handoff has no post_handoffs record');
  end if;
  return v;
end $$;

/** Both sides of handoff p_id agree on status, seats, cancel reason and timestamps. */
create function pg_temp.assert_both_sides(p_id uuid, p_status text, p_message text)
returns void
language plpgsql
as $$
declare
  r public.post_handoffs := pg_temp.record_of(p_id);
  g public.giving_handoffs;
begin
  select * into g from public.giving_handoffs where handoff_id = p_id;
  if not found then
    perform kc_test.fail(p_message || ': handoff has no derived giving_handoffs row');
  end if;
  perform kc_test.assert_eq(r.status, p_status, p_message || ': record status');
  perform kc_test.assert_eq(g.status, p_status, p_message || ': derived status');
  perform kc_test.assert_eq(g.listing_id, public.listing_id_of_post(r.post_id), p_message || ': derived listing');
  perform kc_test.assert_true(
    (r.recipient_id, r.seats, r.cancel_reason, r.confirmed_at, r.handed_over_at, r.cancelled_at, r.slot_starts_at)
      is not distinct from
    (g.recipient_id, g.seats, g.cancel_reason, g.confirmed_at, g.handed_over_at, g.cancelled_at, g.slot_starts_at),
    p_message || ': both sides carry the same fields');
end $$;

-- ── T1 rides: book by listing id and by post id; capacity and uniqueness on the record ────────
create temp table ride_ctx as select null::uuid as listing, null::uuid as post, null::uuid as h1, null::uuid as h2;
do $$
declare
  p personas;
  v_listing uuid;
  v_post uuid;
  h public.giving_handoffs;
  v_h1 uuid; v_h2 uuid;
begin
  select * into p from personas;
  v_listing := kc_test.create_ride_offer(p.driver, p_seats => 3);
  v_post := public.post_id_of_listing(v_listing);
  perform kc_test.assert_true(v_post is not null, 'the ride offer has its post');

  v_h1 := kc_test.book_ride(p.pass1, v_listing, 1);
  perform kc_test.assert_eq((pg_temp.record_of(v_h1)).post_id, v_post, 'a booking by listing id sits under the post');
  perform pg_temp.assert_both_sides(v_h1, 'reserved', 'after the first booking');

  perform kc_test.act_as(p.pass2);
  h := public.book_ride_seat(v_post, 2);
  v_h2 := h.handoff_id;
  perform kc_test.assert_eq(h.listing_id, v_listing, 'a booking by post id returns the row with its listing id');
  perform kc_test.assert_eq(h.seats, 2, 'and the seats asked for');
  perform pg_temp.assert_both_sides(v_h2, 'reserved', 'after the second booking');

  perform kc_test.assert_raises(format('select public.book_ride_seat(%L, 1)', v_listing),
    'already_booked', 'a passenger holds one live booking per ride');
  perform kc_test.act_as(p.pass3);
  perform kc_test.assert_raises(format('select public.book_ride_seat(%L, 1)', v_post),
    'seats_exhausted', 'three seats are taken on the record');

  update ride_ctx set listing = v_listing, post = v_post, h1 = v_h1, h2 = v_h2;
end $$;

-- ── T2 rides: the driver confirms, declines, lists; a cancel states its side ─────────────────
do $$
declare
  p personas;
  c ride_ctx;
  h public.giving_handoffs;
  v_h3 uuid;
begin
  select * into p from personas;
  select * into c from ride_ctx;

  perform kc_test.act_as(p.driver);
  h := public.confirm_ride_booking(c.h1);
  perform pg_temp.assert_both_sides(c.h1, 'confirmed', 'after the driver confirms');
  perform kc_test.assert_row_count(format('select 1 from public.list_ride_bookings(%L)', c.post), 2,
    'the driver lists the bookings of the ride by post id');
  perform kc_test.assert_row_count(format('select 1 from public.list_ride_bookings(%L)', c.listing), 2,
    'and by listing id');

  h := public.decline_ride_booking(c.h2);
  perform pg_temp.assert_both_sides(c.h2, 'cancelled', 'after the driver declines');
  perform kc_test.assert_eq((pg_temp.record_of(c.h2)).cancel_reason, 'declined', 'a decline says so on the record');

  -- The freed seats can be booked again; the passenger then cancels.
  v_h3 := kc_test.book_ride(p.pass3, c.post, 2);
  perform pg_temp.assert_both_sides(v_h3, 'reserved', 'the freed seats are booked again');
  perform public.cancel_ride_booking(v_h3);
  perform pg_temp.assert_both_sides(v_h3, 'cancelled', 'after the passenger cancels');
  perform kc_test.assert_eq((pg_temp.record_of(v_h3)).cancel_reason, 'passenger_cancelled',
    'the cancelling side is stated on the record');

  perform kc_test.act_as(p.pass1);
  perform kc_test.assert_raises(format('select * from public.list_ride_bookings(%L)', c.post),
    'owner_only', 'a passenger cannot list the ride''s bookings');
end $$;

-- ── T3 rides: the expiry sweep, the trip completion and the owner's completion ───────────────
do $$
declare
  p personas;
  c ride_ctx;
  v_stale uuid;
  v_wait uuid;
  h public.giving_handoffs;
begin
  select * into p from personas;
  select * into c from ride_ctx;

  -- A booking the driver never answered: the sweep expires it on the record.
  v_stale := kc_test.book_ride(p.pass3, c.listing, 1);
  update public.post_handoffs set confirm_by = now() - interval '1 minute' where handoff_id = v_stale;
  perform kc_test.act_as_anon();
  perform kc_test.assert_true(public.ride_bookings_expire_sweep() >= 1, 'the sweep counted the stale booking');
  perform pg_temp.assert_both_sides(v_stale, 'cancelled', 'after the expiry sweep');
  perform kc_test.assert_eq((pg_temp.record_of(v_stale)).cancel_reason, 'expired', 'an expired booking says so');

  -- The first passenger rode: completion on the record, karma once per side (0453).
  perform kc_test.act_as(p.pass1);
  h := public.complete_ride_trip(c.h1);
  perform pg_temp.assert_both_sides(c.h1, 'handed_over', 'after the trip is completed');
  perform kc_test.assert_row_count(
    format('select 1 from public.karma_ledger where ref_type = ''giving_handoff'' and ref_id = %L', c.h1::text),
    2, 'driver and passenger each earned the ride karma once');
  perform kc_test.assert_eq(kc_test.listing_status(c.listing), 'open', 'one seat ridden out of three keeps the ride open');

  -- A waiting booking remains when the driver completes the whole ride by post id.
  v_wait := kc_test.book_ride(p.pass2, c.post, 1);
  perform kc_test.act_as(p.driver);
  perform kc_test.assert_eq(public.complete_ride_listing(c.post), 0, 'no confirmed booking was left to complete');
  perform pg_temp.assert_both_sides(v_wait, 'cancelled', 'a waiting booking is cancelled when the ride completes');
  perform kc_test.assert_eq((pg_temp.record_of(v_wait)).cancel_reason, 'system', 'as the system');
  perform kc_test.assert_eq(kc_test.listing_status(c.listing), 'closed', 'the ride closed');
  perform kc_test.assert_eq((select status from public.posts where post_id = c.post), 'closed_delivered',
    'and the post followed (0554)');
end $$;

-- ── T4 knowledge: book by post id, slots counted on the record, session completed ────────────
do $$
declare
  p personas;
  v_listing uuid;
  v_post uuid;
  h public.giving_handoffs;
begin
  select * into p from personas;
  v_listing := kc_test.create_listing(p.mentor, 'knowledge', 'course', 'give', 'intro to sql',
    jsonb_build_object(
      'topic', 'SQL', 'level', 'beginner', 'modality', 'video', 'slots_available', 1,
      'slot_starts_at', kc_test.iso_in(interval '10 minutes'),
      'slot_ends_at', kc_test.iso_in(interval '2 hours')));
  v_post := public.post_id_of_listing(v_listing);
  perform kc_test.assert_true(v_post is not null, 'the course has its post');

  perform kc_test.act_as(p.learner);
  h := public.book_knowledge_slot(v_post);
  perform kc_test.assert_eq(h.listing_id, v_listing, 'a slot booked by post id returns the row with its listing id');
  perform pg_temp.assert_both_sides(h.handoff_id, 'reserved', 'after the slot is booked');
  perform kc_test.assert_true((pg_temp.record_of(h.handoff_id)).slot_starts_at is not null, 'the slot window is on the record');

  perform kc_test.act_as(p.late);
  perform kc_test.assert_raises(format('select public.book_knowledge_slot(%L)', v_listing),
    'slots_exhausted', 'the one slot is taken on the record');

  perform kc_test.act_as(p.mentor);
  h := public.complete_knowledge_session(h.handoff_id);
  perform pg_temp.assert_both_sides(h.handoff_id, 'handed_over', 'after the session is completed');
  perform kc_test.assert_row_count(
    format('select 1 from public.karma_ledger where ref_type = ''giving_handoff'' and ref_id = %L', h.handoff_id::text),
    2, 'mentor and learner each earned the knowledge karma once');
end $$;

-- ── T5 readers and ratings on the record ────────────────────────────────────────────────────
do $$
declare
  p personas;
  c ride_ctx;
  v_by_post jsonb;
  v_by_listing jsonb;
begin
  select * into p from personas;
  select * into c from ride_ctx;

  perform kc_test.act_as(p.pass1);
  v_by_post := public.get_listing_handoff(c.post);
  v_by_listing := public.get_listing_handoff(c.listing);
  perform kc_test.assert_eq(v_by_post ->> 'handoff_id', c.h1::text, 'the completed, unrated trip is offered for rating by post id');
  perform kc_test.assert_eq(v_by_listing ->> 'handoff_id', c.h1::text, 'and by listing id');
  perform kc_test.assert_eq(v_by_post ->> 'listing_id', c.listing::text, 'the payload keeps the listing id for the app');
  perform kc_test.assert_eq(v_by_post ->> 'post_id', c.post::text, 'and carries the post id');

  perform kc_test.assert_row_count(
    format('select 1 from public.list_my_giving_handoffs() where handoff_id = %L and role = ''recipient'' and title is not null', c.h1),
    1, 'the passenger''s list shows the trip with its title');

  perform public.rate_giving_handoff(c.h1, 5::smallint, 'great ride');
  perform kc_test.assert_true(public.get_listing_handoff(c.post) is null, 'a rated trip is no longer offered for rating');
  perform kc_test.assert_row_count(
    format('select 1 from public.karma_ledger where event_type = ''rating_given'' and ref_id = %L', c.h1::text),
    1, 'rating given earned its karma once (0510)');

  perform kc_test.act_as(p.driver);
  perform kc_test.assert_eq(
    (select rated_by_me from public.list_ride_bookings(c.post) where handoff_id = c.h1), false,
    'the driver has not rated this booking yet');
end $$;

-- ── T6 the generic cancel acts on the record and keeps the housing guard ────────────────────
do $$
declare
  p personas;
  v_listing uuid;
  h uuid;
begin
  select * into p from personas;
  v_listing := kc_test.create_ride_offer(p.driver, p_seats => 2);
  h := kc_test.book_ride(p.pass1, v_listing, 1);
  perform public.cancel_giving_handoff(h);
  perform pg_temp.assert_both_sides(h, 'cancelled', 'a ride booking cancelled through the generic cancel');
  perform kc_test.assert_raises(format('select public.cancel_giving_handoff(%L)', h),
    'handoff_not_found', 'a cancelled booking cannot be cancelled again');
end $$;

-- ── T7 the report agrees on both sides ─────────────────────────────────────────────────────
do $$
declare
  r jsonb := public.post_unification_report();
begin
  perform kc_test.assert_eq((r ->> 'handoff_rows_missing')::int, 0, 'every giving handoff has its record');
  perform kc_test.assert_eq((r ->> 'handoff_field_mismatches')::int, 0, 'and both sides agree');
  perform kc_test.assert_row_count(
    'select 1 from public.post_handoffs t where not exists (select 1 from public.giving_handoffs g where g.handoff_id = t.handoff_id)',
    0, 'no record is without its derived row');
end $$;

rollback;
\echo '✓ 0556_ride_knowledge_bookings_on_posts.sql passed'
