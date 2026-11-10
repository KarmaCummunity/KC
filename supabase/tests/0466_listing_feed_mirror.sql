-- supabase/tests/0466_listing_feed_mirror.sql | 0466 (KC#1101 / KC#1109, D-206): a native
-- items or food listing keeps one mirror post in the main feed that follows its edits,
-- photos, privacy, status and deletion; the manual share reuses that mirror; mirrors never
-- spawn a second listing and never count toward the open-posts cap.

begin;

create temp table personas as
select kc_test.create_user('mirror_giver')  as giver,
       kc_test.create_user('mirror_viewer') as viewer;

/** The mirror post of a listing, or null. */
create function pg_temp.mirror_of(p_listing uuid)
returns public.posts
language sql
as $$ select p from public.posts p where p.listing_id = p_listing $$;

/** Whether the newest feed, as seen by p_viewer, lists the given post. The newest path
    reads the open-posts materialized view, which the cron refreshes; refresh it here. */
create function pg_temp.in_feed(p_viewer uuid, p_post uuid)
returns boolean
language plpgsql
as $$
begin
  perform public.refresh_feed_open_posts_mv(false);
  return exists (
    select 1 from public.feed_ranked_ids(p_viewer, p_page_limit => 100) f where f.post_id = p_post
  );
end $$;

/** An items "give" listing created through the app's RPC. */
create function pg_temp.create_item(p_owner uuid, p_title text, p_media text[] default null)
returns uuid
language plpgsql
as $$
begin
  perform kc_test.act_as(p_owner);
  return public.create_marketplace_listing(
    p_kind_id     => kc_test.listing_kind_id('items', 'give_item'),
    p_title       => p_title,
    p_summary     => 'Solid oak, two shelves',
    p_details     => '{"item_condition":"Good"}'::jsonb,
    p_category_id => (select category_id from public.categories where world_slug = 'items' and slug = 'books'),
    p_lat         => 32.0853,
    p_lng         => 34.7818,
    p_media_paths => p_media
  );
end $$;

-- 1) Publishing an items listing puts one mirror post in the feed.
do $$
declare
  p personas;
  v_listing uuid;
  v_mirror public.posts;
  v_shared uuid;
  v_i integer;
  v_post uuid;
  v_posts_before integer;
  v_karma_before integer;
