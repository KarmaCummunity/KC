-- supabase/tests/0266_world_rules_enforcement.sql | Issue #849

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

-- A food offer carries the giver's expiry (D28) and a food request has none (D21): since
-- 0539 there is no world TTL to fill a missing expiry, so food_expiry_required fires for
-- offers only (it used to be masked by the 168 h TTL of 0242).
do $$
declare
  v_user uuid := '00000000-0000-0000-0000-000000266001';
  v_exp timestamptz;
begin
  perform pg_temp.mk_user(v_user, 'food_rules');
  begin
    insert into public.listings (
      owner_id, world_slug, kind_id, direction, title, origin, moderation_status, details
    )
    select v_user, 'food', kind_id, 'give', 'Soup', 'native', 'published',
           '{"image_url":"https://example.test/f.jpg"}'::jsonb
      from public.listing_kinds where world_slug = 'food' and slug = 'give_food';
    raise exception 'ASSERT FAILED: a food offer without an expiry should be rejected';
  exception when others then
    if sqlerrm <> 'food_expiry_required' then raise; end if;
  end;

  insert into public.listings (
    owner_id, world_slug, kind_id, direction, title, origin, moderation_status, details
  )
  select v_user, 'food', kind_id, 'request', 'Need soup', 'native', 'published', '{}'::jsonb
    from public.listing_kinds where world_slug = 'food' and slug = 'request_food'
  returning expires_at into v_exp;
  if v_exp is not null then
    raise exception 'ASSERT FAILED: a food request should have no expiry, got %', v_exp;
  end if;
end $$;

do $$
declare
  v_user uuid := '00000000-0000-0000-0000-000000266002';
begin
  perform pg_temp.mk_user(v_user, 'ride_cap');
  begin
    insert into public.listings (
      owner_id, world_slug, kind_id, direction, title, origin, moderation_status,
      details, expires_at
    )
    select v_user, 'rides', kind_id, 'give', 'Ride offer', 'native', 'published',
           jsonb_build_object('cost_share_ils', 999, 'departs_at', '2030-01-01T08:00:00Z', 'seats_available', 2),
           now() + interval '1 day'
      from public.listing_kinds where world_slug = 'rides' and slug = 'ride_offer';
    raise exception 'ASSERT FAILED: ride cost cap should fail';
  exception when others then
    if sqlstate <> '23514' then raise; end if;
  end;
end $$;

-- Items: an image is optional (0357). A native items listing with no image succeeds.
do $$
declare
  v_user uuid := '00000000-0000-0000-0000-000000266003';
  v_id uuid;
begin
  perform pg_temp.mk_user(v_user, 'items_no_image');
  insert into public.listings (
    owner_id, world_slug, kind_id, direction, title, origin, moderation_status, details
  )
  select v_user, 'items', kind_id, 'give', 'Chair, no photo', 'native', 'published', '{}'::jsonb
    from public.listing_kinds where world_slug = 'items' and slug = 'give_item'
  returning listing_id into v_id;
  if v_id is null then
    raise exception 'ASSERT FAILED: items listing without image should succeed';
  end if;
end $$;

rollback;

\echo '✓ 0266_world_rules_enforcement.sql passed'
