-- supabase/tests/0741_offer_photo_required.sql | KC#2020: the server enforces the offer photo rule.
-- D132: an offer in items, food, housing or animals needs at least one photo, on create and on
-- edit (the last photo can't be removed); requests and other worlds stay photo-optional.
-- The rule is checked at commit, so every case runs `kc_test.run_commit_checks()`.

begin;

create temp table personas as
select kc_test.create_user('photo_giver') as giver,
       kc_test.create_housing_member('photo_host') as host,  -- verified: housing and animals (0264)
       kc_test.create_user('photo_other') as other;

-- A valid offer's details per photo world, as the native create form sends them.
create function pg_temp.offer_details(p_world text)
returns jsonb language sql stable as $$
  select case p_world
    when 'items' then '{"item_condition":"Good"}'::jsonb
    when 'food' then jsonb_build_object('expires_at', kc_test.iso_in(interval '2 days'))
    when 'housing' then kc_test.housing_offer_details()
    when 'animals' then '{"species":"cat"}'::jsonb
  end;
$$;

create function pg_temp.offer_kind(p_world text)
returns text language sql immutable as $$
  select case p_world
    when 'items' then 'give_item' when 'food' then 'give_food'
    when 'housing' then 'host_offer' when 'animals' then 'adoption_offer'
  end;
$$;

-- The food offer's type is its sub-category (D137).
create function pg_temp.food_category()
returns uuid language sql stable as $$
  select category_id from public.categories where world_slug = 'food' and slug = 'cooked-ready';
$$;

-- Creates an offer through the native RPC with the given photos, then runs the commit checks.
create function pg_temp.create_offer_and_commit(
  p_owner uuid, p_world text, p_media text[])
returns uuid language plpgsql as $$
declare
  v_id uuid;
begin
  perform kc_test.act_as(p_owner);
  v_id := public.create_marketplace_listing(
    p_kind_id => kc_test.listing_kind_id(p_world, pg_temp.offer_kind(p_world)),
    p_title => 'Offer in ' || p_world, p_details => pg_temp.offer_details(p_world),
    p_direction => 'give',
    p_category_id => case when p_world = 'food' then pg_temp.food_category() end,
    p_media_paths => p_media);
  perform kc_test.run_commit_checks();
  return v_id;
end;
$$;

-- An items post as the post engine sends it (SupabasePostRepository.create).
create function pg_temp.items_post(p_type text)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'type', p_type, 'visibility', 'Public', 'title', 'Engine ' || p_type, 'description', null,
    'category', 'Furniture', 'city', 'tel-aviv', 'street', 'Herzl', 'street_number', '1',
    'location_display_level', 'CityAndStreet',
    'item_condition', case when p_type = 'Give' then 'Good' end, 'urgency', null);
$$;

create function pg_temp.one_photo(p_owner uuid)
returns jsonb language sql immutable as $$
  select jsonb_build_array(jsonb_build_object(
    'path', p_owner::text || '/engine.jpg', 'mime_type', 'image/jpeg', 'size_bytes', 1000));
$$;

-- 1) create_marketplace_listing refuses a photo-less offer in every photo world.
do $$
declare
  p personas;
  v_world text;
begin
  select * into p from personas;
  foreach v_world in array array['items', 'food', 'housing', 'animals'] loop
    perform kc_test.assert_raises(
      format('select pg_temp.create_offer_and_commit(%L, %L, null)',
             case when v_world in ('housing', 'animals') then p.host else p.giver end, v_world),
      'offer_photo_required', v_world || ' offer without a photo is refused');
  end loop;

  -- Blank paths attach nothing (attach_listing_media skips them), so they are no photo either.
  perform kc_test.assert_raises(
    format('select pg_temp.create_offer_and_commit(%L, %L, array[%L])', p.giver, 'items', '  '),
    'offer_photo_required', 'an offer whose only path is blank is refused');
end $$;

-- 2) The same offers with one photo publish, through the shared harness builder.
do $$
declare
  p personas;
  v_world text;
  v_id uuid;
begin
  select * into p from personas;
  foreach v_world in array array['items', 'food', 'housing', 'animals'] loop
    v_id := kc_test.create_offer_with_photo(
      case when v_world in ('housing', 'animals') then p.host else p.giver end, v_world, pg_temp.offer_kind(v_world),
      'Photo offer in ' || v_world, pg_temp.offer_details(v_world),
      case when v_world = 'food' then pg_temp.food_category() end);
    perform kc_test.run_commit_checks();
    perform kc_test.assert_row_count(
      format('select 1 from public.listing_media where listing_id = %L', v_id), 1,
      v_world || ' offer keeps its photo');
  end loop;
end $$;

-- 3) Requests stay photo-optional; a legacy details image still counts as a photo (0351).
do $$
declare
  p personas;
begin
  select * into p from personas;
  perform kc_test.act_as(p.giver);
  perform public.create_marketplace_listing(
    p_kind_id => kc_test.listing_kind_id('items', 'request_item'), p_title => 'Need a chair',
    p_details => '{}'::jsonb, p_direction => 'request');
  perform kc_test.act_as(p.host);   -- animals needs a verified member (0264)
  perform public.create_marketplace_listing(
    p_kind_id => kc_test.listing_kind_id('animals', 'adoption_request'), p_title => 'Want a cat',
    p_details => '{"species":"cat"}'::jsonb, p_direction => 'request');
  perform kc_test.act_as(p.giver);
  perform public.create_marketplace_listing(
    p_kind_id => kc_test.listing_kind_id('items', 'give_item'), p_title => 'Lamp with details image',
    p_details => '{"image_url":"https://example.test/lamp.jpg"}'::jsonb, p_direction => 'give');
  perform kc_test.run_commit_checks();
