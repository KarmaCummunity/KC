-- supabase/tests/0240_listings_marketplace_rls.sql
-- Regression for migrations 0240–0242 (issues #823–#825).

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

create or replace function pg_temp.act_as(p_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_id::text, 'role', 'authenticated')::text, true);
end $$;

do $$
declare
  v_worlds int;
  v_kinds int;
begin
  select count(*) into v_worlds from public.worlds;
  if v_worlds <> 13 then
    raise exception 'ASSERT FAILED: expected 13 PRD worlds, got %', v_worlds;
  end if;
  select count(*) into v_kinds from public.listing_kinds;
  if v_kinds < 25 then
    raise exception 'ASSERT FAILED: expected listing_kinds seed, got %', v_kinds;
  end if;
end $$;

do $$
begin
  if public.anonymity_level_to_visibility(3) <> 'Public'
     or public.anonymity_level_to_visibility(2) <> 'FollowersOnly'
     or public.anonymity_level_to_visibility(1) <> 'OnlyMe' then
    raise exception 'ASSERT FAILED: anonymity_level_to_visibility mapping';
  end if;
  if public.visibility_to_anonymity_level('Public') <> 3 then
    raise exception 'ASSERT FAILED: visibility_to_anonymity_level mapping';
  end if;
end $$;

-- Legacy post backfill row is visible to anon when post is public/open.
do $$
declare
  v_post_id uuid;
  v_cnt int;
begin
  perform pg_temp.mk_user('00000000-0000-0000-0000-000000240001', 'lst_owner');
  insert into public.posts (
    post_id, owner_id, type, status, visibility, title, category, city, street, street_number
  ) values (
    '00000000-0000-0000-0000-000000240010',
    '00000000-0000-0000-0000-000000240001',
    'Give', 'open', 'Public', 'Listing test chair', 'Other', 'tel-aviv', 'Herzl', '1'
  ) returning post_id into v_post_id;

  -- posts_sync_listing (0243) upserts the registry row; assert sync + visibility only.
  select count(*) into v_cnt
    from public.listings l
   where l.legacy_post_id = v_post_id
     and public.is_listing_visible_to(l.*, null);
  if v_cnt <> 1 then
    raise exception 'ASSERT FAILED: public post-backed listing should be visible to anon';
  end if;
end $$;

-- Anonymity may change both ways after publish (D16, 0451): 2 → 3 is allowed.
do $$
declare
  v_id uuid;
begin
  perform pg_temp.mk_user('00000000-0000-0000-0000-000000240002', 'lst_anon');
  insert into public.listings (
    owner_id, world_slug, kind_id, direction, title, origin, anonymity_level,
    moderation_status, published_at, details
  )
  select
    '00000000-0000-0000-0000-000000240002',
    'items',
    kind_id,
    'give',
    'Anon tighten test',
    'native',
    2,
    'published',
    now(),
    '{"image_url":"https://example.test/tighten.jpg"}'::jsonb
  from public.listing_kinds where world_slug = 'items' and slug = 'give_item'
  returning listing_id into v_id;

  -- D16 (0451): anonymity changes both ways after publish.
  update public.listings set anonymity_level = 3 where listing_id = v_id;
  if (select anonymity_level from public.listings where listing_id = v_id) <> 3 then
    raise exception 'ASSERT FAILED: anonymity loosen after publish should be allowed (D16)';
  end if;
end $$;

-- Medical routed kinds require external_body_id for native listings.
do $$
begin
  perform pg_temp.mk_user('00000000-0000-0000-0000-000000240003', 'med_user');
  begin
    insert into public.listings (
      owner_id, world_slug, kind_id, direction, title, origin, moderation_status
    )
    select
      '00000000-0000-0000-0000-000000240003',
      'medical',
      kind_id,
      'give',
      'Blood without body',
      'native',
      'published'
    from public.listing_kinds
    where world_slug = 'medical' and slug = 'blood_appointment';
    raise exception 'ASSERT FAILED: medical listing without external body should fail';
  exception
    when check_violation then null;
    when others then
      if sqlstate <> '23514' then
        raise;
      end if;
  end;
end $$;

rollback;

\echo '✓ 0240_listings_marketplace_rls.sql passed'
