-- supabase/tests/0557_post_for_every_listing.sql | 0557 (G1 step 3b-pre, ADR-006, D19, D-217):
-- every published open listing has a post; a listing of a world that does not mirror into the feed
-- or a later occurrence of a recurring ride gets a hidden post that the feed surfaces skip but
-- handoffs can hang on; sharing or the ride sweep exposes it; an exposed post is never hidden
-- again by a later sync; the backfill left no open listing without a post. Knowledge mirrors into
-- the feed since 0613, so its offers are listed from publication.

begin;

create temp table personas as
select kc_test.create_user('fh_mentor')  as mentor,
       kc_test.create_user('fh_learner') as learner,
       kc_test.create_user('fh_driver')  as driver,
       kc_test.create_user('fh_rider')   as rider,
       kc_test.create_user('fh_giver')   as giver;

-- Knowledge publishes only for a verified identity (worlds.requires_verification).
update public.users set verified_at = now() where user_id = (select mentor from personas);

/** The post of listing p_listing (fails when there is none). */
create function pg_temp.post_of(p_listing uuid)
returns public.posts
language plpgsql
as $$
declare
  v public.posts;
begin
  select p.* into v from public.posts p where p.post_id = public.post_id_of_listing(p_listing);
  if not found then
    perform kc_test.fail('listing has no post');
  end if;
  return v;
end $$;

/** Whether the signed-in feed view lists post p_post for viewer p_viewer. */
create function pg_temp.in_feed(p_viewer uuid, p_post uuid)
returns boolean
language plpgsql
as $$
declare
  v_view int;
begin
  perform kc_test.act_as(p_viewer);
  select count(*) into v_view from public.feed_visible_posts v where v.post_id = p_post;
  return v_view > 0;
end $$;

/** Whether the ranked feed RPC lists post p_post for viewer p_viewer (its newest page). */
create function pg_temp.in_ranked_feed(p_viewer uuid, p_post uuid)
returns boolean
language plpgsql
as $$
declare
  v_ranked int;
begin
  perform kc_test.act_as(p_viewer);
  select count(*) into v_ranked from public.feed_ranked_ids(p_viewer, p_page_limit => 200) r where r.post_id = p_post;
  return v_ranked > 0;
end $$;

-- ── T0 the backfill left no published open listing without a post ───────────────────────────
do $$
begin
  perform kc_test.assert_row_count(
    $q$select 1 from public.listings l
        where l.origin = 'native' and l.moderation_status = 'published' and l.status = 'open'
          and public.post_id_of_listing(l.listing_id) is null$q$,
    0, 'every published open listing has a post after 0557');
end $$;

-- ── T1 a knowledge offer: its post is listed from publication (0613) ────────────────────────
do $$
declare
  p personas;
  v_listing uuid;
  po public.posts;
  h public.giving_handoffs;
begin
  if not exists (select 1 from pg_trigger where tgname = 'listings_feed_mirror_sync') then
    return;
  end if;
  select * into p from personas;
  v_listing := kc_test.create_listing(p.mentor, 'knowledge', 'course', 'give', 'intro to sql',
    jsonb_build_object(
      'topic', 'SQL', 'level', 'beginner', 'modality', 'video', 'slots_available', 2,
      'slot_starts_at', kc_test.iso_in(interval '10 minutes'),
      'slot_ends_at', kc_test.iso_in(interval '2 hours')));
  -- Knowledge listings start in pending_review (0266); simulate the moderator's approval.
  update public.listings set moderation_status = 'published' where listing_id = v_listing;

  po := pg_temp.post_of(v_listing);
  perform kc_test.assert_true(not po.feed_hidden, 'a knowledge offer gets its post at once, listed in the feed');
  perform kc_test.assert_eq(po.status, 'open', 'the post is open like its listing');
  perform kc_test.assert_eq(po.world_slug, 'knowledge', 'in the knowledge world');
  perform kc_test.assert_true(pg_temp.in_feed(p.learner, po.post_id), 'a member sees it in the feed');

  -- A handoff hangs on the post: booking by post id works.
  perform kc_test.act_as(p.learner);
  h := public.book_knowledge_slot(po.post_id);
  perform kc_test.assert_eq(h.listing_id, v_listing, 'a slot is booked by post id');
  perform kc_test.assert_eq((select post_id from public.post_handoffs where handoff_id = h.handoff_id), po.post_id,
    'and the booking has its record under the post (0553)');

  -- An edit on the listing syncs to the post and keeps it listed.
  perform kc_test.act_as(p.mentor);
  update public.listings set title = 'intro to sql, two seats' where listing_id = v_listing;
  po := pg_temp.post_of(v_listing);
  perform kc_test.assert_eq(po.title, 'intro to sql, two seats', 'the edit reached the post');
  perform kc_test.assert_true(not po.feed_hidden, 'and left it listed');
