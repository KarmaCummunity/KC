-- supabase/tests/0260_matching_core.sql | Issue #829

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
  v_cnt int;
begin
  select count(*) into v_cnt from public.match_weights where user_id is null;
  if v_cnt < 13 then
    raise exception 'ASSERT FAILED: expected per-world match_weights seed, got %', v_cnt;
  end if;
end $$;

-- Romantic world: no automatic matches.
do $$
declare
  v_owner uuid := '00000000-0000-0000-0000-000000260001';
  v_give uuid;
  v_n int;
begin
  perform pg_temp.mk_user(v_owner, 'rom_owner');
  -- romantic_matchmaking requires a verified publisher (0264 has_world_permission).
  update public.users set verified_at = now() where user_id = v_owner;
  perform pg_temp.act_as(v_owner);

  insert into public.listings (
    owner_id, world_slug, kind_id, direction, title, origin, moderation_status, published_at
  )
  select v_owner, 'romantic_matchmaking', kind_id, 'give', 'Shadchan offer', 'native', 'published', now()
    from public.listing_kinds where world_slug = 'romantic_matchmaking' and slug = 'matchmaker_offer'
  returning listing_id into v_give;

  select count(*) into v_n from public.find_matches(v_give, 10, v_owner);
  if v_n <> 0 then
    raise exception 'ASSERT FAILED: romantic_matchmaking find_matches should return 0 rows, got %', v_n;
  end if;
end $$;

-- Items give/request pair produces at least one candidate row when opposite listing exists.
do $$
declare
  v_a uuid := '00000000-0000-0000-0000-000000260002';
  v_b uuid := '00000000-0000-0000-0000-000000260003';
  v_give uuid;
  v_req uuid;
  v_n int;
begin
  perform pg_temp.mk_user(v_a, 'match_a');
  perform pg_temp.mk_user(v_b, 'match_b');
  perform pg_temp.act_as(v_a);

  insert into public.listings (
    owner_id, world_slug, kind_id, direction, title, origin, moderation_status, published_at, city_id, details
  )
  select v_a, 'items', kind_id, 'give', 'Blue baby stroller', 'native', 'published', now(), 'tel-aviv',
         '{"image_url":"https://example.test/stroller.jpg"}'::jsonb
    from public.listing_kinds where world_slug = 'items' and slug = 'give_item'
  returning listing_id into v_give;

  insert into public.listings (
    owner_id, world_slug, kind_id, direction, title, origin, moderation_status, published_at, city_id, details
  )
  select v_b, 'items', kind_id, 'request', 'Need baby stroller', 'native', 'published', now(), 'tel-aviv',
         '{"image_url":"https://example.test/need.jpg"}'::jsonb
    from public.listing_kinds where world_slug = 'items' and slug = 'request_item'
  returning listing_id into v_req;

  select count(*) into v_n from public.find_matches(v_give, 10, v_a);
  if v_n < 1 then
    raise exception 'ASSERT FAILED: expected find_matches to return a request candidate';
  end if;
end $$;

rollback;

\echo '✓ 0260_matching_core.sql passed'
