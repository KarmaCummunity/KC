-- supabase/tests/0742_activity_timeline_world.sql
-- FR-STATS-003, #2078: each row of the personal activity timeline carries its post's world, so
-- the app can word a volunteering row as volunteering. Runs in a rolled-back transaction.

begin;

create temp table personas as
select kc_test.create_user('tl_owner') as owner,
       gen_random_uuid()               as org_id;

-- A time-world post here is an organization's event, which needs a membership to publish.
insert into public.organizations (org_id, name, slug)
select org_id, 'Timeline world test org', 'timeline-world-test-org' from personas;
insert into public.org_memberships (org_id, user_id, role)
select org_id, owner, 'org_admin' from personas;

do $$
declare
  p personas;
  v_time_listing uuid;
  v_item_listing uuid;
  v_time_post uuid;
  v_item_post uuid;
begin
  select * into p from personas;
  perform kc_test.act_as(p.owner);

  v_time_listing := public.create_marketplace_listing(
    p_kind_id => kc_test.listing_kind_id('time', 'org_event'), p_title => 'beach cleanup',
    p_details => jsonb_build_object(
      'org_id', p.org_id::text, 'registration_policy', 'automatic',
      'starts_at', kc_test.iso_in(interval '2 days'), 'ends_at', kc_test.iso_in(interval '2 days 2 hours')),
    p_city_id => 'tel-aviv');
  v_item_listing := public.create_marketplace_listing(
    p_kind_id => kc_test.listing_kind_id('items', 'give_item'), p_title => 'a chair',
    p_details => '{"item_condition":"Good"}'::jsonb, p_city_id => 'tel-aviv');

  -- A listing post enters the feed hidden, so its first timeline row is its close (0044, 0557).
  perform public.fulfill_my_listing(v_time_listing);
  perform public.fulfill_my_listing(v_item_listing);
  v_time_post := public.post_id_of_listing(v_time_listing);
  v_item_post := public.post_id_of_listing(v_item_listing);

  perform kc_test.assert_eq(
    (select world_slug from public.rpc_my_activity_timeline(50)
      where post_id = v_time_post and kind = 'post_closed_delivered'),
    'time', 'a closed volunteering row names the time world');
  perform kc_test.assert_eq(
    (select world_slug from public.rpc_my_activity_timeline(50)
      where post_id = v_item_post and kind = 'post_closed_delivered'),
    'items', 'a closed item row names the items world');
  perform kc_test.assert_eq(
    (select count(*) from public.rpc_my_activity_timeline(1)), 1::bigint, 'the page limit still holds');

  -- Only the member's own timeline, and only when signed in.
  perform kc_test.act_as_anon();
  perform kc_test.assert_raises(
    'select * from public.rpc_my_activity_timeline(10)', 'not_authenticated', 'a signed-out caller reads nothing');
end $$;

rollback;