begin
  if not exists (select 1 from pg_trigger where tgname = 'listings_feed_mirror_sync') then
    perform kc_test.assert_true(true, 'feed mirror sync tests skipped after sync triggers dropped (0666)');
    return;
  end if;

  select * into p from personas;
  v_posts_before := (select posts_created_total from public.users where user_id = (select giver from personas));
  v_karma_before := (select karma_points from public.users where user_id = (select giver from personas));
  v_listing := pg_temp.create_item(p.giver, 'Wooden bookshelf');
  v_mirror := pg_temp.mirror_of(v_listing);

  perform kc_test.assert_eq(
    (select posts_created_total from public.users where user_id = p.giver), v_posts_before,
    'a mirror is not counted as a post the giver created');
  perform kc_test.assert_eq(
    (select karma_points from public.users where user_id = p.giver), v_karma_before,
    'a mirror earns no post_created karma');
  perform kc_test.assert_row_count(
    format('select 1 from public.karma_ledger where ref_type = %L and ref_id = %L', 'post', v_mirror.post_id::text),
    0, 'no karma ledger row references the mirror');

  perform kc_test.assert_true(v_mirror.post_id is not null, 'a published items listing gets a mirror post');
  perform kc_test.assert_eq(v_mirror.owner_id, p.giver, 'the mirror belongs to the listing owner');
  perform kc_test.assert_eq(v_mirror.type, 'Give', 'give listing → Give post');
  perform kc_test.assert_eq(v_mirror.status, 'open', 'open listing → open post');
  perform kc_test.assert_eq(v_mirror.title, 'Wooden bookshelf', 'the mirror carries the listing title');
  perform kc_test.assert_eq(v_mirror.description, 'Solid oak, two shelves', 'the mirror carries the summary');
  perform kc_test.assert_eq(v_mirror.category, 'Books', 'the items subcategory maps to the legacy post category');
  perform kc_test.assert_eq(v_mirror.item_condition, 'Good', 'the listing condition maps to the post condition');
  perform kc_test.assert_row_count(
    format('select 1 from public.listing_feed_posts where listing_id = %L and post_id = %L', v_listing, v_mirror.post_id),
    1, 'the legacy share link table points at the same mirror');
  perform kc_test.assert_row_count(
    format('select 1 from public.listings where legacy_post_id = %L', v_mirror.post_id),
    0, 'the mirror post does not spawn a second listing');
  perform kc_test.assert_true(pg_temp.in_feed(p.viewer, v_mirror.post_id), 'another member sees the listing in the main feed');

  -- 2) Edits, pausing, resuming and closing the listing reach the mirror.
  v_listing := pg_temp.create_item(p.giver, 'Baby stroller');
  v_mirror := pg_temp.mirror_of(v_listing);

  perform kc_test.act_as(p.giver);
  perform public.update_my_listing(v_listing, p_title => 'Baby stroller, folds flat', p_summary => 'Used one season');
  v_mirror := pg_temp.mirror_of(v_listing);
  perform kc_test.assert_eq(v_mirror.title, 'Baby stroller, folds flat', 'a title edit updates the mirror');
  perform kc_test.assert_eq(v_mirror.description, 'Used one season', 'a summary edit updates the mirror');

  perform public.pause_my_listing(v_listing);
  v_mirror := pg_temp.mirror_of(v_listing);
  perform kc_test.assert_eq(v_mirror.status, 'paused', 'a paused listing is a paused post (0551), out of the feed');
  perform kc_test.assert_true(not pg_temp.in_feed(p.viewer, v_mirror.post_id), 'the paused mirror is not in the feed');

  perform public.resume_my_listing(v_listing);
  v_mirror := pg_temp.mirror_of(v_listing);
  perform kc_test.assert_eq(v_mirror.status, 'open', 'a resumed listing is back in the feed');
  perform kc_test.assert_true(pg_temp.in_feed(p.viewer, v_mirror.post_id), 'the resumed mirror is in the feed again');

  update public.listings set status = 'closed' where listing_id = v_listing;
  v_mirror := pg_temp.mirror_of(v_listing);
  perform kc_test.assert_eq(v_mirror.status, 'closed_delivered', 'a closed listing closes its mirror');
  perform kc_test.assert_row_count(
    format('select 1 from public.karma_ledger where ref_type = %L and ref_id = %L', 'post', v_mirror.post_id::text),
    0, 'closing the mirror awards no post closure karma; the handoff does that');

  -- 3) Changing the listing's anonymity changes the mirror's visibility the same way.
  v_listing := pg_temp.create_item(p.giver, 'Desk lamp');
  v_mirror := pg_temp.mirror_of(v_listing);
  perform kc_test.assert_eq(v_mirror.visibility, 'Public', 'an items listing is public by default');

  update public.listings set anonymity_level = 1 where listing_id = v_listing;
  v_mirror := pg_temp.mirror_of(v_listing);
  perform kc_test.assert_eq(v_mirror.visibility, 'OnlyMe', 'the mirror follows the listing into privacy');
  perform kc_test.assert_true(not pg_temp.in_feed(p.viewer, v_mirror.post_id), 'a private mirror is hidden from others');

  update public.listings set anonymity_level = 3 where listing_id = v_listing;
  v_mirror := pg_temp.mirror_of(v_listing);
  perform kc_test.assert_eq(v_mirror.visibility, 'Public', 'the mirror follows the listing back to public');
  perform kc_test.assert_true(pg_temp.in_feed(p.viewer, v_mirror.post_id), 'a public mirror is back in the feed');

  -- 4) The listing's photos are the mirror's photos.
  insert into storage.objects (bucket_id, name, metadata)
  values ('listing-images', p.giver || '/b1/0.jpg', '{"size": 4321, "mimetype": "image/jpeg"}'::jsonb),
         ('listing-images', p.giver || '/b1/1.jpg', '{"size": 1234, "mimetype": "image/jpeg"}'::jsonb);

  v_listing := pg_temp.create_item(p.giver, 'Kitchen table',
    array[p.giver || '/b1/0.jpg', p.giver || '/b1/1.jpg', p.giver || '/b1/missing.jpg']);
  v_mirror := pg_temp.mirror_of(v_listing);

  perform kc_test.assert_row_count(
    format($q$ select 1 from public.media_assets
              where post_id = %L and bucket = 'listing-images' $q$, v_mirror.post_id),
    2, 'both uploaded photos are mirrored, the missing one is not');
  perform kc_test.assert_eq(
    (select path from public.media_assets where post_id = v_mirror.post_id and ordinal = 0),
    p.giver || '/b1/0.jpg', 'the first listing photo is the mirror cover');
  perform kc_test.assert_eq(
    (select size_bytes from public.media_assets where post_id = v_mirror.post_id and ordinal = 0),
    4321, 'the mirrored photo keeps its real size');

  perform kc_test.act_as(p.giver);
  perform public.attach_listing_media(v_listing, array[p.giver || '/b1/1.jpg']);
  perform kc_test.assert_eq(
    (select path from public.media_assets where post_id = v_mirror.post_id and ordinal = 0),
    p.giver || '/b1/1.jpg', 'a photo change resyncs the mirror cover');
  perform kc_test.assert_row_count(
    format('select 1 from public.media_assets where post_id = %L', v_mirror.post_id),
    1, 'removed photos leave the mirror');

  -- 5) The manual share returns the existing mirror.
  v_listing := pg_temp.create_item(p.giver, 'Board games');
  v_mirror := pg_temp.mirror_of(v_listing);

  perform kc_test.act_as(p.giver);
  v_shared := public.share_listing_to_feed(v_listing);
  perform kc_test.assert_eq(v_shared, v_mirror.post_id, 'share to feed returns the existing mirror');
  perform kc_test.assert_eq(public.share_listing_to_feed(v_listing), v_mirror.post_id, 'sharing again is idempotent');
  perform kc_test.assert_row_count(
    format('select 1 from public.posts where listing_id = %L', v_listing), 1, 'exactly one mirror per listing');
  perform kc_test.assert_eq(
    (public.get_marketplace_listing_detail(v_listing) ->> 'feed_post_id')::uuid, v_mirror.post_id,
    'the listing detail names its feed post');

  perform kc_test.act_as(p.viewer);
  perform kc_test.assert_raises(
    format('select public.share_listing_to_feed(%L)', v_listing), 'forbidden',
    'only the owner may share a listing to the feed');

  -- 6) A world without feed_mirror gets no automatic mirror, but owner may share.
  update public.worlds set feed_mirror = false where slug = 'time';
  v_listing := kc_test.create_listing(p.giver, 'time', 'volunteer_shift', 'give', 'Tutoring hour', '{"duration_minutes": 60}'::jsonb);
  perform kc_test.assert_true((pg_temp.mirror_of(v_listing)).feed_hidden, 'a listing of a world without feed_mirror gets a post hidden from the feed');

  perform kc_test.act_as(p.giver);
  v_shared := public.share_listing_to_feed(v_listing);
  v_mirror := pg_temp.mirror_of(v_listing);
  perform kc_test.assert_eq(v_mirror.post_id, v_shared, 'a manual share exposes that same post for any world');
  perform kc_test.assert_true(not v_mirror.feed_hidden, 'and the shared post is listed in the feed');
  perform kc_test.assert_eq(v_mirror.category, 'Other', 'a world without the items tree maps to Other');

  for v_i in 1..25 loop
    perform pg_temp.create_item(p.giver, format('Mug %s', v_i));
  end loop;
  perform kc_test.assert_row_count(
    format('select 1 from public.posts where owner_id = %L and listing_id is not null and status = %L', p.giver, 'open'),
    (select count(*) from public.listings l where l.owner_id = p.giver and l.status = 'open' and l.origin = 'native'),
    'every open native listing of the giver has an open mirror');

  -- 7) Deleting the listing deletes its mirror.
  v_listing := pg_temp.create_item(p.giver, 'Old radio');
  v_post := (pg_temp.mirror_of(v_listing)).post_id;
  delete from public.listings where listing_id = v_listing;
  perform kc_test.assert_row_count(
    format('select 1 from public.posts where post_id = %L', v_post), 0, 'the mirror goes with its listing');

  insert into public.posts (owner_id, type, title, category, city, street, street_number)
  values (p.giver, 'Give', 'Plain feed post', 'Other', 'tel-aviv', 'Herzl', '1')
  returning post_id into v_post;
  perform kc_test.assert_row_count(
    format('select 1 from public.listings where legacy_post_id = %L and origin = %L', v_post, 'post'),
    case when exists (select 1 from pg_trigger where tgname = 'posts_sync_listing') then 1 else 0 end,
    'a plain post syncs into the marketplace only while sync triggers are active');
  perform kc_test.assert_row_count(
    format('select 1 from public.posts where listing_id = (select listing_id from public.listings where legacy_post_id = %L)', v_post),
    0, 'a post-origin listing is never mirrored back into the feed');
end $$;

rollback;

\echo '✓ supabase/tests/0466_listing_feed_mirror.sql passed'
