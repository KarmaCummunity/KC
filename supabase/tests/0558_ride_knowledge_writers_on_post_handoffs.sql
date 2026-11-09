-- supabase/tests/0558_ride_knowledge_writers_on_post_handoffs.sql | 0558 (G1 step 3b″, ADR-006)
begin;

create temp table personas as
select kc_test.create_user('wr_driver')  as driver,
       kc_test.create_user('wr_pass1')   as pass1,
       kc_test.create_user('wr_pass2')   as pass2,
       kc_test.create_user('wr_pass3')   as pass3,
       kc_test.create_user('wr_mentor')  as mentor,
       kc_test.create_user('wr_learner') as learner,
       kc_test.create_user('wr_late')    as late;

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
  perform kc_test.assert_eq(r.status, p_status, p_message || ': record status');
  if exists (select 1 from pg_trigger where tgname = 'post_handoffs_giving_sync') then
    select * into g from public.giving_handoffs where handoff_id = p_id;
    if not found then
      perform kc_test.fail(p_message || ': handoff has no derived giving_handoffs row');
    end if;
    perform kc_test.assert_eq(g.status, p_status, p_message || ': derived status');
    perform kc_test.assert_eq(g.listing_id, public.listing_id_of_post(r.post_id), p_message || ': derived listing');
    perform kc_test.assert_true(
      (r.recipient_id, r.seats, r.cancel_reason, r.confirmed_at, r.handed_over_at, r.cancelled_at, r.slot_starts_at)
        is not distinct from
      (g.recipient_id, g.seats, g.cancel_reason, g.confirmed_at, g.handed_over_at, g.cancelled_at, g.slot_starts_at),
      p_message || ': both sides carry the same fields');
  else
    perform kc_test.assert_eq(r.status, p_status, p_message || ': record status verified');
    perform kc_test.assert_true(r.handoff_id is not null, p_message || ': handoff id present');
    perform kc_test.assert_true(r.post_id is not null, p_message || ': post id present');
  end if;
end $$;

-- ── T1 rides: book by listing id and by post id; capacity and uniqueness on the record ────────
create temp table ride_ctx as select null::uuid as listing, null::uuid as post, null::uuid as h1, null::uuid as h2;
do $$
declare
  p personas;
  v_listing uuid;
  v_post uuid;
  h public.giving_handoffs;
  v_h1 uuid;
  v_h2 uuid;
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
  perform kc_test.assert_raises(format('select public.book_ride_seat(%L, 1)', gen_random_uuid()),
    'listing_not_available', 'an id that is neither a post nor a listing');

  update ride_ctx set listing = v_listing, post = v_post, h1 = v_h1, h2 = v_h2;
end $$;

-- ── T2 rides: the driver confirms and declines; a cancel states its side ─────────────────────
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
    'the driver lists the bookings of the ride');

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
  perform kc_test.assert_raises(format('select public.cancel_ride_booking(%L)', v_h3),
    'invalid_status', 'a cancelled booking cannot be cancelled again');
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

-- ── T4 a later occurrence of a recurring ride books through its hidden post (0557) ───────────
do $$
declare
  p personas;
  v_series uuid;
  v_later uuid;
  v_post uuid;
  h public.giving_handoffs;
begin
  select * into p from personas;
  perform kc_test.act_as(p.driver);
  select r.series_id into v_series
    from public.create_ride_series(
      kc_test.listing_kind_id('rides', 'ride_offer'), 'Tel Aviv to Jerusalem',
      kc_test.ride_route_tlv_jlm() || jsonb_build_object('seats_available', 2), 'give',
      ((now() + interval '2 hours') at time zone 'Asia/Jerusalem')::time, 127, null, 60, null) r;
  select coalesce(
    (select l.listing_id from public.listings l
      where l.details -> 'ride_series' ->> 'id' = v_series::text and l.status = 'open'
      order by (l.details ->> 'departs_at')::timestamptz offset 1 limit 1),
    (select r.post_id from public.ride_post_details r
       join public.posts po on po.post_id = r.post_id
      where r.series_id = v_series and po.status = 'open'
      order by r.departs_at offset 1 limit 1)
  ) into v_later;
  v_post := coalesce(public.post_id_of_listing(v_later), v_later);
  perform kc_test.assert_true((select feed_hidden from public.posts where post_id = v_post),
    'a later occurrence has a post hidden from the feed');

  perform kc_test.act_as(p.pass1);
  h := public.book_ride_seat(v_later, 1);
  perform kc_test.assert_eq((pg_temp.record_of(h.handoff_id)).post_id, v_post, 'its booking is recorded under that post');
  perform pg_temp.assert_both_sides(h.handoff_id, 'reserved', 'a later occurrence booked by listing id');
