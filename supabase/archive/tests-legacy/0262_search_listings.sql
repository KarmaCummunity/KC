-- supabase/tests/0262_search_listings.sql | Issue #831

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

do $$
declare
  v_owner uuid := '00000000-0000-0000-0000-000000262001';
  v_id uuid;
  v_hit uuid;
begin
  perform pg_temp.mk_user(v_owner, 'search_owner');

  insert into public.listings (
    owner_id, world_slug, kind_id, direction, title, summary, origin, moderation_status, published_at, details
  )
  select v_owner, 'items', kind_id, 'give', 'Vintage bicycle red', 'City bike', 'native', 'published', now(),
         '{"image_url":"https://example.test/bike.jpg"}'::jsonb
    from public.listing_kinds where world_slug = 'items' and slug = 'give_item'
  returning listing_id into v_id;

  select listing_id into v_hit
    from public.search_listings('bicycle', 'items', 10, null)
   limit 1;

  if v_hit is distinct from v_id then
    raise exception 'ASSERT FAILED: search_listings should return the bicycle listing';
  end if;
end $$;

do $$
declare
  v_n int;
begin
  select count(*) into v_n from public.search_listings('romantic', 'romantic_matchmaking', 5, null);
  if v_n <> 0 then
    raise exception 'ASSERT FAILED: romantic_matchmaking must be excluded from search';
  end if;
end $$;

rollback;

\echo '✓ 0262_search_listings.sql passed'
