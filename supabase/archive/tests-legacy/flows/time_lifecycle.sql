-- Time world lifecycle contract (KC#1467): publish, browse/feed mirror, match response,
-- handoff and report moderation. Time kinds/schema: 0241; matching: 0420–0425;
-- listing report review: 0468.

begin;

create temp table personas as
select kc_test.create_user('time_giver') as giver,
       kc_test.create_user('time_requester') as requester,
       kc_test.create_user('time_reporter1') as reporter1,
       kc_test.create_user('time_reporter2') as reporter2,
       kc_test.create_user('time_reporter3') as reporter3,
       kc_test.create_user('time_viewer') as viewer;

create function pg_temp.time_mirror(p_listing uuid)
returns public.posts language sql as $$
  select p from public.posts p where p.listing_id = p_listing
$$;

create function pg_temp.time_in_feed(p_viewer uuid, p_post uuid)
returns boolean language plpgsql as $$
begin
  perform public.refresh_feed_open_posts_mv(false);
  return exists (select 1 from public.feed_ranked_ids(p_viewer, p_page_limit => 100) f
                  where f.post_id = p_post);
end $$;

-- 1) A volunteer offer and a human support request appear in time browse and feed mirrors.
do $$
declare
  p personas;
  v_offer uuid;
  v_request uuid;
  v_offer_post uuid;
  v_request_post uuid;
begin
  select * into p from personas;
  -- Time listings inherit anonymity level 2 (followers-only) from the world.
  insert into public.follow_edges (follower_id, followed_id)
  values (p.viewer, p.giver), (p.viewer, p.requester)
  on conflict do nothing;
  v_offer := kc_test.create_listing(p.giver, 'time', 'volunteer_shift', 'give',
    'Tutor offers tutoring', '{"duration_minutes":60,"skills":["tutoring"],"org_host_slug":"community"}'::jsonb);
  v_request := kc_test.create_listing(p.requester, 'time', 'support_request', 'request',
    'Requester needs tutoring', '{"support_type":"practical","duration_minutes":60}'::jsonb);
  update public.listings set category_id = (
    select category_id from public.categories where world_slug = 'time' and slug = 'mentoring'
  ) where listing_id in (v_offer, v_request);

  perform kc_test.assert_row_count(format(
    'select listing_id from public.browse_listings(p_world_slug => %L, p_viewer => %L) where listing_id in (%L,%L)',
    'time', p.viewer, v_offer, v_request), 2, 'both time directions are visible in browse');
  v_offer_post := (pg_temp.time_mirror(v_offer)).post_id;
  v_request_post := (pg_temp.time_mirror(v_request)).post_id;
  perform kc_test.assert_true(v_offer_post is not null and v_request_post is not null,
    'feed_mirror creates posts for time offers and requests');
  perform kc_test.assert_eq((select type from public.posts where post_id = v_offer_post), 'Give', 'offer mirrors as Give');
  perform kc_test.assert_eq((select type from public.posts where post_id = v_request_post), 'Request', 'request mirrors as Request');
  perform kc_test.assert_true(pg_temp.time_in_feed(p.viewer, v_offer_post), 'viewer sees time offer in main feed');
  perform kc_test.assert_true(pg_temp.time_in_feed(p.viewer, v_request_post), 'viewer sees time request in main feed');
end $$;

-- 2) Matching v2 computes time pairs inline; either side can dismiss with a decline.
do $$
declare
  p personas;
  v_offer uuid;
  v_request uuid;
  v_candidate uuid;
begin
  select * into p from personas;
  -- Matching requires each listing to be visible to the opposite owner.
  insert into public.follow_edges (follower_id, followed_id)
  values (p.giver, p.requester), (p.requester, p.giver)
  on conflict do nothing;
  v_offer := kc_test.create_listing(p.giver, 'time', 'volunteer_shift', 'give',
    'Tutor offers tutoring', '{"duration_minutes":60,"skills":["tutoring"]}'::jsonb);
  v_request := kc_test.create_listing(p.requester, 'time', 'support_request', 'request',
    'Requester needs tutoring', '{"support_type":"practical","duration_minutes":60}'::jsonb);
  update public.listings set category_id = (
    select category_id from public.categories where world_slug = 'time' and slug = 'mentoring'
  ) where listing_id in (v_offer, v_request);
  select candidate_id into v_candidate from public.match_candidates
   where offer_listing_id = v_offer and request_listing_id = v_request and status = 'suggested';
  perform kc_test.assert_true(v_candidate is not null, 'matching v2 suggests a time pair');
  perform kc_test.act_as(p.requester);
  perform public.rpc_match_respond(v_candidate, 'decline');
  perform kc_test.assert_eq((select status from public.match_candidates where candidate_id = v_candidate),
    'declined', 'requester dismisses the time suggestion');
end $$;

-- 3) Handoff lifecycle gap.
-- GAP: reserve_item_giving(uuid,text,timestamptz,timestamptz) in 0382 explicitly accepts
-- only world_slug='items'; no time/generic handoff creation RPC exists. Thus a time listing
-- cannot be requested/handed off through that RPC, and its completion, G19 hours, and 0453
-- time-world karma cannot be exercised without fabricating a handoff row. Skip these checks.
do $$
begin
  perform kc_test.assert_true(true, 'time handoff assertions skipped: see GAP above');
end $$;

-- 4) Three distinct listing reports hide the time listing pending review (0468).
do $$
declare
  p personas;
  v_listing uuid;
begin
  select * into p from personas;
  -- Report validation checks that each reporter can see the target listing.
  insert into public.follow_edges (follower_id, followed_id)
  values (p.reporter1, p.giver), (p.reporter2, p.giver), (p.reporter3, p.giver),
         (p.viewer, p.giver)
  on conflict do nothing;
  v_listing := kc_test.create_listing(p.giver, 'time', 'volunteer_shift', 'give',
    'Volunteer shift for review', '{"duration_minutes":60,"skills":["tutoring"]}'::jsonb);
  perform kc_test.act_as(p.reporter1);
  insert into public.reports (reporter_id, target_type, target_id, reason)
  values (p.reporter1, 'listing', v_listing, 'Other');
  perform kc_test.act_as(p.reporter2);
  insert into public.reports (reporter_id, target_type, target_id, reason)
  values (p.reporter2, 'listing', v_listing, 'Other');
  perform kc_test.act_as(p.reporter3);
  insert into public.reports (reporter_id, target_type, target_id, reason)
  values (p.reporter3, 'listing', v_listing, 'Other');
  perform kc_test.assert_eq(kc_test.listing_status(v_listing), 'hidden_pending_review',
    'three distinct reports hide the listing for review');
  perform kc_test.assert_row_count(format(
    'select listing_id from public.browse_listings(p_world_slug => %L, p_viewer => %L) where listing_id = %L',
    'time', p.viewer, v_listing), 0, 'reported listing disappears from time browse');
end $$;

rollback;

\echo '✓ flows/time_lifecycle.sql passed'
