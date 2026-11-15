-- supabase/tests/0561_listing_detail_by_post.sql | 0561 (G1 step 4b, D19): the listing detail opens
-- by post id as well as by listing id, and names the listing's post — its mirror, or for an item
-- made through the post form the post it was derived from — so the post page can show the item's
-- reservation actions and the listing routes forward such an item to its post.

begin;

create temp table personas as
select kc_test.create_user('lb_giver')  as giver,
       kc_test.create_user('lb_viewer') as viewer;

-- ── T1 an item made through the post form ──────────────────────────────────────────────────
do $$
declare
  p personas;
  v_post uuid;
  v_listing uuid;
  by_post jsonb;
  by_listing jsonb;
begin
  if not exists (select 1 from pg_trigger where tgname = 'posts_sync_listing') then
    return;
  end if;
  select * into p from personas;
  perform kc_test.act_as(p.giver);
  insert into public.posts (owner_id, type, title, category, city, street, street_number)
  values (p.giver, 'Give', 'a lamp', 'Other', 'tel-aviv', 'Herzl', '1')
  returning post_id into v_post;
  select listing_id into v_listing from public.listings where legacy_post_id = v_post;
  perform kc_test.assert_true(v_listing is not null, 'the post owns a derived listing (0243)');

  perform kc_test.act_as(p.viewer);
  by_post := public.get_marketplace_listing_detail(v_post);
  by_listing := public.get_marketplace_listing_detail(v_listing);
  perform kc_test.assert_eq(by_post ->> 'listing_id', v_listing::text, 'the detail opens by the post id');
  perform kc_test.assert_eq(by_listing ->> 'listing_id', v_listing::text, 'and by the listing id');
  perform kc_test.assert_eq(by_post ->> 'feed_post_id', v_post::text, 'it names the post the item was made as');
  perform kc_test.assert_eq((by_post ->> 'feed_hidden')::boolean, false, 'which the feed lists');
  perform kc_test.assert_eq(by_post ->> 'world_slug', 'items', 'in the items world');
end $$;

-- ── T2 a listing with a mirror post opens by either id the same way ────────────────────────
do $$
declare
  p personas;
  v_listing uuid;
  v_post uuid;
begin
  select * into p from personas;
  perform kc_test.act_as(p.giver);
  v_listing := public.create_marketplace_listing(
    p_kind_id => kc_test.listing_kind_id('food', 'give_food'), p_title => 'soup',
    p_details => jsonb_build_object('food_type', 'cooked', 'expires_at', kc_test.iso_in(interval '6 hours')),
    p_city_id => 'tel-aviv');
  v_post := public.post_id_of_listing(v_listing);

  perform kc_test.act_as(p.viewer);
  perform kc_test.assert_eq(public.get_marketplace_listing_detail(v_post) ->> 'listing_id', v_listing::text,
    'a listing-world post opens its listing''s detail');
  perform kc_test.assert_eq(public.get_marketplace_listing_detail(v_listing) ->> 'feed_post_id', v_post::text,
    'and the listing names that post');
  perform kc_test.assert_true(public.get_marketplace_listing_detail(gen_random_uuid()) is null,
    'an id that is neither a post nor a listing finds nothing');
end $$;

rollback;
\echo '✓ 0561_listing_detail_by_post.sql passed'
