-- supabase/tests/0701_knowledge_slot_bookings.sql | 0701 (#2034, FR-KNOW-004 AC2, AC3, AC5): booking
-- a seat on a knowledge slot — guards, the last seat, the compatibility entry point, the giver's
-- answers, expiry of an unanswered booking, completion karma with the daily cap, pushes.

begin;

create temp table personas as
select kc_test.create_knowledge_member('kb_giver') as giver,
       kc_test.create_knowledge_member('kb_learner') as learner,
       kc_test.create_knowledge_member('kb_learner2') as learner2,
       kc_test.create_knowledge_member('kb_learner3') as learner3;

-- Pushes of a kind to a member about one booking.
create function pg_temp.pushed(p_user uuid, p_kind text, p_handoff uuid)
returns bigint language sql as $$
  select count(*) from public.notifications
   where user_id = p_user and kind = p_kind and dedupe_key like p_kind || ':' || p_handoff::text || ':%';
$$;

-- ── Booking guards and the last seat ──────────────────────────────────────────────────────────
do $$
declare
  p personas;
  v_post uuid;
  v_slot uuid;
  v_h uuid;
  v_row public.giving_handoffs;
begin
  select * into p from personas;
  v_post := kc_test.create_lesson_offer(p.giver, 1, interval '1 day', interval '2 days');
  v_slot := kc_test.knowledge_slot(v_post, 1);

  perform kc_test.act_as(p.giver);
  perform kc_test.assert_raises(format('select public.book_knowledge_seat(%L)', v_slot),
    'own_listing', 'the giver cannot book their own lesson');

  v_h := kc_test.book_knowledge_seat(p.learner, v_slot);
  select * into v_row from public.giving_handoffs where handoff_id = v_h;
  perform kc_test.assert_eq(v_row.status, 'reserved'::text, 'a booking waits for the giver');
  perform kc_test.assert_true(v_row.confirm_by <= v_row.slot_starts_at, 'and must be answered before the session starts');
  perform kc_test.assert_eq(pg_temp.pushed(p.giver, 'knowledge_booking_requested', v_h), 1::bigint,
    'the giver is told about the request');

  perform kc_test.assert_raises(format('select public.book_knowledge_seat(%L)', v_slot),
    'already_booked', 'one active booking per learner and slot');
  perform kc_test.act_as(p.learner2);
  perform kc_test.assert_raises(format('select public.book_knowledge_seat(%L)', v_slot),
    'slots_exhausted', 'no seat is left on a full slot');
  perform kc_test.assert_eq(
    (select string_agg(seats_left::text, ',' order by starts_at) from public.list_knowledge_slots(v_post)),
    '0,1'::text, 'the slot list shows the seats left');

  -- A build released before slots books the post: it gets the soonest slot with a seat.
  perform kc_test.assert_eq(
    (select slot_starts_at from public.book_knowledge_slot(v_post)),
    (select starts_at from public.knowledge_slots where slot_id = kc_test.knowledge_slot(v_post, 2)),
    'the compatibility entry point books the next free slot');

  -- A started slot cannot be booked.
  update public.knowledge_slots set starts_at = now() - interval '5 minutes', ends_at = now() + interval '55 minutes'
   where slot_id = kc_test.knowledge_slot(v_post, 2);
  perform kc_test.act_as(p.learner3);
  perform kc_test.assert_raises(
    format('select public.book_knowledge_seat(%L)', (select slot_id from public.knowledge_slots
                                                      where post_id = v_post and starts_at < now())),
    'slot_started', 'a session that started cannot be booked');
end $$;

-- ── The giver answers; an unanswered booking expires ──────────────────────────────────────────
do $$
declare
  p personas;
  v_post uuid;
  v_a uuid;
  v_b uuid;
  v_c uuid;
begin
  select * into p from personas;
  v_post := kc_test.create_lesson_offer(p.giver, 3, interval '3 days');
  v_a := kc_test.book_knowledge_seat(p.learner, kc_test.knowledge_slot(v_post));
  v_b := kc_test.book_knowledge_seat(p.learner2, kc_test.knowledge_slot(v_post));
  v_c := kc_test.book_knowledge_seat(p.learner3, kc_test.knowledge_slot(v_post));

  perform kc_test.act_as(p.learner);
  perform kc_test.assert_raises(format('select public.confirm_knowledge_booking(%L)', v_a),
    'not_owner', 'only the giver confirms');

  perform kc_test.act_as(p.giver);
  perform kc_test.assert_eq((public.confirm_knowledge_booking(v_a)).status, 'confirmed'::text, 'the giver confirms');
  perform kc_test.assert_eq(pg_temp.pushed(p.learner, 'knowledge_booking_confirmed', v_a), 1::bigint,
    'the learner is told');
  perform kc_test.assert_raises(format('select public.decline_knowledge_booking(%L)', v_a),
    'invalid_status', 'a confirmed booking is not declined (it is cancelled)');

  perform kc_test.assert_eq(
    (select cancel_reason from public.decline_knowledge_booking(v_b)), 'declined'::text, 'the giver declines');
  perform kc_test.assert_eq(pg_temp.pushed(p.learner2, 'knowledge_booking_declined', v_b), 1::bigint,
    'the learner is told it was declined');
  perform kc_test.assert_eq((select count(*)::int from public.list_knowledge_bookings(v_post)), 3,
    'the giver sees every booking of the post');

  perform kc_test.act_as(p.learner);
  perform kc_test.assert_raises(format('select * from public.list_knowledge_bookings(%L)', v_post),
    'not_owner', 'a learner does not see the other bookings');

  -- Unanswered for 24 hours: the sweep expires it and frees the seat.
  update public.post_handoffs set confirm_by = now() - interval '1 minute' where handoff_id = v_c;
  perform kc_test.act_as_anon();
  perform kc_test.assert_true(public.knowledge_bookings_expire_sweep() >= 1, 'the sweep expires it');
  perform kc_test.assert_eq(kc_test.handoff_status(v_c), 'cancelled'::text, 'the booking is cancelled');
  perform kc_test.assert_eq((select cancel_reason from public.post_handoffs where handoff_id = v_c),
    'expired'::text, 'as expired');
  perform kc_test.assert_eq(pg_temp.pushed(p.learner3, 'knowledge_booking_expired', v_c), 1::bigint,
    'the learner is told it expired');
  perform kc_test.assert_eq(public.knowledge_slot_seats_taken(kc_test.knowledge_slot(v_post)), 1,
    'only the confirmed seat is still held');
end $$;

-- ── Completion and karma ──────────────────────────────────────────────────────────────────────
do $$
declare
  p personas;
  v_post uuid;
  v_h uuid;
  v_before_giver int;
  v_before_learner int;
begin
  select * into p from personas;
  v_post := kc_test.create_lesson_offer(p.giver, 1, interval '1 day');
  v_h := kc_test.book_knowledge_seat(p.learner, kc_test.knowledge_slot(v_post));
  perform kc_test.act_as(p.learner);
  perform kc_test.assert_raises(format('select public.complete_knowledge_session(%L)', v_h),
    'session_not_started', 'a session cannot be completed a day ahead');

  -- The session took 90 minutes and is over.
  update public.post_handoffs
     set slot_starts_at = now() - interval '2 hours', slot_ends_at = now() - interval '30 minutes'
   where handoff_id = v_h;
  select karma_points into v_before_giver from public.users where user_id = p.giver;
  select karma_points into v_before_learner from public.users where user_id = p.learner;
  perform public.complete_knowledge_session(v_h);
  perform kc_test.assert_eq(kc_test.handoff_status(v_h), 'handed_over'::text, 'the session is completed');
  perform kc_test.assert_eq((select karma_points from public.users where user_id = p.giver) - v_before_giver, 15,
    'the giver earns 5 per started half hour (3 × 5)');
  perform kc_test.assert_eq((select karma_points from public.users where user_id = p.learner) - v_before_learner, 5,
    'the learner earns 5');
  perform kc_test.assert_raises(format('select public.complete_knowledge_session(%L)', v_h),
    'invalid_status', 'a session is completed once');

  -- Daily cap (D32): 15 earned above plus 60 more on another knowledge booking today leaves 5,
  -- so a two-hour session (four half hours, 20 points) is cut to one half hour (5 points).
  v_h := kc_test.book_knowledge_seat(p.learner2, kc_test.knowledge_slot(kc_test.create_lesson_offer(p.giver, 1, interval '2 days')));
  insert into public.karma_ledger (user_id, event_type, points_delta, ref_type, ref_id)
  values (p.giver, 'giving_handoff_giver', 60, 'giving_handoff', v_h::text);
  perform kc_test.assert_eq(
    public.knowledge_session_giver_units(p.giver, now() - interval '3 hours', now() - interval '1 hour'), 1,
    'the giver earns at most 80 a day from knowledge sessions');
end $$;

-- ── Privileges ────────────────────────────────────────────────────────────────────────────────
select kc_test.assert_true(not has_function_privilege('anon', 'public.book_knowledge_seat(uuid)', 'execute'),
  'guests cannot book');
select kc_test.assert_true(has_function_privilege('authenticated', 'public.list_knowledge_slots(uuid)', 'execute'),
  'members list slots');
select kc_test.assert_true(not has_function_privilege('authenticated', 'public.knowledge_bookings_expire_sweep()', 'execute'),
  'the sweeps are internal');

rollback;
\echo '✓ 0701_knowledge_slot_bookings.sql passed'
