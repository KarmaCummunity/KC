-- supabase/tests/0622_g1_writer_returns_from_post_handoffs.sql | 0622 (G1 step 6a-3b, ADR-006,
-- D-214): the handoff writer RPCs build the giving_handoffs row they return from post_handoffs.
--   0. giving_handoff_row_of is internal (service_role only) and no writer body reads
--      giving_handoffs any more;
--   1. items: reserve, confirm, hand over;
--   2. food: claim, hand over; delete_my_listing still refuses a listing with a handed-over handoff;
--   3. rides: book, confirm, decline, book again, cancel, complete;
--   4. knowledge: book a slot, complete the session;
--   5. housing: request, approve, decline, cancel, complete, no-show;
--   6. time: the helper returns null for an event registration (no derived row) and an unknown id.
-- After each call the returned row equals the record column by column (listing_id =
-- listing_id_of_post(post_id) in place of post_id) and equals the derived giving_handoffs row, so
-- the app sees the same output as before. STABLE helpers are read in a statement after the write.
-- Runs in a rolled-back transaction.

begin;

create temp table personas as
select kc_test.create_user('wr_giver')            as giver,
       kc_test.create_user('wr_taker')            as taker,
       kc_test.create_user('wr_driver')           as driver,
       kc_test.create_user('wr_rider')            as rider,
       kc_test.create_user('wr_rider2')           as rider2,
       kc_test.create_user('wr_mentor')           as mentor,
       kc_test.create_user('wr_learner')          as learner,
       kc_test.create_housing_member('wr_host')   as host,
       kc_test.create_housing_member('wr_guest')  as guest,
       kc_test.create_housing_member('wr_guest2') as guest2,
       kc_test.create_user('wr_organizer')        as organizer,
       kc_test.create_user('wr_attendee')         as attendee,
       gen_random_uuid()                          as org_id;

-- Knowledge publishes only for a verified identity (worlds.requires_verification), as in 0556 / 0558.
update public.users set verified_at = now() where user_id = (select mentor from personas);

-- ── helpers ───────────────────────────────────────────────────────────────────────────────────

/**
 * The row a writer returned (p_row) is the record of its handoff in the giving_handoffs shape:
 * status p_status, the listing of the record's post, every other column equal to the record's,
 * and the whole row equal to the derived giving_handoffs row.
 */
create function pg_temp.assert_returned(p_row public.giving_handoffs, p_status text, p_message text)
returns void
language plpgsql
as $$
declare
  r public.post_handoffs;
  g public.giving_handoffs;
begin
  if p_row.handoff_id is null then
    perform kc_test.fail(p_message || ': the RPC returned no row');
  end if;
  select * into r from public.post_handoffs where handoff_id = p_row.handoff_id;
  if not found then
    perform kc_test.fail(p_message || ': the handoff has no post_handoffs record');
  end if;
  perform kc_test.assert_eq(p_row.status, p_status, p_message || ': status');
  perform kc_test.assert_eq(r.status, p_status, p_message || ': the record''s status');
  perform kc_test.assert_true(p_row.listing_id is not null, p_message || ': a listing id');
  perform kc_test.assert_eq(p_row.listing_id, public.listing_id_of_post(r.post_id),
    p_message || ': the listing of the record''s post');
  -- requested_meeting_point (0649) and knowledge_slot_id (0700) live on the record only;
  -- giving_handoffs has no such columns.
  perform kc_test.assert_eq(to_jsonb(p_row) - 'listing_id',
    to_jsonb(r) - 'post_id' - 'requested_meeting_point' - 'knowledge_slot_id',
    p_message || ': every other column is the record''s (ids, seats, timestamps, reason)');

  if exists (select 1 from pg_trigger where tgname = 'post_handoffs_giving_sync') then
    select * into g from public.giving_handoffs where handoff_id = p_row.handoff_id;
    if not found then
      perform kc_test.fail(p_message || ': the handoff has no derived giving_handoffs row');
    end if;
    perform kc_test.assert_eq(to_jsonb(p_row), to_jsonb(g), p_message || ': the same row as the derived copy');
  end if;
end $$;

