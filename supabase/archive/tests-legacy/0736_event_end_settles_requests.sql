-- supabase/tests/0736_event_end_settles_requests.sql
-- D128 / G18: when an event ends, an unanswered request and the waitlist lapse (each member is
-- told), and a confirmed registration stays for attendance marking. Rolled back.

begin;

create temp table personas as
select kc_test.create_user('eve_organizer') as organizer,
       kc_test.create_user('eve_confirmed') as confirmed,
       kc_test.create_user('eve_request')   as request,
       kc_test.create_user('eve_waiting')   as waiting,
       gen_random_uuid()                    as org_id;

insert into public.organizations (org_id, name, slug)
select org_id, 'Event end test org', 'event-end-test-org' from personas;
insert into public.org_memberships (org_id, user_id, role)
select org_id, organizer, 'org_admin' from personas;

do $$
declare
  p personas;
  v_listing uuid;
  v_post uuid;
  v_confirmed uuid;
  v_request uuid;
  v_waiting uuid;
begin
  select * into p from personas;
  perform kc_test.act_as(p.organizer);
  v_listing := public.create_marketplace_listing(
    p_kind_id => kc_test.listing_kind_id('time', 'org_event'), p_title => 'evening talk',
    p_details => jsonb_build_object(
      'org_id', p.org_id::text, 'registration_policy', 'manual', 'capacity', 2,
      'starts_at', kc_test.iso_in(interval '2 days'), 'ends_at', kc_test.iso_in(interval '2 days 2 hours')),
    p_city_id => 'tel-aviv');
  v_post := public.post_id_of_listing(v_listing);

  perform kc_test.act_as(p.confirmed);
  v_confirmed := (public.register_for_event(v_post)).handoff_id;
  perform kc_test.act_as(p.request);
  v_request := (public.register_for_event(v_post)).handoff_id;
  perform kc_test.act_as(p.waiting);
  v_waiting := (public.register_for_event(v_post)).handoff_id;
  perform kc_test.act_as(p.organizer);
  perform public.decide_event_registration(v_confirmed, true);

  -- The event took place and ended an hour ago.
  update public.event_post_details
     set starts_at = now() - interval '3 hours', ends_at = now() - interval '1 hour'
   where post_id = v_post;

  perform kc_test.act_as_anon();
  perform public.events_expired_sweep();

  perform kc_test.assert_eq((select status from public.posts where post_id = v_post), 'expired', 'the event expired');
  perform kc_test.assert_eq(
    (select status from public.post_handoffs where handoff_id = v_confirmed), 'confirmed',
    'a confirmed registration stays for attendance marking');
  perform kc_test.assert_eq(
    (select status || ':' || cancel_reason from public.post_handoffs where handoff_id = v_request),
    'cancelled:expired', 'an unanswered request lapses with the event');
  perform kc_test.assert_eq(
    (select status || ':' || cancel_reason from public.post_handoffs where handoff_id = v_waiting),
    'cancelled:expired', 'the waitlist lapses with the event');
  perform kc_test.assert_eq(
    (select count(*) from public.notifications_outbox
      where user_id = p.waiting and kind = 'event_registration_expired'
        and body_key = 'notifications.eventRegistrationExpiredWaitlistBody'),
    1::bigint, 'the waitlisted member is told no place opened up');
  perform kc_test.assert_eq(
    (select count(*) from public.notifications_outbox
      where user_id = p.request and kind = 'event_registration_expired'
        and body_key = 'notifications.eventRegistrationExpiredBody'),
    1::bigint, 'the member whose request was not answered is told');
end $$;

rollback;
