-- #1468: knowledge subcategories are seeded, writable on a listing, and browse-filterable.
begin;

select kc_test.create_user('k1468_owner') as owner \gset
select kc_test.create_user('k1468_viewer') as viewer \gset
update public.users
   set verified_at = now(), privacy_mode = 'Public'
 where user_id = :'owner';

select kc_test.assert_eq(
  (select count(*)::int from public.categories
    where world_slug = 'knowledge' and slug in
      ('science_technology', 'history_heritage', 'culture_art', 'spirituality_philosophy')),
  4, 'all four knowledge subcategories exist');
select kc_test.assert_eq(
  (select count(*)::int from public.categories
    where world_slug = 'knowledge' and coalesce(label_he, '') <> '' and slug in
      ('science_technology', 'history_heritage', 'culture_art', 'spirituality_philosophy')),
  4, 'every knowledge subcategory has a Hebrew label');
select kc_test.assert_eq((select label_en from public.categories where world_slug='knowledge' and slug='science_technology'),
  'Science & technology'::text, 'science & technology English label');
select kc_test.assert_eq((select label_en from public.categories where world_slug='knowledge' and slug='history_heritage'),
  'History & heritage'::text, 'history & heritage English label');
select kc_test.assert_eq((select label_en from public.categories where world_slug='knowledge' and slug='culture_art'),
  'Culture & art'::text, 'culture & art English label');
select kc_test.assert_eq((select label_en from public.categories where world_slug='knowledge' and slug='spirituality_philosophy'),
  'Spirituality & philosophy'::text, 'spirituality & philosophy English label');

do $$
declare
  v_category uuid := (select category_id from public.categories where world_slug='knowledge' and slug='science_technology');
  v_listing uuid;
  v_seen uuid;
  v_owner uuid := (select user_id from public.users where share_handle='k1468_owner');
  v_viewer uuid := (select user_id from public.users where share_handle='k1468_viewer');
begin
  perform kc_test.act_as(v_owner);
  -- #2034 retired the `course` kind; a lesson offer is the knowledge post with slots now.
  v_listing := public.create_marketplace_listing(
    p_kind_id => (select kind_id from public.listing_kinds where world_slug='knowledge' and slug='lesson_offer'),
    p_title => 'Intro to science',
    p_details => jsonb_build_object(
      'topic', 'Science', 'modality', 'video', 'capacity_per_slot', 1,
      'slots', jsonb_build_array(jsonb_build_object(
        'starts_at', to_char((now() + interval '1 day') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'ends_at', to_char((now() + interval '1 day 1 hour') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')))),
    p_category_id => v_category,
    p_lat => 32.0853,
    p_lng => 34.7818
  );
  perform kc_test.assert_eq((select category_id from public.listings where listing_id=v_listing),
    v_category, 'knowledge listing stores its selected subcategory');

  -- Knowledge listings require moderator review: the insert trigger forces pending_review,
  -- which browse_listings intentionally excludes. No listing approval RPC exists yet, so
  -- simulate the post-approval state as the postgres test harness, then browse as another user.
  perform kc_test.assert_eq((select moderation_status from public.listings where listing_id=v_listing),
    'pending_review'::text, 'new knowledge listing waits for moderator approval');
  update public.listings set moderation_status='published' where listing_id=v_listing;
  perform kc_test.act_as(v_viewer);

  select b.listing_id into v_seen
    from public.browse_listings(p_world_slug=>'knowledge', p_viewer=>auth.uid(), p_category_id=>v_category) b
   where b.listing_id=v_listing;
  perform kc_test.assert_eq(v_seen, v_listing, 'browse_listings returns the knowledge listing filtered by p_category_id');
end $$;

rollback;
\echo '✓ 0535_knowledge_subcategories.sql passed'
