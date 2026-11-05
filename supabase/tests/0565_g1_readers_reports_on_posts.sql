-- supabase/tests/0565_g1_readers_reports_on_posts.sql | 0565 (G1 step 6a-1, ADR-006): the leaf readers
-- read `posts` / `post_handoffs` instead of `listings` / `giving_handoffs`, with the same results:
--   1. admin_world_flow_funnel counts a handed-over item, a post-form item and a ride booking as it
--      did on the listing side (deltas over a baseline, so other rows cannot skew it);
--   2. my_world_givings counts a handed-over handoff and a closed post; a time-world attendance,
--      which lives on post_handoffs only (0563 / 0564), now counts too;
--   3. the rides health checks read the handoff record and the ride's post;
--   4. feed_ranked_ids still finds a listing-world post by its sub-category (posts.category_id);
--   5. a report on a listing still resolves its title and owner — a listing with a post, the
--      listing of a post-form item, and a listing that has no post (fallback);
--   6. get_nonprofit_public_page lists money campaigns by listing id with the listing status.
-- STABLE helpers (post_id_of_listing) are read in a statement after the one that creates the row.
-- Runs in a rolled-back transaction.

begin;

create temp table personas as
select kc_test.create_user('rd_giver')            as giver,
       kc_test.create_user('rd_taker')            as taker,
       kc_test.create_user('rd_driver')           as driver,
       kc_test.create_user('rd_passenger')        as passenger,
       kc_test.create_user('rd_second_passenger') as second_passenger,
       kc_test.create_user('rd_reporter')         as reporter,
       kc_test.create_user('rd_moderator')        as moderator,
       gen_random_uuid()                          as org_id;

insert into public.admin_role_grants (user_id, role) select moderator, 'moderator' from personas;

-- Fixture ids shared by the blocks below.
create temp table fx (k text primary key, id uuid);

-- The 30-day funnel before and after the fixtures.
create temp table funnel_before (
  world_slug text, world_label_he text, world_label_en text, direction text,
  published integer, booked integer, confirmed integer, completed integer, cancelled integer,
  closed integer, median_hours_to_booking numeric, median_hours_to_completion numeric
);
create temp table funnel_after (like funnel_before);

do $$
declare p personas;
begin
  select * into p from personas;
  perform kc_test.act_as(p.moderator);
  insert into funnel_before select * from public.admin_world_flow_funnel(30);
end $$;

-- ── fixtures: a handed-over item, a post-form item, a ride with two bookings ────────────────
do $$
declare
  p personas;
  v_item uuid;
  v_post uuid;
  v_ride uuid;
  v_confirmed uuid;
begin
  select * into p from personas;

  -- An items listing (its post is the mirror) handed over and closed, as the 0542 fixtures do.
  v_item := kc_test.create_listing(p.giver, 'items', 'give_item', 'give', 'Reading lamp',
    '{"item_condition":"Good","fulfillment_mode":"owner_approval"}'::jsonb, now() + interval '30 days');
  insert into fx values ('item_listing', v_item);
  insert into public.giving_handoffs (listing_id, owner_id, recipient_id, world_slug, status, confirmed_at, handed_over_at)
  values (v_item, p.giver, p.taker, 'items', 'handed_over', now(), now());
  update public.listings set status = 'closed' where listing_id = v_item;

  -- An item made through the post form: the post owns an origin-'post' listing (0243).
  perform kc_test.act_as(p.giver);
  insert into public.posts (owner_id, type, title, category, city, street, street_number)
  values (p.giver, 'Give', 'Wooden stool', 'Other', 'tel-aviv', 'Herzl', '1')
  returning post_id into v_post;
  insert into fx values ('item_post', v_post);

  -- A ride with one booking waiting for the driver and one the driver confirmed.
  v_ride := kc_test.create_ride_offer(p.driver, p_seats => 3);
  insert into fx values ('ride', v_ride);
  insert into fx values ('ride_waiting', kc_test.book_ride(p.passenger, v_ride));
  v_confirmed := kc_test.book_ride(p.second_passenger, v_ride);
  insert into fx values ('ride_confirmed', v_confirmed);
  perform kc_test.act_as(p.driver);
  perform public.confirm_ride_booking(v_confirmed);
end $$;

-- ── 1. the funnel: same stages, now from posts and post_handoffs ──────────────────────────────
do $$
declare
  p personas;
  a funnel_after;
  b funnel_before;
