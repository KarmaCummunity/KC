-- supabase/tests/0560_listing_detail_feed_hidden.sql | 0560 (G1 step 4a, D-218): the listing
-- detail returns its post id and whether the main feed lists that post, so the app can open the
-- post as the one detail screen and still offer "share to feed" for a post kept out of the feed.

begin;

create temp table personas as
select kc_test.create_user('fd_mentor') as mentor,
       kc_test.create_user('fd_giver')  as giver,
       kc_test.create_user('fd_viewer') as viewer;

-- Knowledge publishes only for a verified identity (worlds.requires_verification).
update public.users set verified_at = now() where user_id = (select mentor from personas);

-- ── T1 a knowledge offer is listed from publication (0613) ─────────────────────────────────
do $$
declare
  p personas;
  v_listing uuid;
  d jsonb;
begin
  select * into p from personas;
  v_listing := kc_test.create_listing(p.mentor, 'knowledge', 'course', 'give', 'intro to sql',
    jsonb_build_object(
      'topic', 'SQL', 'level', 'beginner', 'modality', 'video', 'slots_available', 2,
      'slot_starts_at', kc_test.iso_in(interval '1 day'),
      'slot_ends_at', kc_test.iso_in(interval '1 day 2 hours')));
  -- Knowledge listings start in pending_review (0266); simulate the moderator's approval.
  update public.listings set moderation_status = 'published' where listing_id = v_listing;

  perform kc_test.act_as(p.viewer);
  d := public.get_marketplace_listing_detail(v_listing);
  perform kc_test.assert_eq(d ->> 'feed_post_id', public.post_id_of_listing(v_listing)::text,
    'the detail carries the listing''s post id');
  perform kc_test.assert_eq((d ->> 'feed_hidden')::boolean, false, 'and says the feed lists it');
end $$;

-- ── T1b a later ride occurrence is kept out of the feed until shared ────────────────────────
do $$
declare
  p personas;
  v_series uuid;
  v_first uuid;
  v_later uuid;
  d jsonb;
begin
  select * into p from personas;
  perform kc_test.act_as(p.giver);
  select r.series_id into v_series
    from public.create_ride_series(
      kc_test.listing_kind_id('rides', 'ride_offer'), 'Tel Aviv to Jerusalem',
      kc_test.ride_route_tlv_jlm() || jsonb_build_object('seats_available', 3), 'give',
      ((now() + interval '2 hours') at time zone 'Asia/Jerusalem')::time, 127, null, 60, null) r;
  select l.listing_id into v_first from public.listings l
   where l.details -> 'ride_series' ->> 'id' = v_series::text and l.status = 'open'
   order by (l.details ->> 'departs_at')::timestamptz limit 1;
  select l.listing_id into v_later from public.listings l
   where l.details -> 'ride_series' ->> 'id' = v_series::text and l.status = 'open'
     and l.listing_id <> v_first
   order by (l.details ->> 'departs_at')::timestamptz limit 1;

  perform kc_test.act_as(p.viewer);
  d := public.get_marketplace_listing_detail(v_later);
  perform kc_test.assert_eq(d ->> 'feed_post_id', public.post_id_of_listing(v_later)::text,
    'the detail carries the later occurrence''s post id');
  perform kc_test.assert_eq((d ->> 'feed_hidden')::boolean, true, 'and says the feed does not list it yet');

  perform kc_test.act_as(p.giver);
  perform public.share_listing_to_feed(v_later);
  perform kc_test.act_as(p.viewer);
  perform kc_test.assert_eq((public.get_marketplace_listing_detail(v_later) ->> 'feed_hidden')::boolean, false,
    'once shared, the feed lists it');
end $$;

-- ── T2 an item listing is listed from publication ──────────────────────────────────────────
do $$
declare
  p personas;
  v_listing uuid;
  d jsonb;
begin
  select * into p from personas;
  perform kc_test.act_as(p.giver);
  v_listing := public.create_marketplace_listing(
    p_kind_id => kc_test.listing_kind_id('items', 'give_item'), p_title => 'a lamp',
    p_details => '{"item_condition":"Good"}'::jsonb, p_city_id => 'tel-aviv');
  perform kc_test.act_as(p.viewer);
  d := public.get_marketplace_listing_detail(v_listing);
  perform kc_test.assert_true(d ->> 'feed_post_id' is not null, 'an item listing has its post');
  perform kc_test.assert_eq((d ->> 'feed_hidden')::boolean, false, 'listed in the feed');
end $$;

rollback;
\echo '✓ 0560_listing_detail_feed_hidden.sql passed'