/** An open item offer by p_owner through the app's RPC; returns its listing id. */
create function pg_temp.item_offer(p_owner uuid, p_title text)
returns uuid
language plpgsql
as $$
begin
  perform kc_test.act_as(p_owner);
  return public.create_marketplace_listing(
    p_kind_id => kc_test.listing_kind_id('items', 'give_item'), p_title => p_title,
    p_details => '{"item_condition":"Good","fulfillment_mode":"owner_approval"}'::jsonb,
    p_city_id => 'tel-aviv');
end $$;

/** Publishes an automatic-registration event as p_owner for p_org (as the create form does). */
create function pg_temp.publish_event(p_owner uuid, p_org uuid)
returns uuid
language plpgsql
as $$
begin
  perform kc_test.act_as(p_owner);
  return public.create_marketplace_listing(
    p_kind_id => kc_test.listing_kind_id('time', 'org_event'), p_title => 'beach cleanup',
    p_details => jsonb_build_object(
      'org_id', p_org::text, 'registration_policy', 'automatic', 'capacity', 10,
      'starts_at', kc_test.iso_in(interval '2 days'), 'ends_at', kc_test.iso_in(interval '2 days 3 hours'),
      'address', 'North beach'),
    p_city_id => 'tel-aviv');
end $$;

-- 0520: pg_temp helpers are owner-only by default; grant them so any caller may run them.
grant execute on function pg_temp.assert_returned(public.giving_handoffs, text, text) to public;
grant execute on function pg_temp.item_offer(uuid, text) to public;
grant execute on function pg_temp.publish_event(uuid, uuid) to public;

-- ── 0. the helper is internal; no writer reads giving_handoffs ────────────────────────────────
do $$
begin
  perform kc_test.assert_true(
    not has_function_privilege('anon', 'public.giving_handoff_row_of(uuid)', 'EXECUTE'),
    'giving_handoff_row_of: anon may not call it');
  perform kc_test.assert_true(
    not has_function_privilege('authenticated', 'public.giving_handoff_row_of(uuid)', 'EXECUTE'),
    'giving_handoff_row_of: nor a member');
  perform kc_test.assert_true(
    has_function_privilege('service_role', 'public.giving_handoff_row_of(uuid)', 'EXECUTE'),
    'giving_handoff_row_of: service_role may');
  perform kc_test.assert_eq(
    (select prorettype from pg_proc where oid = 'public.giving_handoff_row_of(uuid)'::regprocedure),
    'public.giving_handoffs'::regtype::oid, 'giving_handoff_row_of: returns the giving_handoffs row type');

  perform kc_test.assert_row_count(
    $q$select p.proname from pg_proc p
        where p.pronamespace = 'public'::regnamespace
          and p.proname in ('reserve_item_giving', 'confirm_item_handoff', 'claim_food_giving',
                            'mark_giving_handed_over', 'book_ride_seat', 'confirm_ride_booking',
                            'decline_ride_booking', 'cancel_ride_booking', 'complete_ride_trip',
                            'book_knowledge_slot', 'book_knowledge_seat', 'confirm_knowledge_booking',
                            'decline_knowledge_booking', 'complete_knowledge_session',
                            'request_housing_booking', 'decide_housing_booking', 'cancel_housing_booking',
                            'complete_housing_booking', 'mark_housing_no_show', 'delete_my_listing')
          and p.prosrc ~* 'from\s+public\.giving_handoffs'$q$,
    0, 'no writer reads giving_handoffs');
  perform kc_test.assert_row_count(
    $q$select 1 from pg_proc p
        where p.pronamespace = 'public'::regnamespace
          and p.proname in ('reserve_item_giving', 'confirm_item_handoff', 'claim_food_giving',
                            'mark_giving_handed_over', 'book_ride_seat', 'confirm_ride_booking',
                            'decline_ride_booking', 'cancel_ride_booking', 'complete_ride_trip',
                            'book_knowledge_seat', 'confirm_knowledge_booking', 'decline_knowledge_booking',
                            'complete_knowledge_session',
                            'request_housing_booking', 'decide_housing_booking', 'cancel_housing_booking',
                            'complete_housing_booking', 'mark_housing_no_show')
          and p.prorettype = 'public.giving_handoffs'::regtype
          and p.prosrc ~ 'giving_handoff_row_of'$q$,
    18, 'the eighteen writers still return giving_handoffs, built by the helper');
  -- The pre-slot entry point (0701) delegates to book_knowledge_seat, which builds the row.
  perform kc_test.assert_true(
    (select prosrc ~ 'book_knowledge_seat' and prorettype = 'public.giving_handoffs'::regtype
       from pg_proc where oid = 'public.book_knowledge_slot(uuid)'::regprocedure),
    'book_knowledge_slot returns the seat booking''s row');
