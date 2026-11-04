-- supabase/tests/0462_listing_world_subcategory_guard.sql | 0462 (KC#1296): the create RPC keeps
-- the world subcategory the giver picked, and a subcategory from another world is rejected.

begin;

create or replace function pg_temp.as_user(p_user uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
end $$;

do $$
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, aud, role)
  values ('00000000-0000-0000-0000-0000046200a1', 'subcat_giver@test.local', now(),
          '{"full_name":"Subcategory giver"}', '{"provider":"email"}', 'authenticated', 'authenticated');
  update public.users
     set account_status = 'active', onboarding_state = 'completed', share_handle = 'subcat_giver'
   where user_id = '00000000-0000-0000-0000-0000046200a1';
end $$;

/** An items "give" listing created through the app's RPC with the given subcategory. */
create or replace function pg_temp.create_item(p_category uuid)
returns uuid language plpgsql as $$
begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000046200a1');
  return public.create_marketplace_listing(
    p_kind_id     => (select kind_id from public.listing_kinds where world_slug = 'items' and slug = 'give_item'),
    p_title       => 'Wooden bookshelf',
    p_details     => '{"item_condition":"Good","image_url":"https://example.test/i.jpg"}'::jsonb,
    p_category_id => p_category,
    p_lat         => 32.0853,
    p_lng         => 34.7818
  );
end $$;

-- ── a subcategory of the listing's world is kept ───────────────────────────
do $$
declare
  v_books   uuid := (select category_id from public.categories where world_slug = 'items' and slug = 'books');
  v_listing uuid := pg_temp.create_item(v_books);
begin
  if v_books is null then
    raise exception 'ASSERT FAILED: seed is missing the items/books subcategory';
  end if;
  if (select category_id from public.listings where listing_id = v_listing) is distinct from v_books then
    raise exception 'ASSERT FAILED: the picked world subcategory must be stored';
  end if;
end $$;

-- ── no subcategory stays allowed ───────────────────────────────────────────
do $$
declare
  v_listing uuid := pg_temp.create_item(null);
begin
  if (select category_id from public.listings where listing_id = v_listing) is not null then
    raise exception 'ASSERT FAILED: a listing without a subcategory must keep it null';
  end if;
end $$;

-- ── a subcategory of another world is rejected, on create and on update ────
do $$
declare
  v_food_category uuid := (select category_id from public.categories where world_slug = 'food' and slug = 'bakery');
  v_listing       uuid;
begin
  begin
    perform pg_temp.create_item(v_food_category);
    raise exception 'ASSERT FAILED: a food subcategory on an items listing must be rejected';
  exception when check_violation then
    if sqlerrm <> 'category_world_mismatch' then raise; end if;
  end;

  v_listing := pg_temp.create_item(null);
  begin
    update public.listings set category_id = v_food_category where listing_id = v_listing;
    raise exception 'ASSERT FAILED: switching to another world''s subcategory must be rejected';
  exception when check_violation then
    if sqlerrm <> 'category_world_mismatch' then raise; end if;
  end;
end $$;

rollback;

\echo '✓ 0462_listing_world_subcategory_guard.sql passed'
