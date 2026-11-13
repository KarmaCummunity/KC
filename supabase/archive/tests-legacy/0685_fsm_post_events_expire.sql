-- supabase/tests/0685_fsm_post_events_expire.sql
-- Wave 1b-iii (#1989), D128: an event post expires when the event ends; an event still
-- running or upcoming stays open. Runs in a rolled-back transaction.

begin;

create temp table personas as
select kc_test.create_user('ev_exp_organizer') as organizer,
       gen_random_uuid()                       as org_id;

insert into public.organizations (org_id, name, slug)
select org_id, 'Event expiry test org', 'event-expiry-test-org' from personas;
insert into public.org_memberships (org_id, user_id, role)
select org_id, organizer, 'org_admin' from personas;

-- Publishes an event two days ahead as the organizer and returns its post id (read in a
-- statement of its own, since STABLE post_id_of_listing would miss a post made in the same one).
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
    p_kind_id => kc_test.listing_kind_id('time', 'org_event'), p_title => 'beach cleanup',
    p_details => jsonb_build_object(
      'org_id', p.org_id::text, 'registration_policy', 'automatic',
      'starts_at', kc_test.iso_in(interval '2 days'), 'ends_at', kc_test.iso_in(interval '2 days 3 hours')),
    p_city_id => 'tel-aviv');
  return public.post_id_of_listing(v_listing);
end;
$$;
grant execute on function pg_temp.event() to public;

-- Moves an event's window so that it ended one hour ago.
create function pg_temp.end_event(p_post uuid)
returns void
language sql
as $$
  update public.event_post_details
     set starts_at = now() - interval '4 hours', ends_at = now() - interval '1 hour'
   where post_id = p_post;
$$;

create temp table events as
select pg_temp.event() as ended_open,
       pg_temp.event() as ended_paused,
       pg_temp.event() as upcoming;

do $$
declare
  e events;
begin
  select * into e from events;
  perform pg_temp.end_event(e.ended_open);
  perform pg_temp.end_event(e.ended_paused);
  update public.posts set status = 'paused' where post_id = e.ended_paused;

  perform public.events_expired_sweep();

  perform kc_test.assert_eq((select status from public.posts where post_id = e.ended_open), 'expired',
    'an open event that ended expires');
  perform kc_test.assert_eq((select status from public.posts where post_id = e.ended_paused), 'expired',
    'a paused event that ended expires');
  perform kc_test.assert_eq((select status from public.posts where post_id = e.upcoming), 'open',
    'an upcoming event stays open');

  -- Idempotent: a second run changes nothing.
  perform kc_test.assert_eq(public.events_expired_sweep(), 0, 'a second sweep finds nothing');
end $$;

rollback;

\echo '✓ 0685_fsm_post_events_expire.sql passed'
