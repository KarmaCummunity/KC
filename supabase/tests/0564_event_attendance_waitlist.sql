-- supabase/tests/0564_event_attendance_waitlist.sql | 0564 (G1 step 5c, S13, G18): an organization
-- event's waitlist and the attendance its organizer marks.
--   1. a full event waitlists the next member; a freed place confirms the earliest of them;
--   2. under the manual policy a member who moves up waits for the organizer's approval again;
--      a waitlisted member may leave the waitlist;
--   3. after the event starts the organizer marks attendance: attended earns 10 karma once,
--      an absence earns none and can be corrected to attended; before the start, or by anyone
--      else, marking is refused.
-- Runs in a rolled-back transaction.

begin;

create temp table personas as
select kc_test.create_user('ew_organizer') as organizer,
       kc_test.create_user('ew_guest_a')   as guest_a,
       kc_test.create_user('ew_guest_b')   as guest_b,
       kc_test.create_user('ew_guest_c')   as guest_c,
       gen_random_uuid()                   as org_id;

insert into public.organizations (org_id, name, slug)
select org_id, 'Waitlist test org', 'waitlist-test-org' from personas;
insert into public.org_memberships (org_id, user_id, role)
select org_id, organizer, 'org_admin' from personas;

-- Publishes an event as the organizer and returns its post id (read in a statement of its own,
-- since STABLE post_id_of_listing would miss a post made in the calling statement).
create function pg_temp.event(p_policy text, p_capacity int)
returns uuid
language plpgsql
as $$
declare
  p personas;
  v_listing uuid;
begin
  select * into p from personas;
  perform kc_test.act_as(p.organizer);
  v_listing := public.create_marketplace_listing(
    p_kind_id => kc_test.listing_kind_id('time', 'org_event'), p_title => 'park cleanup',
    p_details => jsonb_strip_nulls(jsonb_build_object(
      'org_id', p.org_id::text, 'registration_policy', p_policy, 'capacity', p_capacity,
      'starts_at', kc_test.iso_in(interval '2 days'), 'ends_at', kc_test.iso_in(interval '2 days 3 hours'))),
    p_city_id => 'tel-aviv');
  return public.post_id_of_listing(v_listing);
end;
$$;
grant execute on function pg_temp.event(text, int) to public;

-- Registers p_user for the event and returns the registration.
create function pg_temp.register(p_user uuid, p_post uuid)
returns public.post_handoffs
language plpgsql
as $$
begin
  perform kc_test.act_as(p_user);
  return public.register_for_event(p_post);
end;
$$;
grant execute on function pg_temp.register(uuid, uuid) to public;

-- A registration's current status.
create function pg_temp.status_of(p_handoff uuid)
returns text
language sql
as $$ select status from public.post_handoffs where handoff_id = p_handoff $$;
grant execute on function pg_temp.status_of(uuid) to public;

-- ── T1 automatic: a full event waitlists; a freed place confirms the earliest ──────────────
do $$
declare
  p personas;
  v_post uuid;
  v_a public.post_handoffs;
  v_b public.post_handoffs;
  v_c public.post_handoffs;
begin
  select * into p from personas;
  v_post := pg_temp.event('automatic', 1);
  v_a := pg_temp.register(p.guest_a, v_post);
  v_b := pg_temp.register(p.guest_b, v_post);
  v_c := pg_temp.register(p.guest_c, v_post);
  perform kc_test.assert_eq(v_a.status, 'confirmed', 'the first member takes the place');
  perform kc_test.assert_eq(v_b.status, 'waitlisted', 'the next one waits for a place');
  perform kc_test.assert_eq(v_c.status, 'waitlisted', 'and the one after');
  perform kc_test.assert_raises(format('select public.register_for_event(%L)', v_post),
    'already_booked', 'a waitlisted member does not register twice');

  perform kc_test.act_as(p.guest_a);
  perform public.cancel_event_registration(v_a.handoff_id);
  perform kc_test.assert_eq(pg_temp.status_of(v_b.handoff_id), 'confirmed',
    'the earliest waitlisted member takes the freed place');
  perform kc_test.assert_eq(pg_temp.status_of(v_c.handoff_id), 'waitlisted', 'the later one keeps waiting');
