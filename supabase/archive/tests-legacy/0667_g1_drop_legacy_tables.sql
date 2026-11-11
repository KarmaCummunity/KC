-- 0667_g1_drop_legacy_tables.sql
-- Verification test for Step 6d (ADR-006, D-214, issue #1671):
-- 1. Physical tables listings, ride_listings, giving_handoffs are dropped.
-- 2. listings, ride_listings, giving_handoffs are compatibility views.
-- 3. post_unification_report confirms 0 mismatches and legacy_tables_dropped.
-- 4. Foreign keys point to posts(post_id).
-- 5. Writes and handoffs on posts flow through compatibility views cleanly.

begin;

select plan(10);

-- T1: Verify listings, ride_listings, giving_handoffs are views, NOT physical tables
select ok(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('listings', 'ride_listings', 'giving_handoffs') and c.relkind = 'v') = 3,
  'listings, ride_listings, and giving_handoffs are views (relkind = v)'
);

select ok(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('listings', 'ride_listings', 'giving_handoffs') and c.relkind = 'r') = 0,
  'No physical tables named listings, ride_listings, or giving_handoffs exist'
);

-- T2: Test post_unification_report()
select is(
  (public.post_unification_report() ->> 'legacy_tables_dropped')::boolean,
  true,
  'post_unification_report confirms legacy_tables_dropped is true'
);

select is(
  (public.post_unification_report() ->> 'mirror_field_mismatches')::int,
  0,
  'post_unification_report confirms 0 mirror field mismatches'
);

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
         privacy_mode = 'Public', account_status = 'active'
   where user_id = p_id;
end $$;

-- T3: Create test user and post
do $$
declare
  v_uid uuid := '11111111-1111-4111-a111-111111111111';
  v_taker uuid := '22222222-2222-4222-a222-222222222222';
  v_post_id uuid;
  v_listing_id uuid;
  v_handoff public.giving_handoffs;
  v_kind_id uuid;
begin
  perform pg_temp.mk_user(v_uid, 'owner_6d');
  perform pg_temp.mk_user(v_taker, 'taker_6d');

  select kind_id into v_kind_id from public.listing_kinds where slug = 'give_item' limit 1;

  -- Insert a post
  insert into public.posts (
    owner_id, type, status, visibility, title, description,
    category, city, street, street_number, location_display_level,
    world_slug, direction, post_type, kind_id
  ) values (
    v_uid, 'Give', 'open', 'Public', 'Legacy table drop desk', 'Nice wooden desk',
    'Furniture', 'tel-aviv', 'Herzl', '1', 'CityOnly',
    'items', 'offer', 'standard', v_kind_id
  ) returning post_id into v_post_id;

  -- Check compatibility view listings shows the post
  select listing_id into v_listing_id
    from public.listings
   where listing_id = v_post_id and title = 'Legacy table drop desk';

  if v_listing_id is null then
    raise exception 'post not visible through listings view';
  end if;

  -- Create a handoff on post_handoffs and check giving_handoffs view
  insert into public.post_handoffs (
    post_id, owner_id, recipient_id, world_slug, status
  ) values (
    v_post_id, v_uid, v_taker, 'items', 'reserved'
  );

  select * into v_handoff
    from public.giving_handoffs
   where listing_id = v_post_id and recipient_id = v_taker;

  if v_handoff.handoff_id is null then
    raise exception 'post_handoff not visible through giving_handoffs view';
  end if;
end;
$$;

select ok(
  exists (select 1 from public.listings where title = 'Legacy table drop desk'),
  'A post in public.posts is queryable via public.listings view'
);

select ok(
  exists (select 1 from public.giving_handoffs where world_slug = 'items'),
  'A handoff in public.post_handoffs is queryable via public.giving_handoffs view'
);

-- T4: Verify foreign keys point to posts(post_id)
select ok(
  exists (
    select 1 from information_schema.referential_constraints rc
     join information_schema.table_constraints tc on tc.constraint_name = rc.constraint_name
     join information_schema.constraint_column_usage ccu on ccu.constraint_name = rc.unique_constraint_name
    where tc.table_name = 'listing_worlds' and ccu.table_name = 'posts' and ccu.column_name = 'post_id'
  ),
  'listing_worlds foreign key references posts(post_id)'
);

select ok(
  exists (
    select 1 from information_schema.referential_constraints rc
     join information_schema.table_constraints tc on tc.constraint_name = rc.constraint_name
     join information_schema.constraint_column_usage ccu on ccu.constraint_name = rc.unique_constraint_name
    where tc.table_name = 'ride_participants' and ccu.table_name = 'posts' and ccu.column_name = 'post_id'
  ),
  'ride_participants foreign key references posts(post_id)'
);

-- T5: Test handoff writer RPC via view
do $$
declare
  v_uid uuid := '11111111-1111-4111-a111-111111111111';
  v_taker uuid := '22222222-2222-4222-a222-222222222222';
  v_post_id uuid;
  v_handoff public.giving_handoffs;
  v_kind_id uuid;
begin
  select kind_id into v_kind_id from public.listing_kinds where slug = 'give_item' limit 1;

  insert into public.posts (
    owner_id, type, status, visibility, title, description,
    category, city, street, street_number, location_display_level,
    world_slug, direction, post_type, kind_id, availability_status
  ) values (
    v_uid, 'Give', 'open', 'Public', 'Desk for reserve RPC', 'Desk for reserve test',
    'Furniture', 'tel-aviv', 'Herzl', '1', 'CityOnly',
    'items', 'offer', 'standard', v_kind_id, 'immediate'
  ) returning post_id into v_post_id;

  -- Act as taker and call reserve_item_giving
  perform set_config('request.jwt.claim.sub', v_taker::text, true);
  v_handoff := public.reserve_item_giving(v_post_id);

  if v_handoff.status <> 'reserved' then
    raise exception 'reserve_item_giving returned unexpected status: %', v_handoff.status;
  end if;

  -- Act as owner and confirm
  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  v_handoff := public.confirm_item_handoff(v_handoff.handoff_id);

  if v_handoff.status <> 'confirmed' then
    raise exception 'confirm_item_handoff returned unexpected status: %', v_handoff.status;
  end if;
end;
$$;

select ok(
  exists (select 1 from public.posts where title = 'Desk for reserve RPC' and availability_status = 'scheduled'),
  'reserve_item_giving updates posts availability_status to scheduled'
);

select is(
  (select gh.status from public.giving_handoffs gh
     join public.posts p on p.post_id = gh.listing_id
    where p.title = 'Desk for reserve RPC'),
  'confirmed',
  'confirm_item_handoff updates handoff status to confirmed'
);

select * from finish();
rollback;
