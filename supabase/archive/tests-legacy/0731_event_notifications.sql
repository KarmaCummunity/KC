-- supabase/tests/0731_event_notifications.sql
-- G18: an event registration's moves push the right person once each (join request, approval,
-- promotion, decline, removal); the day-before reminder and the attendance prompt are sent once.
-- Runs in a rolled-back transaction.

begin;

create temp table personas as
select kc_test.create_user('evn_organizer') as organizer,
       kc_test.create_user('evn_guest_a')   as guest_a,
       kc_test.create_user('evn_guest_b')   as guest_b,
       kc_test.create_user('evn_guest_c')   as guest_c,
       gen_random_uuid()                    as org_id;

insert into public.organizations (org_id, name, slug)
select org_id, 'Event notifications test org', 'event-notifications-test-org' from personas;
insert into public.org_memberships (org_id, user_id, role)
select org_id, organizer, 'org_admin' from personas;

-- Publishes an event of one place with the given policy and window; returns its post id.
create function pg_temp.event(p_policy text, p_starts interval, p_ends interval)
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
    p_kind_id => kc_test.listing_kind_id('time', 'org_event'), p_title => 'park picnic',
    p_details => jsonb_build_object(
      'org_id', p.org_id::text, 'registration_policy', p_policy, 'capacity', 1,
      'starts_at', kc_test.iso_in(p_starts), 'ends_at', kc_test.iso_in(p_ends)),
    p_city_id => 'tel-aviv');
  return public.post_id_of_listing(v_listing);
end;
$$;

create function pg_temp.register(p_user uuid, p_post uuid) returns uuid
language plpgsql as $$
declare v public.post_handoffs;
begin
  perform kc_test.act_as(p_user);
  v := public.register_for_event(p_post);
  return v.handoff_id;
end $$;

create function pg_temp.pushes(p_user uuid, p_kind text) returns bigint
language sql as $$
  select count(*) from public.notifications_outbox where user_id = p_user and kind = p_kind
$$;

-- ── 1. Manual event: request, promotion, decline, approval, removal ─────────────
do $$
declare
  p personas;
  v_post uuid := pg_temp.event('manual', interval '3 days', interval '3 days 2 hours');
  v_a uuid;
  v_b uuid;
  v_c uuid;
begin
  select * into p from personas;
  v_a := pg_temp.register(p.guest_a, v_post);   -- reserved: a request
  v_b := pg_temp.register(p.guest_b, v_post);   -- waitlisted: the one place is held
  perform kc_test.assert_eq(pg_temp.pushes(p.organizer, 'event_join_request'), 1::bigint,
    'the organizer hears of the request; a waitlisted member is not a request yet');

  -- A leaves; B moves up into a request, which the organizer hears of (A acted, not them).
  perform kc_test.act_as(p.guest_a);
  perform public.cancel_event_registration(v_a);
  perform kc_test.assert_eq(pg_temp.pushes(p.guest_a, 'event_registration_declined'), 0::bigint,
    'leaving oneself sends the member nothing');
  perform kc_test.assert_eq(
    (select count(*) from public.notifications_outbox
      where user_id = p.guest_b and kind = 'event_registration_promoted'
        and body_key = 'notifications.eventRegistrationPromotedPendingBody'),
    1::bigint, 'the waitlisted member moves up and is told the request awaits approval');
  perform kc_test.assert_eq(pg_temp.pushes(p.organizer, 'event_join_request'), 2::bigint,
    'moving up into a manual event is a new request for the organizer');

  perform kc_test.act_as(p.organizer);
  perform public.decide_event_registration(v_b, false);
  perform kc_test.assert_eq(pg_temp.pushes(p.guest_b, 'event_registration_declined'), 1::bigint,
    'a declined member is told');

  -- The place is free again, so C's registration is a third request.
  v_c := pg_temp.register(p.guest_c, v_post);
  perform kc_test.assert_eq(pg_temp.pushes(p.organizer, 'event_join_request'), 3::bigint,
    'a registration into a free place of a manual event is a request');
  perform kc_test.act_as(p.organizer);
  perform public.decide_event_registration(v_c, true);
  perform kc_test.assert_eq(pg_temp.pushes(p.guest_c, 'event_registration_approved'), 1::bigint,
    'an approved member is told');

  perform kc_test.act_as(p.organizer);
  perform public.cancel_event_registration(v_c);
  perform kc_test.assert_eq(
    (select count(*) from public.notifications_outbox
      where user_id = p.guest_c and kind = 'event_registration_declined'
        and title_key = 'notifications.eventRegistrationRemovedTitle'),
    1::bigint, 'a confirmed member the organizer removes is told they were removed');
end $$;

-- ── 2. Only event posts push: a full automatic event promotes straight to confirmed ──
do $$
declare
  p personas;
  v_post uuid := pg_temp.event('automatic', interval '4 days', interval '4 days 2 hours');
  v_a uuid;
begin
  select * into p from personas;
  v_a := pg_temp.register(p.guest_a, v_post);   -- confirmed at once
  perform pg_temp.register(p.guest_b, v_post);  -- waitlisted
  -- Still the three requests of section 1.
  perform kc_test.assert_eq(pg_temp.pushes(p.organizer, 'event_join_request'), 3::bigint,
    'an automatic event raises no requests');
  perform kc_test.act_as(p.guest_a);
  perform public.cancel_event_registration(v_a);
  perform kc_test.assert_eq(
    (select count(*) from public.notifications_outbox
      where user_id = p.guest_b and kind = 'event_registration_promoted'
        and body_key = 'notifications.eventRegistrationPromotedBody'),
    1::bigint, 'moving up into an automatic event confirms the place and says so');
end $$;

-- ── 3. Day-before reminder and attendance prompt, once each ────────────────────
do $$
declare
  p personas;
  v_soon uuid := pg_temp.event('automatic', interval '3 days', interval '3 days 2 hours');
  v_done uuid := pg_temp.event('automatic', interval '3 days', interval '3 days 2 hours');
begin
  select * into p from personas;
  perform pg_temp.register(p.guest_c, v_soon);
  perform pg_temp.register(p.guest_c, v_done);
  -- Registered well before the reminder window opens.
  update public.post_handoffs set reserved_at = now() - interval '2 days'
   where post_id in (v_soon, v_done);

  -- Move both events in time: one starts in 12 hours, the other ended an hour ago.
  update public.event_post_details
     set starts_at = now() + interval '12 hours', ends_at = now() + interval '14 hours'
   where post_id = v_soon;
  update public.event_post_details
     set starts_at = now() - interval '3 hours', ends_at = now() - interval '1 hour'
   where post_id = v_done;

  -- The sweeps run as pg_cron does, with no caller (self-suppression keys off auth.uid()).
  perform kc_test.act_as_anon();
  perform public.event_reminder_sweep();
  perform public.event_reminder_sweep();
  perform public.event_attendance_prompt_sweep();
  perform public.event_attendance_prompt_sweep();

  perform kc_test.assert_eq(pg_temp.pushes(p.guest_c, 'event_reminder'), 1::bigint,
    'a confirmed attendee is reminded once');
  perform kc_test.assert_eq(pg_temp.pushes(p.organizer, 'event_mark_attendance'), 1::bigint,
    'the organizer is asked once to mark attendance');
end $$;

rollback;