end $$;

-- ── 1. items: reserve, confirm, hand over ─────────────────────────────────────────────────────
do $$
declare
  p personas;
  v_listing uuid;
  h public.giving_handoffs;
begin
  select * into p from personas;
  v_listing := pg_temp.item_offer(p.giver, 'a desk lamp');

  perform kc_test.act_as(p.taker);
  h := public.reserve_item_giving(v_listing, 'pickup', null, null);
  perform pg_temp.assert_returned(h, 'reserved', 'items: reserve');
  perform kc_test.assert_eq(h.listing_id, v_listing, 'items: the offer''s listing id, as before');
  perform kc_test.assert_eq(h.recipient_id, p.taker, 'items: the requester');
  perform kc_test.assert_true(h.confirm_by is not null, 'items: the 24 h answer deadline');

  perform kc_test.act_as(p.giver);
  h := public.confirm_item_handoff(h.handoff_id);
  perform pg_temp.assert_returned(h, 'confirmed', 'items: confirm');
  perform kc_test.assert_true(h.confirmed_at is not null, 'items: confirmed_at');

  h := public.mark_giving_handed_over(h.handoff_id);
  perform pg_temp.assert_returned(h, 'handed_over', 'items: hand over');
  perform kc_test.assert_true(h.handed_over_at is not null, 'items: handed_over_at');
end $$;

-- ── 2. food: claim, hand over; the delete guard reads the record ──────────────────────────────
do $$
declare
  p personas;
  v_listing uuid;
  h public.giving_handoffs;
begin
  select * into p from personas;
  v_listing := kc_test.create_listing(p.giver, 'food', 'give_food', 'give', 'wr soup',
    jsonb_build_object('food_type', 'cooked', 'expires_at', now() + interval '1 day'));

  perform kc_test.act_as(p.taker);
  h := public.claim_food_giving(v_listing);
  perform pg_temp.assert_returned(h, 'confirmed', 'food: claim');
  perform kc_test.assert_eq(h.listing_id, v_listing, 'food: the offer''s listing id');
  perform kc_test.assert_true(h.pickup_window_start is not null and h.pickup_window_end is not null,
    'food: the pickup window');

  h := public.mark_giving_handed_over(h.handoff_id);
  perform pg_temp.assert_returned(h, 'handed_over', 'food: hand over');

  -- The hand-over closed the offer; it is the taker's record too, so it cannot be deleted.
  perform kc_test.act_as(p.giver);
  perform kc_test.assert_raises(format('select public.delete_my_listing(%L)', v_listing),
    'listing_has_handoff_history', 'food: a handed-over offer cannot be deleted (read on the record)');
end $$;

-- ── 3. rides: book, confirm, decline, cancel, complete ────────────────────────────────────────
do $$
declare
  p personas;
  v_ride uuid;
  h public.giving_handoffs;
  h2 public.giving_handoffs;