end $$;

-- ── T2 a recurring ride: only the soonest occurrence is listed; the others have hidden posts ─
do $$
declare
  p personas;
  v_series uuid;
  v_first public.listings;
  v_later public.listings;
  h public.giving_handoffs;
begin
  if not exists (select 1 from pg_trigger where tgname = 'listings_feed_mirror_sync') then
    return;
  end if;
  select * into p from personas;
  perform kc_test.act_as(p.driver);
  select r.series_id into v_series
    from public.create_ride_series(
      kc_test.listing_kind_id('rides', 'ride_offer'), 'Tel Aviv to Jerusalem',
      kc_test.ride_route_tlv_jlm() || jsonb_build_object('seats_available', 3), 'give',
      ((now() + interval '2 hours') at time zone 'Asia/Jerusalem')::time, 127, null, 60, null) r;

  select l.* into v_first from public.listings l
   where l.details -> 'ride_series' ->> 'id' = v_series::text and l.status = 'open'
   order by (l.details ->> 'departs_at')::timestamptz limit 1;
  select l.* into v_later from public.listings l
   where l.details -> 'ride_series' ->> 'id' = v_series::text and l.status = 'open'
     and l.listing_id <> v_first.listing_id
   order by (l.details ->> 'departs_at')::timestamptz limit 1;

  perform kc_test.assert_true(not (pg_temp.post_of(v_first.listing_id)).feed_hidden,
    'the soonest occurrence is listed in the feed (FR-RIDE-046)');
  perform kc_test.assert_true((pg_temp.post_of(v_later.listing_id)).feed_hidden,
    'a later occurrence has its post, hidden');
  perform kc_test.assert_true(not pg_temp.in_feed(p.rider, (pg_temp.post_of(v_later.listing_id)).post_id),
    'and the feed does not list it');
  perform kc_test.assert_true(not pg_temp.in_ranked_feed(p.rider, (pg_temp.post_of(v_later.listing_id)).post_id),
    'nor does the ranked feed');

  -- The later occurrence is bookable by its post id.
  perform kc_test.act_as(p.rider);
  h := public.book_ride_seat((pg_temp.post_of(v_later.listing_id)).post_id, 1);
  perform kc_test.assert_eq(h.listing_id, v_later.listing_id, 'a later occurrence is booked by post id');
  perform kc_test.assert_eq((select post_id from public.post_handoffs where handoff_id = h.handoff_id),
    (pg_temp.post_of(v_later.listing_id)).post_id, 'with its record under the post');

  -- The first occurrence leaves (the driver completes it): the sweep lists the next one.
  perform kc_test.act_as(p.driver);
  update public.listings set status = 'closed', updated_at = now() where listing_id = v_first.listing_id;
  perform kc_test.act_as_anon();
  perform public.ride_series_sweep();
  perform kc_test.assert_true(not (pg_temp.post_of(v_later.listing_id)).feed_hidden,
    'the next occurrence is exposed once it is the soonest');
  perform kc_test.assert_true(pg_temp.in_feed(p.rider, (pg_temp.post_of(v_later.listing_id)).post_id),
    'and the feed lists it');
end $$;

-- ── T3 an ordinary item post is unaffected ──────────────────────────────────────────────────
do $$
declare
  p personas;
  v_listing uuid;
  po public.posts;
begin
  if not exists (select 1 from pg_trigger where tgname = 'listings_feed_mirror_sync') then
    return;
  end if;
  select * into p from personas;
  perform kc_test.act_as(p.giver);
  v_listing := public.create_marketplace_listing(
    p_kind_id => kc_test.listing_kind_id('items', 'give_item'), p_title => 'a lamp',
    p_details => '{"item_condition":"Good"}'::jsonb, p_city_id => 'tel-aviv');
  po := pg_temp.post_of(v_listing);
  perform kc_test.assert_true(not po.feed_hidden, 'an item post is listed');
  perform kc_test.assert_true(pg_temp.in_feed(p.learner, po.post_id), 'and a member sees it in the feed');
end $$;

-- ── T4 the report agrees on both sides ─────────────────────────────────────────────────────
do $$
declare
  r jsonb;
begin
  if not exists (select 1 from pg_trigger where tgname = 'listings_feed_mirror_sync') then
    return;
  end if;
  r := public.post_unification_report();
  perform kc_test.assert_eq((r ->> 'mirror_field_mismatches')::int, 0, 'every post agrees with its listing');
  perform kc_test.assert_eq((r ->> 'handoff_rows_missing')::int, 0, 'every handoff with a post has its record');
  perform kc_test.assert_eq((r ->> 'handoff_field_mismatches')::int, 0, 'and both sides agree');
end $$;

rollback;
\echo '✓ 0557_post_for_every_listing.sql passed'