end $$;

-- 4) The last photo of an offer can't be removed; one of two can; deleting the post cascades.
do $$
declare
  p personas;
  v_one uuid;
  v_two uuid;
begin
  select * into p from personas;
  v_one := kc_test.create_offer_with_photo(p.giver, 'items', 'give_item', 'One photo', '{"item_condition":"Good"}');
  perform kc_test.run_commit_checks();

  perform kc_test.act_as(p.giver);
  perform kc_test.assert_raises(
    format('delete from public.listing_media where listing_id = %L; select kc_test.run_commit_checks()', v_one),
    'offer_photo_required', 'deleting the last photo of an offer is refused');

  v_two := kc_test.create_offer_with_photo(p.giver, 'items', 'give_item', 'Two photos', '{"item_condition":"Good"}');
  insert into public.listing_media (listing_id, storage_path, sort_order)
  values (v_two, p.giver::text || '/second.jpg', 1);
  delete from public.listing_media where listing_id = v_two and sort_order = 1;
  perform kc_test.run_commit_checks();
  perform kc_test.assert_row_count(
    format('select 1 from public.listing_media where listing_id = %L', v_two), 1,
    'one of two photos can be removed');

  -- The owner's delete removes the photos first, then the post: the post is gone at commit.
  perform public.delete_my_listing(v_one);
  delete from public.posts where post_id = v_two;   -- cascade path
  perform kc_test.run_commit_checks();
  perform kc_test.assert_row_count(
    format('select 1 from public.posts where post_id in (%L, %L)', v_one, v_two), 0,
    'deleting an offer with its photos is allowed');
end $$;

-- 5) Items post engine: create_post_with_media writes the post and its photos atomically.
do $$
declare
  p personas;
  v_id uuid;
begin
  select * into p from personas;
  perform kc_test.act_as(p.giver);

  v_id := public.create_post_with_media(pg_temp.items_post('Give'), pg_temp.one_photo(p.giver));
  perform kc_test.run_commit_checks();
  perform kc_test.assert_row_count(
    format('select 1 from public.media_assets where post_id = %L and ordinal = 0', v_id), 1,
    'the engine offer is stored with its photo');
  perform kc_test.assert_eq(
    (select owner_id from public.posts where post_id = v_id)::text, p.giver::text, 'the caller owns the post');

  -- The payload cannot name another owner.
  v_id := public.create_post_with_media(
    pg_temp.items_post('Give') || jsonb_build_object('owner_id', p.other), pg_temp.one_photo(p.giver));
  perform kc_test.assert_eq(
    (select owner_id from public.posts where post_id = v_id)::text, p.giver::text, 'owner_id in the payload is ignored');

  perform kc_test.assert_raises(
    'select public.create_post_with_media(pg_temp.items_post(''Give''), ''[]''::jsonb); select kc_test.run_commit_checks()',
    'offer_photo_required', 'an engine offer without photos is refused');

  -- The two-request path this replaces: a direct offer insert with no photos fails at commit.
  perform kc_test.assert_raises(
    'insert into public.posts (owner_id, type, title, city, street, street_number, item_condition)
     values (auth.uid(), ''Give'', ''Direct'', ''tel-aviv'', ''Herzl'', ''1'', ''Good'');
     select kc_test.run_commit_checks()',
    'offer_photo_required', 'a direct items offer insert without photos is refused');

  v_id := public.create_post_with_media(pg_temp.items_post('Request'));
  perform kc_test.run_commit_checks();
  perform kc_test.assert_true(v_id is not null, 'an engine request needs no photo');

  perform kc_test.assert_raises(
    'select public.create_post_with_media(''[]''::jsonb)', 'invalid_post_payload', 'the post payload must be an object');

  perform kc_test.act_as_anon();
  perform kc_test.assert_raises(
    'select public.create_post_with_media(pg_temp.items_post(''Give''))', 'auth_required', 'anon cannot create');
  perform kc_test.assert_true(
    not has_function_privilege('anon', 'public.create_post_with_media(jsonb, jsonb)', 'execute'),
    'anon has no execute grant');
end $$;

-- 6) System writers are exempt, and an existing offer without photos stays editable (no backfill).
do $$
declare
  p personas;
  v_id uuid;
begin
  select * into p from personas;
  perform set_config('request.jwt.claims', '', true);   -- as the demo seed runs
  insert into public.posts (owner_id, type, title, city, street, street_number, item_condition)
  values (p.giver, 'Give', 'Legacy offer', 'tel-aviv', 'Herzl', '1', 'Good')
  returning post_id into v_id;
  perform kc_test.run_commit_checks();

  perform kc_test.act_as(p.giver);
  update public.posts set title = 'Legacy offer, edited' where post_id = v_id;
  perform kc_test.run_commit_checks();
  perform kc_test.assert_eq(
    (select title from public.posts where post_id = v_id), 'Legacy offer, edited', 'a legacy offer stays editable');
end $$;

\echo '✓ 0741_offer_photo_required.sql passed'

rollback;