begin
  select * into p from personas;
  v_ride := kc_test.create_ride_offer(p.driver, p_seats => 3);

  perform kc_test.act_as(p.rider);
  h := public.book_ride_seat(v_ride, 2);
  perform pg_temp.assert_returned(h, 'reserved', 'rides: book');
  perform kc_test.assert_eq(h.listing_id, v_ride, 'rides: the ride''s listing id');
  perform kc_test.assert_eq(h.seats, 2, 'rides: the seats booked');

  perform kc_test.act_as(p.driver);
  h := public.confirm_ride_booking(h.handoff_id);
  perform pg_temp.assert_returned(h, 'confirmed', 'rides: confirm');

  perform kc_test.act_as(p.rider2);
  h2 := public.book_ride_seat(v_ride, 1);
  perform pg_temp.assert_returned(h2, 'reserved', 'rides: a second booking');
  perform kc_test.act_as(p.driver);
  h2 := public.decline_ride_booking(h2.handoff_id);
  perform pg_temp.assert_returned(h2, 'cancelled', 'rides: decline');
  perform kc_test.assert_eq(h2.cancel_reason, 'declined', 'rides: declined');

  perform kc_test.act_as(p.rider2);
  h2 := public.book_ride_seat(v_ride, 1);
  h2 := public.cancel_ride_booking(h2.handoff_id);
  perform pg_temp.assert_returned(h2, 'cancelled', 'rides: the passenger cancels');
  perform kc_test.assert_eq(h2.cancel_reason, 'passenger_cancelled', 'rides: passenger_cancelled');

  perform kc_test.act_as(p.driver);
  h := public.complete_ride_trip(h.handoff_id);
  perform pg_temp.assert_returned(h, 'handed_over', 'rides: complete the trip');
  perform kc_test.assert_eq(h.seats, 2, 'rides: still the seats booked');
end $$;

-- ── 4. knowledge: book a slot, complete the session ───────────────────────────────────────────
do $$
declare
  p personas;
  v_listing uuid;
  v_post uuid;
  h public.giving_handoffs;
begin
  select * into p from personas;
  v_listing := kc_test.create_listing(p.mentor, 'knowledge', 'course', 'give', 'intro to css',
    jsonb_build_object(
      'topic', 'CSS', 'level', 'beginner', 'modality', 'video', 'slots_available', 1,
      'slot_starts_at', kc_test.iso_in(interval '10 minutes'),
      'slot_ends_at', kc_test.iso_in(interval '2 hours')));
  -- Knowledge listings start in pending_review (0266); simulate the moderator's approval.
  update public.listings set moderation_status = 'published' where listing_id = v_listing;
  if public.post_id_of_listing(v_listing) is null then
    insert into public.posts (
      owner_id, type, visibility, title, city, street, street_number, location_display_level,
      world_slug, direction, post_type, details, listing_id, listing_world_slug, moderation_status
    ) values (
      p.mentor, 'Give', 'Public', 'intro to css', 'tel-aviv', 'Marketplace', '1', 'CityOnly',
      'knowledge', 'offer', 'standard',
      (select details from public.listings where listing_id = v_listing), v_listing, 'knowledge', 'published'
    );
  end if;
  v_post := public.post_id_of_listing(v_listing);
  perform kc_test.assert_true(v_post is not null, 'knowledge: the offer has its post');

  perform kc_test.act_as(p.learner);
  h := public.book_knowledge_slot(v_post);
  perform pg_temp.assert_returned(h, 'reserved', 'knowledge: book by post id');
  perform kc_test.assert_eq(h.listing_id, v_listing, 'knowledge: the offer''s listing id');
  perform kc_test.assert_true(h.slot_starts_at is not null and h.slot_ends_at is not null, 'knowledge: the slot');

  perform kc_test.act_as(p.mentor);
  h := public.complete_knowledge_session(h.handoff_id);
  perform pg_temp.assert_returned(h, 'handed_over', 'knowledge: complete the session');
end $$;

-- ── 5. housing: request, approve, decline, cancel, complete, no-show ──────────────────────────
do $$
declare
  p personas;
  v_offer uuid;
  h public.giving_handoffs;
  h2 public.giving_handoffs;
