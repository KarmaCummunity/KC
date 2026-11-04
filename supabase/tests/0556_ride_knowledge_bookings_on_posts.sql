-- supabase/tests/0556_ride_knowledge_bookings_on_posts.sql | 0556 (G1 step 3b, ADR-006, D19,
-- D-217): the ride and knowledge booking RPCs and the handoff readers accept a post id as well as a
-- listing id, with the same rows, rules and error codes; a listing that has no post yet (a
-- knowledge offer before its owner shares it, a later occurrence of a recurring ride) keeps
-- booking by listing id and gets its record copy the moment its post appears.

begin;

create temp table personas as
select kc_test.create_user('pb_driver')  as driver,
       kc_test.create_user('pb_pass1')   as pass1,
       kc_test.create_user('pb_pass2')   as pass2,
       kc_test.create_user('pb_pass3')   as pass3,
       kc_test.create_user('pb_mentor')  as mentor,
       kc_test.create_user('pb_learner') as learner;

-- Knowledge publishes only for a verified identity (worlds.requires_verification).
update public.users set verified_at = now() where user_id = (select mentor from personas);

-- ── T1 rides: book by post id and by listing id; the driver lists and completes by post id ───
do $$
declare
  p personas;
  v_listing uuid;
  v_post uuid;
  h public.giving_handoffs;
  v_h1 uuid;
begin
  select * into p from personas;
  v_listing := kc_test.create_ride_offer(p.driver, p_seats => 3);
  v_post := public.post_id_of_listing(v_listing);
  perform kc_test.assert_true(v_post is not null, 'the ride offer has its post');

  perform kc_test.act_as(p.pass1);
  h := public.book_ride_seat(v_post, 1);
  v_h1 := h.handoff_id;
  perform kc_test.assert_eq(h.listing_id, v_listing, 'a booking by post id lands on the ride''s listing');
  perform kc_test.assert_eq(h.status, 'reserved', 'and waits for the driver');
  perform kc_test.assert_eq((select post_id from public.post_handoffs where handoff_id = v_h1), v_post,
    'its copy sits under the post (0553)');
  perform kc_test.assert_raises(format('select public.book_ride_seat(%L, 1)', v_listing),
    'already_booked', 'the same passenger by listing id is the same booking');

  perform kc_test.act_as(p.pass2);
  h := public.book_ride_seat(v_listing, 2);
  perform kc_test.act_as(p.pass3);
  perform kc_test.assert_raises(format('select public.book_ride_seat(%L, 1)', v_post),
    'seats_exhausted', 'capacity is one picture whichever id is used');
  perform kc_test.assert_raises(format('select public.book_ride_seat(%L, 1)', gen_random_uuid()),
    'listing_not_available', 'an id that is neither a post nor a listing');

  perform kc_test.act_as(p.driver);
  perform kc_test.assert_row_count(format('select 1 from public.list_ride_bookings(%L)', v_post), 2,
    'the driver lists the bookings by post id');
  perform kc_test.assert_row_count(format('select 1 from public.list_ride_bookings(%L)', v_listing), 2,
    'and by listing id');
  perform public.confirm_ride_booking(v_h1);

  perform kc_test.act_as(p.pass1);
  perform kc_test.assert_eq(public.get_listing_handoff(v_post) ->> 'handoff_id', v_h1::text,
    'the passenger''s live booking is found by post id');
  perform kc_test.assert_eq(public.get_listing_handoff(v_post) ->> 'post_id', v_post::text,
    'and the payload carries the post id');
  perform kc_test.assert_eq(public.get_listing_handoff(v_listing) ->> 'listing_id', v_listing::text,
    'while listing_id stays for the app');

  perform kc_test.act_as(p.driver);
  perform kc_test.assert_eq(public.complete_ride_listing(v_post), 1, 'the driver completes the ride by post id');
  perform kc_test.assert_eq(kc_test.handoff_status(v_h1), 'handed_over', 'the confirmed booking rode');
  perform kc_test.assert_eq((select status from public.post_handoffs where handoff_id = v_h1), 'handed_over',
    'and so says its copy');
  perform kc_test.assert_eq(kc_test.listing_status(v_listing), 'closed', 'the ride closed');
  perform kc_test.assert_eq((select status from public.posts where post_id = v_post), 'closed_delivered',
    'and the post followed (0554)');
end $$;

-- ── T2 knowledge: a published offer books by post id; its booking is found by either id ─────
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
      'topic', 'SQL', 'level', 'beginner', 'modality', 'video', 'slots_available', 2,
      'slot_starts_at', kc_test.iso_in(interval '10 minutes'),
      'slot_ends_at', kc_test.iso_in(interval '2 hours')));
  -- Knowledge listings start in pending_review (0266); simulate the moderator's approval.
  update public.listings set moderation_status = 'published' where listing_id = v_listing;
  v_post := public.post_id_of_listing(v_listing);
  perform kc_test.assert_true(v_post is not null, 'a published knowledge offer has its post (0557)');

  perform kc_test.act_as(p.learner);
  h := public.book_knowledge_slot(v_post);
  perform kc_test.assert_eq(h.listing_id, v_listing, 'a slot booked by post id lands on the offer''s listing');
  perform kc_test.assert_eq(h.status, 'reserved', 'and waits like any booking');
  perform kc_test.assert_eq((select post_id from public.post_handoffs where handoff_id = h.handoff_id), v_post,
    'the booking''s copy sits under the post (0553)');

  perform kc_test.assert_eq(public.get_listing_handoff(v_post) ->> 'handoff_id', h.handoff_id::text,
    'the learner''s booking is found by post id');
  perform kc_test.assert_eq(public.get_listing_handoff(v_listing) ->> 'handoff_id', h.handoff_id::text,
    'and by listing id');
  perform kc_test.assert_raises(format('select public.book_knowledge_slot(%L)', v_listing),
    'already_booked', 'booking again by listing id is the same slot');

  h := public.complete_knowledge_session(h.handoff_id);
  perform kc_test.assert_eq(h.status, 'handed_over', 'the session completes as before');
  perform kc_test.assert_eq((select status from public.post_handoffs where handoff_id = h.handoff_id), 'handed_over',
    'and its copy follows');
end $$;

-- ── T3 the report agrees on both sides ─────────────────────────────────────────────────────
do $$
declare
  r jsonb := public.post_unification_report();
begin
  perform kc_test.assert_eq((r ->> 'handoff_rows_missing')::int, 0, 'every handoff with a post has its copy');
  perform kc_test.assert_eq((r ->> 'handoff_field_mismatches')::int, 0, 'and both sides agree');
end $$;

rollback;
\echo '✓ 0556_ride_knowledge_bookings_on_posts.sql passed'