end $$;

-- ── T2 manual: moving up waits for approval again; leaving the waitlist ─────────────────────
do $$
declare
  p personas;
  v_post uuid;
  v_a public.post_handoffs;
  v_b public.post_handoffs;
  v_c public.post_handoffs;
begin
  select * into p from personas;
  v_post := pg_temp.event('manual', 1);
  v_a := pg_temp.register(p.guest_a, v_post);
  v_b := pg_temp.register(p.guest_b, v_post);
  v_c := pg_temp.register(p.guest_c, v_post);
  perform kc_test.assert_eq(v_b.status, 'waitlisted', 'a request waiting for approval holds the place');

  perform kc_test.act_as(p.guest_c);
  perform kc_test.assert_eq((public.cancel_event_registration(v_c.handoff_id)).status, 'cancelled',
    'a waitlisted member may leave the waitlist');

  perform kc_test.act_as(p.organizer);
  perform public.decide_event_registration(v_a.handoff_id, false);
  perform kc_test.assert_eq(pg_temp.status_of(v_b.handoff_id), 'reserved',
    'under the manual policy the member who moves up waits for approval');
end $$;

-- ── T3 attendance: marked by the organizer after the start; only attendance earns karma ────
do $$
declare
  p personas;
  v_post uuid;
  v_a public.post_handoffs;
  v_b public.post_handoffs;
  v_karma_a int;
  v_karma_b int;
begin
  select * into p from personas;
  v_post := pg_temp.event('automatic', null);
  v_a := pg_temp.register(p.guest_a, v_post);
  v_b := pg_temp.register(p.guest_b, v_post);

  perform kc_test.act_as(p.organizer);
  perform kc_test.assert_raises(format('select public.mark_event_attendance(%L, true)', v_a.handoff_id),
    'event_not_started', 'attendance waits for the event to start');

  -- The event starts: its window moves into the past (the registrations are already made).
  update public.event_post_details
     set starts_at = now() - interval '1 hour', ends_at = now() + interval '1 hour'
   where post_id = v_post;
  select karma_points into v_karma_a from public.users where user_id = p.guest_a;
  select karma_points into v_karma_b from public.users where user_id = p.guest_b;

  perform kc_test.act_as(p.guest_a);
  perform kc_test.assert_raises(format('select public.mark_event_attendance(%L, true)', v_a.handoff_id),
    'not_owner', 'a registrant cannot mark their own attendance');

  perform kc_test.act_as(p.organizer);
  perform kc_test.assert_eq((public.mark_event_attendance(v_a.handoff_id, true)).status, 'handed_over',
    'the organizer marks an attendee');
  perform kc_test.assert_eq((select karma_points from public.users where user_id = p.guest_a), v_karma_a + 10,
    'attendance earns 10 karma');
  perform kc_test.assert_raises(format('select public.mark_event_attendance(%L, true)', v_a.handoff_id),
    'invalid_transition', 'an attendee is marked once');

  perform kc_test.assert_eq((public.mark_event_attendance(v_b.handoff_id, false)).status, 'no_show',
    'the organizer marks an absence');
  perform kc_test.assert_eq((select karma_points from public.users where user_id = p.guest_b), v_karma_b,
    'an absence earns nothing');
  perform kc_test.assert_eq((public.mark_event_attendance(v_b.handoff_id, true)).status, 'handed_over',
    'an absence marked by mistake is corrected to attended');
  perform kc_test.assert_eq((select karma_points from public.users where user_id = p.guest_b), v_karma_b + 10,
    'the corrected attendee earns the karma');
  perform kc_test.assert_eq(
    (select count(*) from public.karma_ledger
      where event_type = 'event_attendance' and ref_id in (v_a.handoff_id::text, v_b.handoff_id::text)),
    2::bigint, 'one attendance award per registration');
end $$;

rollback;
\echo '✓ 0564_event_attendance_waitlist.sql passed'