begin
  select * into p from personas;
  v_offer := kc_test.create_housing_offer(p.host);

  -- Request and approve; complete after check-in.
  perform kc_test.act_as(p.guest);
  h := public.request_housing_booking(v_offer, public.housing_today() + 3, public.housing_today() + 5,
                                      1, 0, 'Hi, I am walking the trail and need a bed');
  perform pg_temp.assert_returned(h, 'reserved', 'housing: request');
  perform kc_test.assert_eq(h.listing_id, v_offer, 'housing: the offer''s listing id');
  perform kc_test.assert_eq(h.seats, 1, 'housing: the party');
  perform kc_test.assert_true(h.slot_starts_at is not null and h.slot_ends_at is not null, 'housing: the stay window');

  perform kc_test.act_as(p.host);
  h := public.decide_housing_booking(h.handoff_id, true, null);
  perform pg_temp.assert_returned(h, 'confirmed', 'housing: approve');

  -- Decline (the RPC's early return), then a new request the guest cancels.
  perform kc_test.act_as(p.guest2);
  h2 := public.request_housing_booking(v_offer, public.housing_today() + 10, public.housing_today() + 12,
                                       1, 0, 'Hello host');
  perform kc_test.act_as(p.host);
  h2 := public.decide_housing_booking(h2.handoff_id, false, 'Not those dates, sorry');
  perform pg_temp.assert_returned(h2, 'cancelled', 'housing: decline');
  perform kc_test.assert_eq(h2.cancel_reason, 'declined', 'housing: declined');

  perform kc_test.act_as(p.guest2);
  h2 := public.request_housing_booking(v_offer, public.housing_today() + 20, public.housing_today() + 22,
                                       1, 0, 'Hello again');
  perform kc_test.act_as(p.host);
  h2 := public.decide_housing_booking(h2.handoff_id, true, null);
  perform kc_test.act_as(p.guest2);
  h2 := public.cancel_housing_booking(h2.handoff_id, null);
  perform pg_temp.assert_returned(h2, 'cancelled', 'housing: the guest cancels');
  perform kc_test.assert_eq(h2.cancel_reason, 'guest_cancelled', 'housing: guest_cancelled');

  -- Check-in a day ago, on the record (the sync derives the copy), then the host completes.
  update public.post_handoffs
     set slot_starts_at = now() - interval '1 day', slot_ends_at = now() + interval '1 day'
   where handoff_id = h.handoff_id;
  perform kc_test.act_as(p.host);
  h := public.complete_housing_booking(h.handoff_id);
  perform pg_temp.assert_returned(h, 'handed_over', 'housing: complete');

  -- A later stay, approved; check-in five hours ago and nobody came.
  perform kc_test.act_as(p.guest);
  h := public.request_housing_booking(v_offer, public.housing_today() + 30, public.housing_today() + 31,
                                      1, 0, 'Back for another night');
  perform kc_test.act_as(p.host);
  h := public.decide_housing_booking(h.handoff_id, true, null);
  update public.post_handoffs
     set slot_starts_at = now() - interval '5 hours', slot_ends_at = now() + interval '19 hours'
   where handoff_id = h.handoff_id;
  h := public.mark_housing_no_show(h.handoff_id);
  perform pg_temp.assert_returned(h, 'no_show', 'housing: no-show');
  perform kc_test.assert_true(h.no_show_at is not null, 'housing: no_show_at');
end $$;

-- ── 6. time: an event registration has no giving_handoffs row ─────────────────────────────────
insert into public.organizations (org_id, name, slug)
select org_id, 'Writer returns org', 'writer-returns-org' from personas;
insert into public.org_memberships (org_id, user_id, role)
select org_id, organizer, 'org_volunteer' from personas;

do $$
declare
  p personas;
  v_post uuid;
  v_listing uuid;
  v_reg public.post_handoffs;
begin
  select * into p from personas;
  -- Two statements: STABLE post_id_of_listing would not see a post made in its own statement.
  v_listing := pg_temp.publish_event(p.organizer, p.org_id);
  v_post := public.post_id_of_listing(v_listing);
  perform kc_test.assert_true(v_post is not null, 'time: the event has its post');

  perform kc_test.act_as(p.attendee);
  v_reg := public.register_for_event(v_post);
  perform kc_test.assert_eq(v_reg.status, 'confirmed', 'time: the registration is confirmed');
  perform kc_test.assert_true(public.giving_handoff_row_of(v_reg.handoff_id) is null,
    'time: the helper returns null for an event registration');
  perform kc_test.assert_row_count(
    format('select 1 from public.giving_handoffs where handoff_id = %L', v_reg.handoff_id), 0,
    'time: as giving_handoffs holds no row of it');
  perform kc_test.assert_true(public.giving_handoff_row_of(gen_random_uuid()) is null,
    'the helper returns null for an unknown handoff');
end $$;

rollback;

\echo '✓ 0622_g1_writer_returns_from_post_handoffs passed'
