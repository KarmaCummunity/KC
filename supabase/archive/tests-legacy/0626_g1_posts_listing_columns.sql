-- supabase/tests/0626_g1_posts_listing_columns.sql | 0626 (G1 step 6a-5b, issue #1671): `posts`
-- carries the listing columns its readers still take from `listings` (moderation_status,
-- availability_status, kind_id, published_at, max_radius_km_override, legacy_listing_id).
--   1. a post-owned ride from the create RPC carries its listing's values, and an owner edit of
--      availability or radius reaches the post; a change on the post reaches the listing;
--   2. the mirror post of a directly inserted listing carries them and follows the listing;
--   3. an items post links its listing through legacy_listing_id while listing_id stays null;
--   4. a knowledge listing's post takes publication and moderation from its listing;
--   5. a moderation change on a post-owned listing reaches the post;
--   6. the unification report finds no listing-column mismatch.
-- Runs in a rolled-back transaction.

begin;

create temp table personas as
select kc_test.create_user('lc_driver')  as driver,
       kc_test.create_user('lc_giver')   as giver,
       kc_test.create_user('lc_mentor')  as mentor;

-- Knowledge publishes only for a verified identity (worlds.requires_verification).
update public.users set verified_at = now() where user_id = (select mentor from personas);

/** The post of listing p_listing, either shape (fails when there is none). */
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
-- 0520: pg_temp helpers are called after act_as, so they need an explicit grant.
grant execute on function pg_temp.post_of(uuid) to public;

create function pg_temp.listing(p_listing uuid)
returns public.listings
language sql
as $$ select l from public.listings l where l.listing_id = p_listing $$;
grant execute on function pg_temp.listing(uuid) to public;

/** Asserts that the post of p_listing carries every new column as its listing holds it. */
create function pg_temp.assert_columns_match(p_listing uuid, p_what text)
returns void
language plpgsql
as $$
declare
  l public.listings := pg_temp.listing(p_listing);
  po public.posts := pg_temp.post_of(p_listing);
begin
  perform kc_test.assert_eq(po.legacy_listing_id, l.listing_id, p_what || ': legacy_listing_id is its listing');
  perform kc_test.assert_eq(po.kind_id, l.kind_id, p_what || ': kind_id');
  perform kc_test.assert_eq(po.published_at, l.published_at, p_what || ': published_at');
  perform kc_test.assert_eq(po.moderation_status, l.moderation_status, p_what || ': moderation_status');
  perform kc_test.assert_eq(po.availability_status, l.availability_status, p_what || ': availability_status');
  perform kc_test.assert_eq(po.max_radius_km_override, l.max_radius_km_override, p_what || ': max_radius_km_override');
end $$;
grant execute on function pg_temp.assert_columns_match(uuid, text) to public;

-- ── T1 a post-owned ride carries its listing's columns, both directions ─────────────────────
do $$
declare
  p personas;
  v_listing uuid;
  po public.posts;
begin
  select * into p from personas;
  perform kc_test.act_as(p.driver);
  v_listing := public.create_marketplace_listing(
    p_kind_id             => kc_test.listing_kind_id('rides', 'ride_offer'),
    p_title               => 'Tel Aviv to Jerusalem',
    p_details             => kc_test.ride_route_tlv_jlm()
                             || jsonb_build_object('departs_at', kc_test.iso_in(interval '3 hours'), 'seats_available', 3),
    p_city_id             => 'tel-aviv',
    p_availability_status => 'scheduled',
    p_max_radius_km       => 12.5);
  -- post_id_of_listing is STABLE: read the post in a statement after the one that created it.
  po := pg_temp.post_of(v_listing);

  perform kc_test.assert_eq(po.listing_id, v_listing, 'the post of a listing world keeps listing_id');
  perform kc_test.assert_eq(po.kind_id, kc_test.listing_kind_id('rides', 'ride_offer'), 'the post knows its kind');
  perform kc_test.assert_true(po.published_at is not null, 'the post knows when it was published');
  perform kc_test.assert_eq(po.moderation_status, 'published', 'the post is published like its listing');
  perform kc_test.assert_eq(po.availability_status, 'scheduled', 'the availability set on the listing reached the post');
  perform kc_test.assert_eq(po.max_radius_km_override, 12.5::numeric, 'the radius set on the listing reached the post');
  perform pg_temp.assert_columns_match(v_listing, 'create');

  perform public.update_my_listing(v_listing, p_max_radius_km => 20, p_availability_status => 'immediate');
  perform kc_test.assert_eq((pg_temp.post_of(v_listing)).availability_status, 'immediate', 'an owner edit of availability reaches the post');
  perform kc_test.assert_eq((pg_temp.post_of(v_listing)).max_radius_km_override, 20::numeric, 'an owner edit of the radius reaches the post');
  perform pg_temp.assert_columns_match(v_listing, 'edit');

  -- The post is the record: a change written on it reaches the derived listing.
  if exists (select 1 from pg_trigger where tgname = 'posts_sync_listing') then
    update public.posts set availability_status = 'ongoing', max_radius_km_override = null where post_id = po.post_id;
    perform kc_test.assert_eq((pg_temp.listing(v_listing)).availability_status, 'ongoing', 'the post pushes availability to its listing');
    perform kc_test.assert_eq((pg_temp.listing(v_listing)).max_radius_km_override, null::numeric, 'the post pushes the radius to its listing');
    perform pg_temp.assert_columns_match(v_listing, 'post write');
  end if;
end $$;

-- ── T2 the mirror post of a directly inserted listing carries the columns ──────────────────
do $$
declare
  p personas;
  v_listing uuid;
begin
  if not exists (select 1 from pg_trigger where tgname = 'listings_feed_mirror_sync') then
    return;
  end if;
  select * into p from personas;
  v_listing := kc_test.create_ride_offer(p.driver);
  perform kc_test.assert_eq((pg_temp.post_of(v_listing)).listing_id, v_listing, 'the mirror post points at its listing');
  perform pg_temp.assert_columns_match(v_listing, 'mirror');

  update public.listings set availability_status = 'immediate', max_radius_km_override = 30
   where listing_id = v_listing;
  perform kc_test.assert_eq((pg_temp.post_of(v_listing)).availability_status, 'immediate', 'the mirror follows availability');
  perform kc_test.assert_eq((pg_temp.post_of(v_listing)).max_radius_km_override, 30::numeric, 'the mirror follows the radius');
  perform pg_temp.assert_columns_match(v_listing, 'mirror after edit');
end $$;

-- ── T3 an items post links its listing; listing_id stays null ──────────────────────────────
do $$
declare
  p personas;
  v_post uuid;
  v_listing uuid;
  po public.posts;
begin
  if not exists (select 1 from pg_trigger where tgname = 'posts_sync_listing') then
    return;
  end if;
  select * into p from personas;
  perform kc_test.act_as(p.giver);
  insert into public.posts (owner_id, type, title, category, city, street, street_number)
  values (p.giver, 'Give', 'a bookshelf', 'Furniture', 'tel-aviv', 'Herzl', '1')
  returning post_id into v_post;

  select l.listing_id into v_listing from public.listings l where l.legacy_post_id = v_post;
  select * into po from public.posts where post_id = v_post;
  perform kc_test.assert_true(v_listing is not null, 'the items post derived its listing');
  perform kc_test.assert_eq(po.listing_id, null::uuid, 'an items post keeps listing_id null');
  perform kc_test.assert_eq(po.legacy_listing_id, v_listing, 'and links its listing through legacy_listing_id');
  perform kc_test.assert_eq(po.kind_id, kc_test.listing_kind_id('items', 'give_item'), 'an items offer is a give_item');
  perform pg_temp.assert_columns_match(v_listing, 'items');
end $$;

-- ── T4 a knowledge listing's post takes publication and moderation from its listing ────────
do $$
declare
  p personas;
  v_listing uuid;
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
  -- Knowledge listings start in pending_review (0266) and get a post once published (0557).
  perform kc_test.assert_eq(public.post_id_of_listing(v_listing), null::uuid, 'a pending knowledge listing has no post yet');
  update public.listings set moderation_status = 'published' where listing_id = v_listing;
  perform kc_test.assert_true((pg_temp.post_of(v_listing)).published_at is not null, 'publication stamps the post');
  perform pg_temp.assert_columns_match(v_listing, 'knowledge published');

  update public.listings set moderation_status = 'pending_review' where listing_id = v_listing;
  perform kc_test.assert_eq((pg_temp.post_of(v_listing)).moderation_status, 'pending_review', 'a moderation change reaches the mirror post');
  perform pg_temp.assert_columns_match(v_listing, 'knowledge back in review');
end $$;

-- ── T5 a moderation change on a post-owned listing reaches the post ────────────────────────
do $$
declare
  p personas;
  v_listing uuid;
begin
  if not exists (select 1 from pg_trigger where tgname = 'listings_feed_mirror_sync') then
    return;
  end if;
  select * into p from personas;
  perform kc_test.act_as(p.driver);
  v_listing := public.create_marketplace_listing(
    p_kind_id => kc_test.listing_kind_id('rides', 'ride_offer'),
    p_title   => 'Haifa to Tel Aviv',
    p_details => kc_test.ride_route_tlv_jlm()
                 || jsonb_build_object('departs_at', kc_test.iso_in(interval '4 hours'), 'seats_available', 2),
    p_city_id => 'tel-aviv');
  update public.listings set moderation_status = 'pending_review' where listing_id = v_listing;
  perform kc_test.assert_eq((pg_temp.post_of(v_listing)).moderation_status, 'pending_review', 'the moderation state flows to the post');
  perform pg_temp.assert_columns_match(v_listing, 'post-owned in review');
end $$;

-- ── T6 the unification report agrees ───────────────────────────────────────────────────────
do $$
declare
  r jsonb;
begin
  if not exists (select 1 from pg_trigger where tgname = 'listings_feed_mirror_sync') then
    return;
  end if;
  r := public.post_unification_report();
  perform kc_test.assert_true(r ? 'listing_column_mismatches', 'the report counts listing-column mismatches');
  perform kc_test.assert_eq((r ->> 'listing_column_mismatches')::int, 0, 'every post agrees with its listing');
  perform kc_test.assert_row_count(
    $q$select 1 from public.posts p
        where p.legacy_listing_id is null
          and exists (select 1 from public.listings l
                       where l.legacy_post_id = p.post_id or l.listing_id = p.listing_id)$q$,
    0, 'every post with a listing links it through legacy_listing_id');
end $$;

rollback;
\echo '✓ 0626_g1_posts_listing_columns.sql passed'
