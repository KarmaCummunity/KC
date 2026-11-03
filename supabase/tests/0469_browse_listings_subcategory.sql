-- 0469 (KC#1102 / KC#1111) — browse_listings filters by world subcategory, with and without a
-- distance anchor; no subcategory keeps the whole world.

begin;

create or replace function pg_temp.assert(p_cond boolean, p_msg text)
returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'ASSERT FAILED: %', p_msg; end if;
end $$;

create or replace function pg_temp.mk_user(p_handle text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, aud, role)
  values (v_id, p_handle || '@test.local', now(), jsonb_build_object('full_name', p_handle),
          jsonb_build_object('provider', 'email'), 'authenticated', 'authenticated');
  update public.users
     set share_handle = p_handle, account_status = 'active', onboarding_state = 'completed',
         privacy_mode = 'Public'
   where user_id = v_id;
  return v_id;
end $$;

/** An open, public items "give" listing in the given subcategory, created through the app's RPC. */
create or replace function pg_temp.mk_item(p_owner uuid, p_title text, p_category uuid)
returns uuid language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_owner::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_owner::text, true);
  return public.create_marketplace_listing(
    p_kind_id     => (select kind_id from public.listing_kinds where world_slug = 'items' and slug = 'give_item'),
    p_title       => p_title,
    p_details     => '{"item_condition":"Good","image_url":"https://example.test/i.jpg"}'::jsonb,
    p_category_id => p_category,
    p_lat         => 32.0853,
    p_lng         => 34.7818
  );
end $$;

do $$
declare
  v_books   uuid := (select category_id from public.categories where world_slug = 'items' and slug = 'books');
  v_toys    uuid := (select category_id from public.categories where world_slug = 'items' and slug = 'toys');
  v_bakery  uuid := (select category_id from public.categories where world_slug = 'food' and slug = 'bakery');
  v_owner   uuid := pg_temp.mk_user('b465_owner');
  v_viewer  uuid := pg_temp.mk_user('b465_viewer');
  v_novel   uuid;
  v_robot   uuid;
  v_ids     uuid[];
begin
  perform pg_temp.assert(v_books is not null and v_toys is not null and v_bakery is not null,
    'seed is missing the items/books, items/toys or food/bakery subcategory');
  v_novel := pg_temp.mk_item(v_owner, 'Novel set', v_books);
  v_robot := pg_temp.mk_item(v_owner, 'Toy robot', v_toys);

  -- T1: no anchor — the subcategory narrows the world; none keeps both.
  select array_agg(b.listing_id) into v_ids
    from public.browse_listings(p_world_slug => 'items', p_limit => 50, p_viewer => v_viewer,
                                p_category_id => v_books) b;
  perform pg_temp.assert(v_novel = any(v_ids), 'the books listing is missing under books');
  perform pg_temp.assert(not (v_robot = any(v_ids)), 'the toys listing leaked into books');

  select array_agg(b.listing_id) into v_ids
    from public.browse_listings(p_world_slug => 'items', p_limit => 50, p_viewer => v_viewer) b;
  perform pg_temp.assert(v_novel = any(v_ids) and v_robot = any(v_ids), 'no subcategory must keep the whole world');

  -- T2: with a distance anchor — the same filter applies on the nearest-first path.
  select array_agg(b.listing_id) into v_ids
    from public.browse_listings(p_world_slug => 'items', p_lat => 32.0853, p_lng => 34.7818, p_radius_km => 5,
                                p_limit => 50, p_viewer => v_viewer, p_category_id => v_toys) b;
  perform pg_temp.assert(v_robot = any(v_ids), 'the toys listing is missing on the distance path');
  perform pg_temp.assert(not (v_novel = any(v_ids)), 'the books listing leaked into toys on the distance path');

  -- T3: another world's subcategory matches none of the items listings.
  select coalesce(array_agg(b.listing_id), array[]::uuid[]) into v_ids
    from public.browse_listings(p_world_slug => 'items', p_limit => 50, p_viewer => v_viewer,
                                p_category_id => v_bakery) b;
  perform pg_temp.assert(not (v_novel = any(v_ids) or v_robot = any(v_ids)),
    'a food subcategory returned items listings');

  raise notice '✓ T1-T3 browse by world subcategory, with and without a distance anchor';
end $$;

rollback;

\echo '✓ 0469_browse_listings_subcategory.sql passed'
