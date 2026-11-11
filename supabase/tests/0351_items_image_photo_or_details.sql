-- supabase/tests/0351_items_image_photo_or_details.sql | the items offer image rule across its history:
-- 0351 required a photo or a details image, 0357 dropped it, and 0741 (D132, KC#2020) restored it
-- for offers in items, food, housing and animals. Full coverage of 0741: 0741_offer_photo_required.sql.

begin;

create or replace function pg_temp.mk_user(p_id uuid, p_handle text)
returns void language plpgsql as $$
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, aud, role)
  values (p_id, p_handle || '@test.local', now(),
          jsonb_build_object('full_name', 'Display ' || p_handle),
          jsonb_build_object('provider', 'email'),
          'authenticated', 'authenticated');
  update public.users
     set share_handle = p_handle, display_name = 'Display ' || p_handle,
         account_status = 'active', privacy_mode = 'Public'
   where user_id = p_id;
end $$;

select pg_temp.mk_user('00000000-0000-0000-0000-000000351001', 'items_photo');
select set_config('request.jwt.claims',
  jsonb_build_object('sub', '00000000-0000-0000-0000-000000351001', 'role', 'authenticated')::text, true);

-- 1) RPC with an attached photo (no image in details) succeeds.
do $$
declare
  v_kind uuid;
  v_id uuid;
  v_n int;
begin
  select kind_id into v_kind from public.listing_kinds where world_slug = 'items' and slug = 'give_item';
  v_id := public.create_marketplace_listing(
    p_kind_id => v_kind, p_title => 'Chair with photo', p_details => '{"item_condition":"Good"}'::jsonb,
    p_media_paths => array['00000000-0000-0000-0000-000000351001/chair.jpg']);
  execute 'set constraints all immediate';   -- fire the deferred image check now
  execute 'set constraints all deferred';
  select count(*) into v_n from public.listing_media where listing_id = v_id;
  if v_n <> 1 then
    raise exception 'ASSERT FAILED: expected 1 photo, got %', v_n;
  end if;
end $$;

-- 2) Back-compat: image_url in details passes the schema and the rule (no photo).
do $$
declare
  v_kind uuid;
begin
  select kind_id into v_kind from public.listing_kinds where world_slug = 'items' and slug = 'give_item';
  perform public.create_marketplace_listing(
    p_kind_id => v_kind, p_title => 'Lamp with details image',
    p_details => '{"image_url":"https://example.test/lamp.jpg"}'::jsonb,
    p_media_paths => null::text[]);
  execute 'set constraints all immediate';
  execute 'set constraints all deferred';
end $$;

-- 3) RPC without any photo or details image is refused at commit (0741 / D132 reverses 0357).
do $$
declare
  v_kind uuid;
  v_error text;
begin
  select kind_id into v_kind from public.listing_kinds where world_slug = 'items' and slug = 'give_item';
  begin
    perform public.create_marketplace_listing(
      p_kind_id => v_kind, p_title => 'Table without photo', p_details => '{}'::jsonb,
      p_media_paths => null::text[]);
    execute 'set constraints all immediate';
  exception when others then
    v_error := sqlerrm;
  end;
  execute 'set constraints all deferred';
  if v_error is distinct from 'offer_photo_required' then
    raise exception 'ASSERT FAILED: items offer without photo should be refused, got %', coalesce(v_error, 'success');
  end if;
end $$;

-- 4) Removing the last photo of an image-less items offer is refused (0741 / D132).
do $$
declare
  v_id uuid;
  v_error text;
begin
  select listing_id into v_id from public.listings where title = 'Chair with photo';
  begin
    delete from public.listing_media where listing_id = v_id;
    execute 'set constraints all immediate';
  exception when others then
    v_error := sqlerrm;
  end;
  execute 'set constraints all deferred';
  if v_error is distinct from 'offer_photo_required' then
    raise exception 'ASSERT FAILED: last photo of an offer should not be deletable, got %', coalesce(v_error, 'success');
  end if;
end $$;

-- 5) The 0351 image check triggers and function are gone (0741 replaced them with offer_photo_check).
do $$
begin
  if exists (select 1 from pg_trigger where tgname like '%items_image_required%') then
    raise exception 'ASSERT FAILED: items image triggers should be dropped';
  end if;
  if to_regprocedure('public.listings_items_image_check()') is not null then
    raise exception 'ASSERT FAILED: listings_items_image_check should be dropped';
  end if;
end $$;

rollback;

\echo '✓ 0351_items_image_photo_or_details.sql passed'
