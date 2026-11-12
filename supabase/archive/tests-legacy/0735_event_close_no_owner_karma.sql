-- supabase/tests/0735_event_close_no_owner_karma.sql
-- D124: an organizer's close of an event earns no "fulfilled" karma; an item's close still does.
-- Runs in a rolled-back transaction.

begin;

create temp table personas as
select kc_test.create_user('evk_organizer') as organizer,
       gen_random_uuid()                    as org_id;

insert into public.organizations (org_id, name, slug)
select org_id, 'Event karma test org', 'event-karma-test-org' from personas;
insert into public.org_memberships (org_id, user_id, role)
select org_id, organizer, 'org_admin' from personas;

do $$
declare
  p personas;
  v_event uuid;
  v_item uuid;
begin
  select * into p from personas;
  perform kc_test.act_as(p.organizer);
  v_event := public.create_marketplace_listing(
    p_kind_id => kc_test.listing_kind_id('time', 'org_event'), p_title => 'beach cleanup',
    p_details => jsonb_build_object(
      'org_id', p.org_id::text, 'registration_policy', 'automatic',
      'starts_at', kc_test.iso_in(interval '2 days'), 'ends_at', kc_test.iso_in(interval '2 days 2 hours')),
    p_city_id => 'tel-aviv');
  v_item := kc_test.create_listing(p.organizer, 'items', 'give_item', 'give', 'a lamp',
    '{"item_condition":"Good"}'::jsonb);

  perform kc_test.act_as(p.organizer);
  perform public.fulfill_my_listing(v_event);
  perform public.fulfill_my_listing(v_item);

  perform kc_test.assert_eq(
    (select status from public.posts where post_id = public.post_id_of_listing(v_event)), 'closed_delivered',
    'the event is closed');
  perform kc_test.assert_eq(
    (select count(*) from public.karma_ledger
      where user_id = p.organizer and event_type = 'listing_fulfilled' and ref_id = v_event::text),
    0::bigint, 'closing an event grants no fulfilled karma');
  perform kc_test.assert_eq(
    (select count(*) from public.karma_ledger
      where user_id = p.organizer and event_type = 'listing_fulfilled' and ref_id = v_item::text),
    1::bigint, 'closing an item still does');
end $$;

rollback;