begin
  select * into p from personas;
  perform kc_test.assert_true(public.post_id_of_listing((select id from fx where k = 'item_listing')) is not null,
    'the items listing has its post');
  perform kc_test.assert_true(public.listing_id_of_post((select id from fx where k = 'item_post')) is not null,
    'the post-form item has its derived listing');

  perform kc_test.act_as(p.moderator);
  insert into funnel_after select * from public.admin_world_flow_funnel(30);

  select * into a from funnel_after where world_slug = 'items' and direction = 'give';
  select * into b from funnel_before where world_slug = 'items' and direction = 'give';
  perform kc_test.assert_eq(a.published - coalesce(b.published, 0), 2,
    'items: the handed-over listing and the post-form item are published');
  perform kc_test.assert_eq(a.booked - coalesce(b.booked, 0), 1, 'items: one booked');
  perform kc_test.assert_eq(a.confirmed - coalesce(b.confirmed, 0), 1, 'items: one reached confirmation');
  perform kc_test.assert_eq(a.completed - coalesce(b.completed, 0), 1, 'items: one handed over');
  perform kc_test.assert_eq(a.closed - coalesce(b.closed, 0), 1, 'items: the handed-over one is closed');

  select * into a from funnel_after where world_slug = 'rides' and direction = 'give';
  select * into b from funnel_before where world_slug = 'rides' and direction = 'give';
  perform kc_test.assert_eq(a.published - coalesce(b.published, 0), 1, 'rides: the ride offer is published');
  perform kc_test.assert_eq(a.booked - coalesce(b.booked, 0), 1, 'rides: booked once, whatever the seat count');
  perform kc_test.assert_eq(a.confirmed - coalesce(b.confirmed, 0), 1, 'rides: a booking was confirmed');
  perform kc_test.assert_eq(a.completed - coalesce(b.completed, 0), 0, 'rides: no trip completed yet');
end $$;

-- ── 2. my_world_givings: handed-over handoffs and closed posts ────────────────────────────────
do $$
declare
  p personas;
  r record;
  v_time uuid;
  v_time_post uuid;
begin
  select * into p from personas;
  v_time := kc_test.create_listing(p.giver, 'time', 'volunteer_shift', 'give', 'tutoring',
    '{"duration_minutes":60,"skills":["tutoring"],"org_host_slug":"community"}'::jsonb);
  v_time_post := public.post_id_of_listing(v_time);
  perform kc_test.assert_true(v_time_post is not null, 'the time listing has its post');
  -- A time-world attendance lives on post_handoffs only (0563 / 0564); the listing-side reader
  -- never saw it, this one counts it.
  insert into public.post_handoffs (post_id, owner_id, recipient_id, world_slug, status, confirmed_at, handed_over_at)
  values (v_time_post, p.giver, p.taker, 'time', 'handed_over', now(), now());
  perform kc_test.assert_row_count(
    format('select 1 from public.giving_handoffs where listing_id = %L', v_time), 0,
    'a time-world handoff is not mirrored into giving_handoffs');

  perform kc_test.act_as(p.giver);
  select * into r from public.my_world_givings() where world_slug = 'items';
  perform kc_test.assert_eq(r.given, 1, 'items: the handed-over handoff is a giving');
  perform kc_test.assert_eq(r.received, 0, 'items: nothing received');
  perform kc_test.assert_eq(r.closed, 1, 'items: the closed post counts, the open post-form item does not');
  select * into r from public.my_world_givings() where world_slug = 'time';
  perform kc_test.assert_eq(r.given, 1, 'time: the attendance now counts as a giving');
  perform kc_test.assert_eq(r.closed, 0, 'time: nothing closed');

  perform kc_test.act_as(p.taker);
  select * into r from public.my_world_givings() where world_slug = 'items';
  perform kc_test.assert_eq(r.received, 1, 'items: the recipient received one');
  select * into r from public.my_world_givings() where world_slug = 'time';
  perform kc_test.assert_eq(r.received, 1, 'time: and attended one');
end $$;

-- ── 3. rides health checks: the handoff record and the ride's post ───────────────────────────
do $$
declare
  v_unconfirmed numeric := (ops.check_rides_bookings_unconfirmed()).value;
  v_not_completed numeric := (ops.check_rides_trips_not_completed()).value;
