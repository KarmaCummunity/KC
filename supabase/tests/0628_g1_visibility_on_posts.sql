-- supabase/tests/0628_g1_visibility_on_posts.sql | 0628 (G1 step 6a-5d, issue #1671): who sees a
-- listing is decided on its post, and a moderation hold no longer closes a post-owned listing.
--   1. a listing-sourced listing (a directly inserted ride): owner, strangers, guests, blocked
--      users, followers, operators, the three anonymity levels, closed / paused listings, a
--      moderation hold, a reporter's hide and a deactivated owner see exactly what they saw
--      before 0628 (these cases pin the pre-0628 behaviour);
--   2. a reporter of the listing's post no longer sees the listing (new in 0628);
--   3. a post-owned ride is seen as its post is;
--   4. a listing without a post yet (pending knowledge) still answers on its own columns;
--   5. #1907: a moderation hold on a post-owned ride hides it and keeps its listing open, and
--      publishing again restores the post to open.
-- Runs in a rolled-back transaction.

begin;

create temp table personas as
select kc_test.create_user('vis_owner')    as owner,
       kc_test.create_user('vis_stranger') as stranger,
       kc_test.create_user('vis_follower') as follower,
       kc_test.create_user('vis_operator') as operator,
       kc_test.create_user('vis_blocked')  as blocked,
       kc_test.create_user('vis_reporter') as reporter,
       kc_test.create_user('vis_mentor')   as mentor;

-- A moderator is a listing operator (is_listing_operator, 0263) without an org scope.
insert into public.admin_role_grants (user_id, role) select operator, 'moderator' from personas;
insert into public.blocks (blocker_id, blocked_id) select owner, blocked from personas;
select kc_test.act_as((select follower from personas));
insert into public.follow_edges (follower_id, followed_id) select follower, owner from personas;
-- Knowledge publishes only for a verified identity (worlds.requires_verification).
update public.users set verified_at = now() where user_id = (select mentor from personas);

/** Whether p_viewer sees listing p_listing (the predicate behind RLS, browse and detail). */
create function pg_temp.sees(p_listing uuid, p_viewer uuid)
returns boolean
language sql
as $$ select public.is_listing_visible_to(l, p_viewer) from public.listings l where l.listing_id = p_listing $$;
grant execute on function pg_temp.sees(uuid, uuid) to public;

-- ── T1 a listing-sourced listing: the pre-0628 rules, unchanged ─────────────────────────────
do $$
declare
  p personas;
  v uuid;
begin
  select * into p from personas;
  v := kc_test.create_ride_offer(p.owner);
  perform kc_test.assert_true(public.post_id_of_listing(v) is not null, 'the direct listing has its mirror post');

  -- Public (anonymity 3), open.
  perform kc_test.assert_true(pg_temp.sees(v, p.owner), 'public open: the owner sees it');
  perform kc_test.assert_true(pg_temp.sees(v, p.stranger), 'public open: a member sees it');
  perform kc_test.assert_true(pg_temp.sees(v, null), 'public open: a guest sees it');
  perform kc_test.assert_true(not pg_temp.sees(v, p.blocked), 'public open: a blocked member does not');

  -- Followers only (anonymity 2).
  update public.listings set anonymity_level = 2 where listing_id = v;
  if not exists (select 1 from pg_trigger where tgname = 'listings_feed_mirror_sync') then
    update public.posts set visibility = 'FollowersOnly' where listing_id = v;
  end if;
  perform kc_test.assert_true(pg_temp.sees(v, p.follower), 'followers only: a follower sees it');
  perform kc_test.assert_true(not pg_temp.sees(v, p.stranger), 'followers only: a stranger does not');
  perform kc_test.assert_true(not pg_temp.sees(v, p.operator), 'followers only: an operator who does not follow does not');

  -- Only me (anonymity 1): operators only.
  update public.listings set anonymity_level = 1 where listing_id = v;
  if not exists (select 1 from pg_trigger where tgname = 'listings_feed_mirror_sync') then
    update public.posts set visibility = 'OnlyMe' where listing_id = v;
  end if;
  perform kc_test.assert_true(not pg_temp.sees(v, p.follower), 'only me: a follower does not see it');
  perform kc_test.assert_true(pg_temp.sees(v, p.operator), 'only me: an operator sees it');
  perform kc_test.assert_true(pg_temp.sees(v, p.owner), 'only me: the owner sees it');

  -- Closed: operators still see an anonymity-1 listing; a public one leaves everyone but its owner.
  update public.listings set status = 'closed' where listing_id = v;
  if not exists (select 1 from pg_trigger where tgname = 'listings_feed_mirror_sync') then
    update public.posts set status = 'closed_delivered' where listing_id = v;
  end if;
  perform kc_test.assert_true(pg_temp.sees(v, p.operator), 'closed, only me: an operator sees it');
  update public.listings set anonymity_level = 3 where listing_id = v;
  if not exists (select 1 from pg_trigger where tgname = 'listings_feed_mirror_sync') then
    update public.posts set visibility = 'Public' where listing_id = v;
  end if;
  perform kc_test.assert_true(not pg_temp.sees(v, p.stranger), 'closed, public: a member does not see it');
  perform kc_test.assert_true(pg_temp.sees(v, p.owner), 'closed, public: the owner sees it');

  -- Paused (cancelled): hidden from everyone but the owner, operators included.
  update public.listings set status = 'cancelled', anonymity_level = 1 where listing_id = v;
  if not exists (select 1 from pg_trigger where tgname = 'listings_feed_mirror_sync') then
    update public.posts set status = 'open' where listing_id = v;
    update public.posts set status = 'paused', visibility = 'OnlyMe' where listing_id = v;
  end if;
  perform kc_test.assert_true(not pg_temp.sees(v, p.operator), 'paused: an operator does not see it');
  perform kc_test.assert_true(pg_temp.sees(v, p.owner), 'paused: the owner sees it');

  -- A moderation hold hides an open public listing from everyone but its owner.
  update public.listings set status = 'open', anonymity_level = 3, moderation_status = 'pending_review' where listing_id = v;
  if not exists (select 1 from pg_trigger where tgname = 'listings_feed_mirror_sync') then
    update public.posts set status = 'open', visibility = 'Public', moderation_status = 'pending_review' where listing_id = v;
  end if;
  perform kc_test.assert_true(not pg_temp.sees(v, p.stranger), 'held: a member does not see it');
  perform kc_test.assert_true(not pg_temp.sees(v, p.operator), 'held: an operator does not see it either');
  perform kc_test.assert_true(pg_temp.sees(v, p.owner), 'held: the owner sees it');
  update public.listings set moderation_status = 'published' where listing_id = v;
  if not exists (select 1 from pg_trigger where tgname = 'listings_feed_mirror_sync') then
    update public.posts set moderation_status = 'published' where listing_id = v;
  end if;
  perform kc_test.assert_true(pg_temp.sees(v, p.stranger), 'published again: a member sees it');

  -- A reporter's hide (FR-MOD-001 AC1, 0468) hides the listing from that reporter only.
  insert into public.reporter_hides (reporter_id, target_type, target_id) values (p.reporter, 'listing', v);
  perform kc_test.assert_true(not pg_temp.sees(v, p.reporter), 'the reporter no longer sees it');
  perform kc_test.assert_true(pg_temp.sees(v, p.stranger), 'other members still do');

  -- A deactivated owner's listing is theirs alone (0549).
  update public.users set account_status = 'pending_deletion', deletion_purge_at = now() + interval '30 days' where user_id = p.owner;
  perform kc_test.assert_true(not pg_temp.sees(v, p.stranger), 'a deactivated owner: others do not see it');
  perform kc_test.assert_true(pg_temp.sees(v, p.owner), 'a deactivated owner: the owner does');
  update public.users set account_status = 'active', deletion_purge_at = null where user_id = p.owner;
end $$;

-- ── T2 a reporter of the listing's post no longer sees the listing (new in 0628) ────────────
do $$
declare
  p personas;
  v uuid;
begin
  select * into p from personas;
  v := kc_test.create_ride_offer(p.owner, p_departs_in => interval '2 hours');
  insert into public.reporter_hides (reporter_id, target_type, target_id)
  values (p.reporter, 'post', public.post_id_of_listing(v));
  perform kc_test.assert_true(not pg_temp.sees(v, p.reporter), 'a hidden post hides its listing from the reporter');
  perform kc_test.assert_true(pg_temp.sees(v, p.stranger), 'other members still see it');
end $$;

-- ── T3 a post-owned ride is seen as its post is ─────────────────────────────────────────────
do $$
declare
  p personas;
  v uuid;
begin
  select * into p from personas;
  perform kc_test.act_as(p.owner);
  v := public.create_marketplace_listing(
    p_kind_id => kc_test.listing_kind_id('rides', 'ride_offer'),
    p_title   => 'Tel Aviv to Jerusalem',
    p_details => kc_test.ride_route_tlv_jlm()
                 || jsonb_build_object('departs_at', kc_test.iso_in(interval '3 hours'), 'seats_available', 3),
    p_city_id => 'tel-aviv');
  perform kc_test.assert_true(pg_temp.sees(v, p.stranger), 'open: a member sees it');
  perform kc_test.assert_true(not pg_temp.sees(v, p.blocked), 'open: a blocked member does not');
  perform public.pause_my_listing(v);
  perform kc_test.assert_true(not pg_temp.sees(v, p.stranger), 'paused: a member does not see it');
  perform kc_test.assert_true(pg_temp.sees(v, p.owner), 'paused: the owner does');
end $$;

-- ── T4 a listing without a post yet answers on its own columns ──────────────────────────────
do $$
declare
  p personas;
  v uuid;
begin
  select * into p from personas;
  v := kc_test.create_listing(p.mentor, 'knowledge', 'course', 'give', 'intro to sql',
    jsonb_build_object(
      'topic', 'SQL', 'level', 'beginner', 'modality', 'video', 'slots_available', 2,
      'slot_starts_at', kc_test.iso_in(interval '10 minutes'),
      'slot_ends_at', kc_test.iso_in(interval '2 hours')));
  perform kc_test.assert_eq(public.post_id_of_listing(v), null::uuid, 'a pending knowledge listing has no post');
  perform kc_test.assert_true(pg_temp.sees(v, p.mentor), 'its owner sees it');
  perform kc_test.assert_true(not pg_temp.sees(v, p.stranger), 'a member does not, while it is held');
end $$;

-- ── T5 #1907: a moderation hold on a post-owned ride does not close it ──────────────────────
do $$
declare
  p personas;
  v uuid;
  v_post uuid;
begin
  select * into p from personas;
  perform kc_test.act_as(p.owner);
  v := public.create_marketplace_listing(
    p_kind_id => kc_test.listing_kind_id('rides', 'ride_offer'),
    p_title   => 'Haifa to Tel Aviv',
    p_details => kc_test.ride_route_tlv_jlm()
                 || jsonb_build_object('departs_at', kc_test.iso_in(interval '4 hours'), 'seats_available', 2),
    p_city_id => 'tel-aviv');
  v_post := public.post_id_of_listing(v);

  update public.listings set moderation_status = 'pending_review' where listing_id = v;
  if not exists (select 1 from pg_trigger where tgname = 'listings_feed_mirror_sync') then
    update public.posts set moderation_status = 'pending_review' where post_id = v_post;
  end if;
  perform kc_test.assert_eq((select moderation_status from public.posts where post_id = v_post), 'pending_review',
    'the hold reaches the post');
  perform kc_test.assert_true(not pg_temp.sees(v, p.stranger), 'a held ride is hidden from members');
  perform kc_test.assert_true(pg_temp.sees(v, p.owner), 'its owner still sees it');
  perform kc_test.assert_eq(kc_test.listing_status(v), 'open', 'the hold does not close the listing');

  update public.listings set moderation_status = 'published' where listing_id = v;
  if not exists (select 1 from pg_trigger where tgname = 'listings_feed_mirror_sync') then
    update public.posts set moderation_status = 'published' where post_id = v_post;
  end if;
  perform kc_test.assert_eq((select status from public.posts where post_id = v_post), 'open', 'publishing again reopens the post');
  perform kc_test.assert_eq(kc_test.listing_status(v), 'open', 'and the listing is open');
  perform kc_test.assert_true(pg_temp.sees(v, p.stranger), 'members see it again');

  -- An owner edit during a hold does not close the listing either.
  update public.listings set moderation_status = 'pending_review' where listing_id = v;
  if not exists (select 1 from pg_trigger where tgname = 'listings_feed_mirror_sync') then
    update public.posts set moderation_status = 'pending_review' where post_id = v_post;
  end if;
  perform public.update_my_listing(v, p_title => 'Haifa to Tel Aviv, edited');
  perform kc_test.assert_eq(kc_test.listing_status(v), 'open', 'an edit during the hold keeps the listing open');
  update public.listings set moderation_status = 'published' where listing_id = v;
  if not exists (select 1 from pg_trigger where tgname = 'listings_feed_mirror_sync') then
    update public.posts set moderation_status = 'published' where post_id = v_post;
  end if;
  perform kc_test.assert_eq((select status from public.posts where post_id = v_post), 'open', 'and publishing reopens the post');
end $$;

rollback;
\echo '✓ 0628_g1_visibility_on_posts.sql passed'
