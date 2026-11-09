-- supabase/tests/0700_listing_detail_legacy_listing_id.sql | 0700 (KC#2032, FR-POST-014..018,
-- FR-FEED-001): a feed card opens its post. Posts created before G1 step 6d keep the id their
-- listing had in `posts.listing_id`; the app opens the detail with that id, so the detail reader
-- must resolve it to the post, exactly as it resolves the post id.

begin;

create temp table personas as
select kc_test.create_user('detail_giver') as giver,
       kc_test.create_user('detail_viewer') as viewer;

do $$
declare
  p personas;
  v_post uuid;
  v_old_listing uuid := gen_random_uuid();
  v_by_post jsonb;
  v_by_old jsonb;
begin
  select * into p from personas;
  v_post := kc_test.create_listing(p.giver, 'items', 'give_item', 'give', 'Detail lamp',
    '{"item_condition":"Good","fulfillment_mode":"owner_approval"}'::jsonb);
  -- A post that predates step 6d: its former listing id lives in posts.listing_id.
  update public.posts set listing_id = v_old_listing where post_id = v_post;

  perform kc_test.act_as(p.viewer);
  v_by_post := public.get_marketplace_listing_detail(v_post);
  v_by_old := public.get_marketplace_listing_detail(v_old_listing);

  perform kc_test.assert_eq(v_by_post->>'title', 'Detail lamp', 'the post id opens the detail');
  perform kc_test.assert_eq(v_by_old->>'title', 'Detail lamp', 'the former listing id opens the same detail');
  perform kc_test.assert_eq(v_by_old->>'feed_post_id', v_post::text, 'the detail names the post it belongs to');
  perform kc_test.assert_eq(public.handoff_target_listing_id(v_old_listing)::text, v_post::text,
    'a former listing id resolves to the post');
  perform kc_test.assert_eq(public.handoff_target_listing_id(v_post)::text, v_post::text,
    'a post id still resolves to itself');
  perform kc_test.assert_true(public.handoff_target_listing_id(gen_random_uuid()) is null,
    'an unknown id resolves to nothing');
end $$;

rollback;

\echo '✓ 0700_listing_detail_legacy_listing_id.sql passed'