begin
  update public.post_handoffs set confirm_by = now() - interval '1 minute'
   where handoff_id = (select id from fx where k = 'ride_waiting');
  perform kc_test.assert_eq((ops.check_rides_bookings_unconfirmed()).value, v_unconfirmed + 1,
    'a booking past its confirm-by deadline is counted');

  -- The ride left two days ago according to its post (the record of the ride's details).
  update public.posts
     set details = jsonb_set(details, '{departs_at}', to_jsonb(kc_test.iso_in(interval '-2 days')))
   where post_id = public.post_id_of_listing((select id from fx where k = 'ride'));
  perform kc_test.assert_eq((ops.check_rides_trips_not_completed()).value, v_not_completed + 1,
    'a confirmed seat a day after departure is counted');
end $$;

-- ── 4. feed_ranked_ids: the sub-category filter reads the post ───────────────────────────────
do $$
declare
  p personas;
  v_listing uuid;
  v_post uuid;
begin
  select * into p from personas;
  perform kc_test.act_as(p.taker);
  v_listing := public.create_marketplace_listing(
    p_kind_id     => kc_test.listing_kind_id('items', 'give_item'),
    p_title       => 'Poetry collection',
    p_summary     => 'Hardcover, like new',
    p_details     => '{"item_condition":"Good"}'::jsonb,
    p_category_id => (select category_id from public.categories where world_slug = 'items' and slug = 'books'),
    p_lat         => 32.0853,
    p_lng         => 34.7818);
  v_post := public.post_id_of_listing(v_listing);
  perform kc_test.assert_eq((select listing_id from public.posts where post_id = v_post), v_listing,
    'the listing has a post that points at it');
  perform kc_test.assert_eq(
    (select c.slug from public.posts x join public.categories c on c.category_id = x.category_id where x.post_id = v_post),
    'books', 'the post carries the listing''s sub-category');

  perform public.refresh_feed_open_posts_mv(false);
  perform kc_test.assert_row_count(
    format($q$select 1 from public.feed_ranked_ids(%L, p_page_limit => 100, p_filter_subcategories => array['books'])
              where post_id = %L$q$, p.giver, v_post),
    1, 'newest feed: the post is found by its sub-category');
  perform kc_test.assert_row_count(
    format($q$select 1 from public.feed_ranked_ids(%L, p_sort_order => 'oldest', p_page_limit => 100,
                                                   p_filter_subcategories => array['books'])
              where post_id = %L$q$, p.giver, v_post),
    1, 'oldest feed: the post is found by its sub-category');
  perform kc_test.assert_row_count(
    format($q$select 1 from public.feed_ranked_ids(%L, p_page_limit => 100, p_filter_subcategories => array['no-such-subcategory'])
              where post_id = %L$q$, p.giver, v_post),
    0, 'another sub-category leaves it out');
end $$;

-- ── 5. reports on listings: title and owner from the post, fallback to the listing ─────────────
do $$
declare
  p personas;
  v_mirror_listing uuid := (select id from fx where k = 'item_listing');
  v_item_listing uuid := public.listing_id_of_post((select id from fx where k = 'item_post'));
  v_orphan uuid;
  v_rows jsonb;
  v_target jsonb;
begin
  select * into p from personas;
  -- A listing that is not published yet has no post (0557).
  perform kc_test.act_as(p.giver);
  insert into public.listings (owner_id, world_slug, kind_id, direction, title, origin, moderation_status, details)
  values (p.giver, 'items', kc_test.listing_kind_id('items', 'give_item'), 'give', 'Unreviewed chair',
          'native', 'pending_review', '{"item_condition":"Good"}'::jsonb)
  returning listing_id into v_orphan;
  perform kc_test.assert_true(public.post_id_of_listing(v_orphan) is null, 'the unpublished listing has no post');

  -- A report is filed by its reporter (reports_validate_before_insert: reporter_must_be_self).
  perform kc_test.act_as(p.reporter);
  -- The fixtures were handed over in section 1 and the third listing is still in review, so none
  -- can be reported now (target_already_moderated). These reports stand for ones filed while the
  -- listings were open, so the insert guard is paused for them only.
  alter table public.reports disable trigger reports_before_insert;
  insert into public.reports (reporter_id, target_type, target_id, reason)
  values (p.reporter, 'listing', v_mirror_listing, 'Spam'),
         (p.reporter, 'listing', v_item_listing, 'Spam'),
         (p.reporter, 'listing', v_orphan, 'Spam');
  alter table public.reports enable trigger reports_before_insert;

  perform kc_test.act_as(p.moderator);
  v_rows := public.reports_open_inbox(p_target_type_filter => 'listing', p_limit => 100) -> 'rows';

  select t.e -> 'target' into v_target from jsonb_array_elements(v_rows) as t(e)
   where (t.e ->> 'target_id')::uuid = v_mirror_listing;
  perform kc_test.assert_eq(v_target ->> 'preview', 'Reading lamp', 'inbox: the listing''s title, from its post');
  perform kc_test.assert_eq((v_target ->> 'owner_id')::uuid, p.giver, 'inbox: its owner');
  perform kc_test.assert_eq(v_target ->> 'status', kc_test.listing_status(v_mirror_listing), 'inbox: the listing status');
  perform kc_test.assert_eq(v_target ->> 'world_slug', 'items', 'inbox: its world');

  select t.e -> 'target' into v_target from jsonb_array_elements(v_rows) as t(e)
   where (t.e ->> 'target_id')::uuid = v_item_listing;
  perform kc_test.assert_eq(v_target ->> 'preview', 'Wooden stool', 'inbox: a post-form item''s listing resolves to the post');
  perform kc_test.assert_eq((v_target ->> 'owner_id')::uuid, p.giver, 'inbox: and its owner');

  select t.e -> 'target' into v_target from jsonb_array_elements(v_rows) as t(e)
   where (t.e ->> 'target_id')::uuid = v_orphan;
  perform kc_test.assert_eq(v_target ->> 'preview', 'Unreviewed chair', 'inbox: a listing without a post keeps its title');
  perform kc_test.assert_eq((v_target ->> 'owner_id')::uuid, p.giver, 'inbox: and its owner');

  v_target := public.reports_case_detail('listing', v_item_listing) -> 'target';
  perform kc_test.assert_eq(v_target ->> 'preview', 'Wooden stool', 'case: the title, from the post');
  perform kc_test.assert_eq((v_target ->> 'owner_id')::uuid, p.giver, 'case: the owner');
  perform kc_test.assert_true(v_target ->> 'created_at' is not null, 'case: the listing''s date');

  v_target := public.reports_case_detail('listing', v_orphan) -> 'target';
  perform kc_test.assert_eq(v_target ->> 'preview', 'Unreviewed chair', 'case: fallback to the listing without a post');
end $$;

-- ── 6. a nonprofit's public page: its money campaigns, from their posts ───────────────────────
do $$
declare
  p personas;
  v_open uuid;
  v_closed uuid;
  v_paused uuid;
  v_campaigns jsonb;
  v_campaign jsonb;
begin
  select * into p from personas;
  insert into public.organizations (org_id, name, slug, is_verified_nonprofit)
  values (p.org_id, 'Readers test nonprofit', 'readers-test-nonprofit', true);

  v_open := kc_test.create_listing(p.giver, 'money', 'financial_aid_request', 'request', 'School bags', '{}'::jsonb);
  v_closed := kc_test.create_listing(p.giver, 'money', 'financial_aid_request', 'request', 'Winter coats', '{}'::jsonb);
  v_paused := kc_test.create_listing(p.giver, 'money', 'financial_aid_request', 'request', 'Paused drive', '{}'::jsonb);
  update public.listings set beneficiary_org_id = p.org_id where listing_id in (v_open, v_closed, v_paused);
  update public.listings set status = 'closed' where listing_id = v_closed;
  update public.listings set status = 'cancelled' where listing_id = v_paused;

  v_campaigns := public.get_nonprofit_public_page('readers-test-nonprofit') -> 'campaigns';
  perform kc_test.assert_eq(jsonb_array_length(v_campaigns), 2, 'the open and the closed campaign, not the paused one');

  select t.e into v_campaign from jsonb_array_elements(v_campaigns) as t(e) where (t.e ->> 'listing_id')::uuid = v_open;
  perform kc_test.assert_eq(v_campaign ->> 'title', 'School bags', 'the campaign is listed by its listing id with its title');
  perform kc_test.assert_eq(v_campaign ->> 'status', 'open', 'an open campaign');
  perform kc_test.assert_true(v_campaign ->> 'published_at' is not null, 'with its publication date');

  select t.e into v_campaign from jsonb_array_elements(v_campaigns) as t(e) where (t.e ->> 'listing_id')::uuid = v_closed;
  perform kc_test.assert_eq(v_campaign ->> 'status', 'closed', 'a closed campaign keeps the listing status word');
end $$;

rollback;

\echo '✓ 0565_g1_readers_reports_on_posts.sql passed'
