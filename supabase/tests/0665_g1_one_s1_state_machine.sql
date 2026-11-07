-- supabase/tests/0665_g1_one_s1_state_machine.sql | 0665 (G1 step 6b, issue #1671):
-- 1. posts_listing_id_fkey and legacy ride FKs are dropped;
-- 2. single S1 state machine enforces legal transitions on posts.status;
-- 3. illegal jumps raise posts_status_transition_invalid;
-- 4. active handoffs block pause and delete (listing_has_active_handoff);
-- 5. expired resume raises listing_expired.
-- Runs in a rolled-back transaction.

begin;

create temp table personas as
select kc_test.create_user('s1_owner')     as owner,
       kc_test.create_user('s1_taker')     as taker,
       kc_test.create_user('s1_stranger')  as stranger;

-- ── 1. Constraint checks ────────────────────────────────────────────────────────────────────
do $$
begin
  perform kc_test.assert_true(
    not exists (select 1 from pg_constraint where conname = 'posts_listing_id_fkey'),
    'posts_listing_id_fkey dropped to prevent cascade deletions'
  );
  perform kc_test.assert_true(
    not exists (select 1 from pg_constraint where conname = 'listings_legacy_ride_id_fkey'),
    'listings_legacy_ride_id_fkey dropped'
  );
  perform kc_test.assert_true(
    not exists (select 1 from pg_constraint where conname = 'listings_legacy_origin_ride'),
    'listings_legacy_origin_ride dropped'
  );
end $$;

/** Helper to create a test post directly. */
create function pg_temp.new_post(p_owner uuid, p_status text default 'open', p_expires timestamptz default null)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
  v_taker uuid;
begin
  select taker into v_taker from personas;
  insert into public.posts (
    owner_id, title, description, category, type, status,
    location_display_level, city, street, street_number, visibility, world_slug, expires_at
  ) values (
    p_owner, 'Test Post S1', 'Description', 'Furniture', 'Give', p_status,
    'CityOnly', 'tel-aviv', 'Herzl', '1', 'Public', 'items', p_expires
  ) returning post_id into v_id;

  insert into public.recipients (post_id, recipient_user_id)
  values (v_id, coalesce(v_taker, p_owner));

  return v_id;
end $$;
grant execute on function pg_temp.new_post(uuid, text, timestamptz) to public;

-- ── 2. Valid transitions ───────────────────────────────────────────────────────────────────
do $$
declare
  p personas;
  v uuid;
begin
  select * into p from personas;

  -- open -> paused -> open
  v := pg_temp.new_post(p.owner, 'open');
  update public.posts set status = 'paused' where post_id = v;
  perform kc_test.assert_eq((select status from public.posts where post_id = v), 'paused', 'open -> paused');
  update public.posts set status = 'open' where post_id = v;
  perform kc_test.assert_eq((select status from public.posts where post_id = v), 'open', 'paused -> open');

  -- open -> closed_delivered -> open (reopen)
  update public.posts set status = 'closed_delivered' where post_id = v;
  perform kc_test.assert_eq((select status from public.posts where post_id = v), 'closed_delivered', 'open -> closed_delivered');
  update public.posts set status = 'open' where post_id = v;
  perform kc_test.assert_eq((select status from public.posts where post_id = v), 'open', 'closed_delivered -> open');

  -- open -> expired -> open (reopen)
  update public.posts set status = 'expired' where post_id = v;
  perform kc_test.assert_eq((select status from public.posts where post_id = v), 'expired', 'open -> expired');
  update public.posts set status = 'open' where post_id = v;
  perform kc_test.assert_eq((select status from public.posts where post_id = v), 'open', 'expired -> open');

  -- open -> hidden_pending_review -> open (restore)
  update public.posts set status = 'hidden_pending_review' where post_id = v;
  perform kc_test.assert_eq((select status from public.posts where post_id = v), 'hidden_pending_review', 'open -> hidden');
  update public.posts set status = 'open' where post_id = v;
  perform kc_test.assert_eq((select status from public.posts where post_id = v), 'open', 'hidden -> open');

  -- open -> deleted_no_recipient -> open (reopen grace)
  update public.posts set status = 'deleted_no_recipient' where post_id = v;
  perform kc_test.assert_eq((select status from public.posts where post_id = v), 'deleted_no_recipient', 'open -> deleted');
  update public.posts set status = 'open' where post_id = v;
  perform kc_test.assert_eq((select status from public.posts where post_id = v), 'open', 'deleted -> open');

  -- open -> removed_admin -> open (admin restore)
  update public.posts set status = 'removed_admin' where post_id = v;
  perform kc_test.assert_eq((select status from public.posts where post_id = v), 'removed_admin', 'open -> removed_admin');
  update public.posts set status = 'open' where post_id = v;
  perform kc_test.assert_eq((select status from public.posts where post_id = v), 'open', 'removed_admin -> open');
end $$;

-- ── 3. Invalid transitions ─────────────────────────────────────────────────────────────────
do $$
declare
  p personas;
  v uuid;
begin
  select * into p from personas;

  -- paused -> closed_delivered is illegal
  v := pg_temp.new_post(p.owner, 'open');
  update public.posts set status = 'paused' where post_id = v;
  perform kc_test.assert_raises(
    format('update public.posts set status = %L where post_id = %L', 'closed_delivered', v),
    'posts_status_transition_invalid', 'paused -> closed_delivered is invalid'
  );

  -- closed_delivered -> paused is illegal
  update public.posts set status = 'open' where post_id = v;
  update public.posts set status = 'closed_delivered' where post_id = v;
  perform kc_test.assert_raises(
    format('update public.posts set status = %L where post_id = %L', 'paused', v),
    'posts_status_transition_invalid', 'closed_delivered -> paused is invalid'
  );

  -- closed_delivered -> expired is illegal
  perform kc_test.assert_raises(
    format('update public.posts set status = %L where post_id = %L', 'expired', v),
    'posts_status_transition_invalid', 'closed_delivered -> expired is invalid'
  );

  -- expired -> paused is illegal
  update public.posts set status = 'open' where post_id = v;
  update public.posts set status = 'expired' where post_id = v;
  perform kc_test.assert_raises(
    format('update public.posts set status = %L where post_id = %L', 'paused', v),
    'posts_status_transition_invalid', 'expired -> paused is invalid'
  );

  -- deleted_no_recipient -> paused is illegal
  update public.posts set status = 'open' where post_id = v;
  update public.posts set status = 'deleted_no_recipient' where post_id = v;
  perform kc_test.assert_raises(
    format('update public.posts set status = %L where post_id = %L', 'paused', v),
    'posts_status_transition_invalid', 'deleted_no_recipient -> paused is invalid'
  );

  -- removed_admin -> paused is illegal
  update public.posts set status = 'open' where post_id = v;
  update public.posts set status = 'removed_admin' where post_id = v;
  perform kc_test.assert_raises(
    format('update public.posts set status = %L where post_id = %L', 'paused', v),
    'posts_status_transition_invalid', 'removed_admin -> paused is invalid'
  );
end $$;

-- ── 4. Lifecycle Guards: Expiry and Active Handoffs ──────────────────────────────────────────
do $$
declare
  p personas;
  v uuid;
  v_h uuid;
begin
  select * into p from personas;

  -- 4a. Resuming an expired post is forbidden
  v := pg_temp.new_post(p.owner, 'open', now() - interval '1 hour');
  update public.posts set status = 'paused' where post_id = v;
  perform kc_test.assert_raises(
    format('update public.posts set status = %L where post_id = %L', 'open', v),
    'listing_expired', 'resuming an expired post is forbidden'
  );

  -- 4b. Active handoff blocks pause
  v := pg_temp.new_post(p.owner, 'open');
  insert into public.post_handoffs (post_id, owner_id, recipient_id, world_slug, status)
  values (v, p.owner, p.taker, 'items', 'reserved')
  returning handoff_id into v_h;

  perform kc_test.assert_raises(
    format('update public.posts set status = %L where post_id = %L', 'paused', v),
    'listing_has_active_handoff', 'active reserved handoff blocks pause'
  );

  -- 4c. Active handoff blocks delete
  perform kc_test.assert_raises(
    format('update public.posts set status = %L where post_id = %L', 'deleted_no_recipient', v),
    'listing_has_active_handoff', 'active reserved handoff blocks delete'
  );

  -- 4d. Cancelling the handoff unblocks pause and delete
  update public.post_handoffs set status = 'cancelled', cancelled_at = now() where handoff_id = v_h;
  update public.posts set status = 'paused' where post_id = v;
  perform kc_test.assert_eq((select status from public.posts where post_id = v), 'paused', 'cancelled handoff permits pause');
end $$;

-- ── 5. Cascade Safety Fix ───────────────────────────────────────────────────────────────────
do $$
declare
  p personas;
  v_post uuid;
  v_listing uuid;
begin
  select * into p from personas;

  -- 5a. A post-owned listing: deleting the listing does NOT cascade-delete the owning post
  v_post := pg_temp.new_post(p.owner, 'open');
  insert into public.listings (
    owner_id, kind_id, title, summary, city_id, address, geo, time_window, expires_at, details,
    anonymity_level, origin, moderation_status, published_at, status, legacy_post_id
  ) values (
    p.owner, kc_test.listing_kind_id('items', 'give_item'),
    'Post owned listing', 'Summary', 'tel-aviv', 'Herzl 1',
    st_setsrid(st_makepoint(34.7818, 32.0853), 4326)::geography,
    tstzrange(now(), now() + interval '7 days'),
    now() + interval '7 days', '{"condition": "good"}'::jsonb,
    3, 'native', 'published', now(), 'open', v_post
  ) returning listing_id into v_listing;

  update public.posts set listing_id = v_listing where post_id = v_post;

  delete from public.listings where listing_id = v_listing;
  perform kc_test.assert_row_count(
    format('select 1 from public.posts where post_id = %L', v_post),
    1, 'deleting derived listing does NOT delete owning post'
  );

  -- 5b. A listing-sourced listing: deleting the listing deletes its mirror post
  insert into public.listings (
    owner_id, kind_id, title, summary, city_id, address, geo, time_window, expires_at, details,
    anonymity_level, origin, moderation_status, published_at, status
  ) values (
    p.owner, kc_test.listing_kind_id('items', 'give_item'),
    'Listing sourced', 'Summary', 'tel-aviv', 'Herzl 1',
    st_setsrid(st_makepoint(34.7818, 32.0853), 4326)::geography,
    tstzrange(now(), now() + interval '7 days'),
    now() + interval '7 days', '{"condition": "good"}'::jsonb,
    3, 'native', 'published', now(), 'open'
  ) returning listing_id into v_listing;

  perform kc_test.assert_row_count(
    format('select 1 from public.posts where listing_id = %L', v_listing),
    1, 'mirror post created'
  );

  delete from public.listings where listing_id = v_listing;
  perform kc_test.assert_row_count(
    format('select 1 from public.posts where listing_id = %L', v_listing),
    0, 'mirror post deleted when listing-sourced listing is deleted'
  );
end $$;

rollback;
\echo '✓ 0665_g1_one_s1_state_machine.sql passed'
