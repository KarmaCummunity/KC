-- 0468 (KC#1298) — D33 / D61 (docs/spec/07_cross_cutting_systems.md §7.15) for listings:
-- a listing can be reported (and is hidden from its reporter); 3 distinct reporters hide it for
-- review (not remove); the owner still sees it and is told; an admin restores or removes it; only
-- moderation moves it in or out of review.

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

create or replace function pg_temp.act_as(p_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_id::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_id::text, ''), true);
end $$;

/** A report filed by `p_reporter` itself (reports_validate_before_insert checks auth.uid()). */
create or replace function pg_temp.report(p_reporter uuid, p_listing uuid)
returns void language plpgsql as $$
begin
  perform pg_temp.act_as(p_reporter);
  insert into public.reports (reporter_id, target_type, target_id, reason)
  values (p_reporter, 'listing', p_listing, 'Spam');
end $$;

/** An open, public items "give" listing created through the app's RPC. */
create or replace function pg_temp.mk_listing(p_owner uuid, p_title text)
returns uuid language plpgsql as $$
begin
  perform pg_temp.act_as(p_owner);
  return public.create_marketplace_listing(
    p_kind_id => (select kind_id from public.listing_kinds where world_slug = 'items' and slug = 'give_item'),
    p_title   => p_title,
    p_details => '{"item_condition":"good","image_url":"https://example.test/i.jpg"}'::jsonb,
    p_lat     => 32.0853,
    p_lng     => 34.7818
  );
end $$;

/** Runs `p_sql` as the given user under the client role; returns the SQLSTATE it raised, or null. */
create or replace function pg_temp.client_write_state(p_user uuid, p_sql text)
returns text language plpgsql as $$
begin
  perform pg_temp.act_as(p_user);
  set local role authenticated;
  execute p_sql;
  reset role;
  return null;
exception when others then
  reset role;
  return sqlstate;
end $$;

do $$
declare
  v_admin   uuid := (select user_id from public.users where is_super_admin limit 1);
  v_owner   uuid := pg_temp.mk_user('h463_owner');
  v_viewer  uuid := pg_temp.mk_user('h463_viewer');
  v_r       uuid[] := array[pg_temp.mk_user('h463_r1'), pg_temp.mk_user('h463_r2'),
                            pg_temp.mk_user('h463_r3'), pg_temp.mk_user('h463_r4')];
  v_listing uuid := pg_temp.mk_listing(v_owner, 'Reported bookshelf');
  v_row     public.listings;
