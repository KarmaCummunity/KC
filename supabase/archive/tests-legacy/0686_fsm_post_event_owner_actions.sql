-- supabase/tests/0686_fsm_post_event_owner_actions.sql
-- Wave 1b-iv (#1989), D131: an organizer may pause or delete
-- an event with registrations; before the event starts its open registrations are cancelled and
-- each attendee is notified. Runs in a rolled-back transaction.

begin;

create temp table personas as
select kc_test.create_user('ev_own_organizer') as organizer,
       kc_test.create_user('ev_own_guest_a')   as guest_a,
       kc_test.create_user('ev_own_guest_b')   as guest_b,
       gen_random_uuid()                       as org_id;

insert into public.organizations (org_id, name, slug)
select org_id, 'Event owner actions test org', 'event-owner-actions-test-org' from personas;
insert into public.org_memberships (org_id, user_id, role)
select org_id, organizer, 'org_admin' from personas;

-- Publishes an event (capacity 1, so the second guest is waitlisted) and returns its post id.
create function pg_temp.event()
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
    p_kind_id => kc_test.listing_kind_id('time', 'org_event'), p_title => 'river cleanup',
    p_details => jsonb_build_object(
      'org_id', p.org_id::text, 'registration_policy', 'automatic', 'capacity', 1,
      'starts_at', kc_test.iso_in(interval '2 days'), 'ends_at', kc_test.iso_in(interval '2 days 3 hours')),
    p_city_id => 'tel-aviv');
  return public.post_id_of_listing(v_listing);
end;
$$;
grant execute on function pg_temp.event() to public;

create function pg_temp.register(p_user uuid, p_post uuid) returns uuid
language plpgsql as $$
declare v public.post_handoffs;
begin
  perform kc_test.act_as(p_user);
  v := public.register_for_event(p_post);
  return v.handoff_id;
end $$;
grant execute on function pg_temp.register(uuid, uuid) to public;

create function pg_temp.status_of(p_handoff uuid) returns text
language sql as $$ select status from public.post_handoffs where handoff_id = p_handoff $$;

create temp table events as
select pg_temp.event() as paused_one, pg_temp.event() as deleted_one, pg_temp.event() as started_one;

-- ── 1. Pause with registrations: allowed; registrations cancelled; attendees notified ──
do $$
declare
  p personas;
  e events;
  h_a uuid;
  h_b uuid;
begin
  select * into p from personas;
  select * into e from events;
  h_a := pg_temp.register(p.guest_a, e.paused_one);
  h_b := pg_temp.register(p.guest_b, e.paused_one);
  perform kc_test.assert_eq(pg_temp.status_of(h_b), 'waitlisted', 'second guest is waitlisted');

  perform kc_test.act_as(p.organizer);
  perform public.pause_my_listing(e.paused_one);
  perform kc_test.assert_eq((select status from public.posts where post_id = e.paused_one), 'paused',
    'the organizer pauses an event with registrations');
  perform kc_test.assert_eq(pg_temp.status_of(h_a), 'cancelled', 'confirmed registration cancelled');
  perform kc_test.assert_eq(pg_temp.status_of(h_b), 'cancelled', 'waitlisted registration cancelled');
  perform kc_test.assert_eq(
    (select cancel_reason from public.post_handoffs where handoff_id = h_a), 'host_cancelled',
    'cancelled by the host');
  perform kc_test.assert_eq(
    (select count(*) from public.notifications_outbox
      where kind = 'event_registration_cancelled' and user_id in (p.guest_a, p.guest_b)),
    2::bigint, 'each attendee is notified once');
end $$;

-- ── 2. Delete with registrations: allowed; the attendee is notified ──────────────
-- The delete is a hard delete: the registration goes with the post (cascade).
do $$
declare
  p personas;
  e events;
  h uuid;
begin
  select * into p from personas;
  select * into e from events;
  h := pg_temp.register(p.guest_a, e.deleted_one);

  perform kc_test.act_as(p.organizer);
  perform public.delete_my_listing(e.deleted_one);
  perform kc_test.assert_true(not exists (select 1 from public.posts where post_id = e.deleted_one),
    'the organizer deletes an event with a registration');
  perform kc_test.assert_eq(
    (select count(*) from public.notifications_outbox
      where kind = 'event_registration_cancelled' and user_id = p.guest_a
        and dedupe_key = 'event_registration_cancelled:' || h::text),
    1::bigint, 'the attendee is notified of the deletion');
end $$;

-- ── 3. After the event started, registrations stay for attendance marking ─────────
do $$
declare
  p personas;
  e events;
  h uuid;
begin
  select * into p from personas;
  select * into e from events;
  h := pg_temp.register(p.guest_a, e.started_one);
  update public.event_post_details
     set starts_at = now() - interval '1 hour', ends_at = now() + interval '2 hours'
   where post_id = e.started_one;

  perform kc_test.act_as(p.organizer);
  perform public.pause_my_listing(e.started_one);
  perform kc_test.assert_true(pg_temp.status_of(h) <> 'cancelled',
    'a started event keeps its registrations for attendance');
end $$;

rollback;

\echo '✓ 0686_fsm_post_event_owner_actions.sql passed'