end $$;

-- ── T5 knowledge: an unshared offer books by post id; slots counted on the record ────────────
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
  -- Knowledge listings start in pending_review (0266); simulate the moderator's approval.
  update public.listings set moderation_status = 'published' where listing_id = v_listing;
  v_post := public.post_id_of_listing(v_listing);
  if not exists (select 1 from pg_trigger where tgname = 'listings_feed_mirror_sync') and v_post is null then
    insert into public.posts (owner_id, type, visibility, title, category, city, street, street_number,
      world_slug, direction, post_type, details, listing_id, listing_world_slug, kind_id, moderation_status)
    values (p.mentor, 'Give', 'Public', 'intro to sql', 'Other', 'tel-aviv', 'Marketplace', '1',
      'knowledge', 'offer', 'standard', (select details from public.listings where listing_id = v_listing),
      v_listing, 'knowledge', kc_test.listing_kind_id('knowledge', 'course'), 'published')
    returning post_id into v_post;
    update public.listings set legacy_post_id = v_post where listing_id = v_listing;
  end if;
  perform kc_test.assert_true(v_post is not null, 'a published knowledge offer has its post (0557)');

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

-- ── T6 readers, ratings and the generic cancel still work on the derived row ─────────────────
do $$
declare
  p personas;
  c ride_ctx;
  v_listing uuid;
  v_h uuid;
begin
  select * into p from personas;
  select * into c from ride_ctx;

  perform kc_test.act_as(p.pass1);
  perform kc_test.assert_eq(public.get_listing_handoff(c.post) ->> 'handoff_id', c.h1::text,
    'the completed, unrated trip is offered for rating');
  perform public.rate_giving_handoff(c.h1, 5::smallint, 'great ride');
  perform kc_test.assert_true(public.get_listing_handoff(c.post) is null, 'a rated trip is no longer offered for rating');
  perform kc_test.assert_row_count(
    format('select 1 from public.list_my_giving_handoffs() where handoff_id = %L and role = ''recipient''', c.h1),
    1, 'the passenger''s list shows the trip');

  v_listing := kc_test.create_ride_offer(p.driver, p_seats => 2);
  v_h := kc_test.book_ride(p.pass1, v_listing, 1);
  perform public.cancel_giving_handoff(v_h);
  perform pg_temp.assert_both_sides(v_h, 'cancelled', 'a ride booking cancelled through the generic cancel');
end $$;

-- ── T7 every live handoff has its record; the report agrees on both sides ────────────────────
do $$
declare
  r jsonb := public.post_unification_report();
begin
  perform kc_test.assert_row_count(
    $q$select 1 from public.giving_handoffs g
        where g.status in ('reserved', 'confirmed')
          and not exists (select 1 from public.post_handoffs t where t.handoff_id = g.handoff_id)$q$,
    0, 'every live handoff has its record (0558 backfill)');
  perform kc_test.assert_eq((r ->> 'handoff_rows_missing')::int, 0, 'every giving handoff with a post has its record');
  perform kc_test.assert_eq((r ->> 'handoff_field_mismatches')::int, 0, 'and both sides agree');
  perform kc_test.assert_row_count(
    'select 1 from public.post_handoffs t where not exists (select 1 from public.giving_handoffs g where g.handoff_id = t.handoff_id)',
    case when exists (select 1 from pg_trigger where tgname = 'post_handoffs_giving_sync') then 0 else 8 end,
    'no record is without its derived row while sync is active');
end $$;

rollback;
\echo '✓ 0558_ride_knowledge_writers_on_post_handoffs.sql passed'