begin
  if v_admin is null then
    v_admin := pg_temp.mk_user('h463_admin');
    update public.users set is_super_admin = true where user_id = v_admin;
  end if;

  -- T1: two reports change nothing; the third hides the listing for review (audited).
  perform pg_temp.report(v_r[1], v_listing);
  -- FR-MOD-001 AC1: the reporter no longer sees what they reported; everyone else still does.
  select * into v_row from public.listings where listing_id = v_listing;
  perform pg_temp.assert(not public.is_listing_visible_to(v_row, v_r[1]), 'reporter still sees the reported listing');
  perform pg_temp.assert(public.is_listing_visible_to(v_row, v_viewer), 'one report hid the listing from everyone');
  perform pg_temp.report(v_r[2], v_listing);
  perform pg_temp.assert((select status from public.listings where listing_id = v_listing) = 'open',
    'listing hidden after only 2 reports');
  perform pg_temp.report(v_r[3], v_listing);
  select * into v_row from public.listings where listing_id = v_listing;
  perform pg_temp.assert(v_row.status = 'hidden_pending_review',
    format('3 reports must hide the listing for review, got %s', v_row.status));
  perform pg_temp.assert(exists (
    select 1 from public.audit_events
     where action = 'auto_remove_target' and target_type = 'listing' and target_id = v_listing),
    'hiding the listing was not audited');

  -- T2: hidden from others (browse, search, matching read only open listings), kept for its
  -- owner, and no further report piles onto a target already under review.
  perform pg_temp.assert(not public.is_listing_visible_to(v_row, v_viewer), 'hidden listing visible to another user');
  perform pg_temp.assert(public.is_listing_visible_to(v_row, v_owner), 'owner cannot see own hidden listing');
  begin
    perform pg_temp.report(v_r[4], v_listing);
    raise exception 'ASSERT FAILED: a report on a hidden listing must be rejected';
  exception when sqlstate 'P0020' then null;
  end;

  -- T3: the owner sees the state in My listings and is told in their support thread.
  perform pg_temp.act_as(v_owner);
  perform pg_temp.assert(exists (
    select 1 from public.list_my_listings(p_limit => 50, p_offset => 0) m
     where m.listing_id = v_listing and m.status = 'hidden_pending_review'),
    'My listings does not show the hidden listing with its state');
  perform pg_temp.assert(exists (
    select 1 from public.messages m join public.chats c on c.chat_id = m.chat_id
     where c.is_support_thread and v_owner in (c.participant_a, c.participant_b)
       and m.system_payload ->> 'kind' = 'owner_auto_removed'
       and m.system_payload ->> 'target_type' = 'listing'
       and m.system_payload ->> 'target_id' = v_listing::text
       and m.system_payload ->> 'outcome' = 'hidden_pending_review'),
    'owner got no hidden-for-review notice');

  -- T4: only moderation leaves (or enters) a review state; the owner's own lifecycle still works.
  perform pg_temp.assert(pg_temp.client_write_state(v_owner,
    format('update public.listings set status = %L where listing_id = %L', 'open', v_listing)) = '42501',
    'the owner must not reopen a listing hidden for review');
  perform pg_temp.assert((select status from public.listings where listing_id = v_listing) = 'hidden_pending_review',
    'the hidden state changed after a rejected client write');

  -- T5: an admin restores the hidden listing to open.
  perform pg_temp.act_as(v_admin);
  perform public.admin_restore_target('listing', v_listing);
  perform pg_temp.assert((select status from public.listings where listing_id = v_listing) = 'open',
    'admin restore did not reopen the hidden listing');
  perform pg_temp.assert(exists (
    select 1 from public.audit_events
     where action = 'restore_target' and target_type = 'listing' and target_id = v_listing),
    'the restore was not audited');

  -- T6: an admin removes a hidden listing; the owner cannot undo it either.
  update public.listings set status = 'hidden_pending_review' where listing_id = v_listing;
  perform public.admin_remove_listing(v_listing);
  perform pg_temp.assert((select status from public.listings where listing_id = v_listing) = 'removed_admin',
    'admin removal of a hidden listing did not remove it');
  perform pg_temp.assert(pg_temp.client_write_state(v_owner,
    format('update public.listings set status = %L where listing_id = %L', 'open', v_listing)) = '42501',
    'the owner must not reopen a listing removed by an admin');

  raise notice '✓ T1-T6 listing hidden for review, owner notice, restore, remove, moderation-only states';
end $$;

-- T7: an owner still moves their own listing between ordinary states, and cannot hide it
-- under a review state themselves.
do $$
declare
  v_owner   uuid := pg_temp.mk_user('h463_owner2');
  v_listing uuid := pg_temp.mk_listing(v_owner, 'Spare chairs');
begin
  perform pg_temp.assert(pg_temp.client_write_state(v_owner,
    format('update public.listings set status = %L where listing_id = %L', 'cancelled', v_listing)) is null,
    'the owner could not pause their own listing');
  perform pg_temp.assert(pg_temp.client_write_state(v_owner,
    format('update public.listings set status = %L where listing_id = %L', 'hidden_pending_review', v_listing)) = '42501',
    'the owner must not put their listing into a review state');
  raise notice '✓ T7 ordinary owner transitions unaffected';
end $$;

rollback;

\echo '✓ 0468_hide_reported_listings_for_review.sql passed'
