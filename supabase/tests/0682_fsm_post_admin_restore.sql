-- supabase/tests/0682_fsm_post_admin_restore.sql
-- Wave 1b-i (#1989, {{D:admin-restore-previous-status}}): an admin removes a post in any
-- status and a restore returns it to the status it had before the removal.
-- Each block is a regression for one bug that 0682 fixes. Runs in a rolled-back transaction.

begin;

create temp table personas as
select kc_test.create_user('restore_owner') as owner,
       kc_test.create_user('restore_admin') as admin;

-- Only one super_admin may be active; the revoke is rolled back with the rest.
update public.admin_role_grants set revoked_at = now()
 where role = 'super_admin' and revoked_at is null;
insert into public.admin_role_grants (user_id, role) select admin, 'super_admin' from personas;

create function pg_temp.new_post(p_owner uuid)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  insert into public.posts (
    owner_id, title, description, category, type, status,
    location_display_level, city, street, street_number, visibility, world_slug
  ) values (
    p_owner, 'Restore wave 1b', 'Description', 'Furniture', 'Give', 'open',
    'CityOnly', 'tel-aviv', 'Herzl', '1', 'Public', 'items'
  ) returning post_id into v_id;
  -- A delivered post needs its recipient row.
  insert into public.recipients (post_id, recipient_user_id) values (v_id, p_owner);
  return v_id;
end $$;

create function pg_temp.status_of(p_post uuid) returns text
language sql as $$ select status from public.posts where post_id = p_post $$;

-- ── 1. A paused post is removed (it used to be skipped silently) and restored paused ──
do $$
declare
  p personas;
  v uuid;
begin
  select * into p from personas;
  v := pg_temp.new_post(p.owner);
  update public.posts set status = 'paused' where post_id = v;

  perform kc_test.act_as(p.admin);
  perform public.admin_remove_post(v);
  perform kc_test.assert_eq(pg_temp.status_of(v), 'removed_admin', 'paused post removed');
  perform kc_test.assert_eq(
    (select status_before_admin_removal from public.posts where post_id = v), 'paused', 'paused saved');
  perform kc_test.assert_true(exists (
    select 1 from public.audit_events
     where action = 'manual_remove_target' and target_type = 'post' and target_id = v),
    'removal of a paused post is audited');

  perform public.admin_restore_target('post', v);
  perform kc_test.assert_eq(pg_temp.status_of(v), 'paused', 'restore returns a paused post to paused');
  perform kc_test.assert_true(
    (select status_before_admin_removal from public.posts where post_id = v) is null,
    'restore clears the saved status');
end $$;

-- ── 2. An expired post is restored expired, never reopened (D127) ──
do $$
declare
  p personas;
  v uuid;
begin
  select * into p from personas;
  v := pg_temp.new_post(p.owner);
  update public.posts set status = 'expired' where post_id = v;

  perform kc_test.act_as(p.admin);
  perform public.admin_remove_post(v);
  perform kc_test.assert_eq(pg_temp.status_of(v), 'removed_admin', 'expired post removed');
  perform public.admin_restore_target('post', v);
  perform kc_test.assert_eq(pg_temp.status_of(v), 'expired', 'restore returns an expired post to expired');
end $$;

-- ── 3. A delivered post is restored delivered ────────────────────────────────────────
do $$
declare
  p personas;
  v uuid;
begin
  select * into p from personas;
  v := pg_temp.new_post(p.owner);
  update public.posts set status = 'closed_delivered' where post_id = v;

  perform kc_test.act_as(p.admin);
  perform public.admin_remove_post(v);
  perform public.admin_restore_target('post', v);
  perform kc_test.assert_eq(pg_temp.status_of(v), 'closed_delivered', 'restore returns a delivered post to delivered');
end $$;

-- ── 4. A legacy removed row with no saved status, and a hidden post, return to open ──
do $$
declare
  p personas;
  v uuid;
  w uuid;
begin
  select * into p from personas;
  v := pg_temp.new_post(p.owner);
  update public.posts set status = 'removed_admin' where post_id = v;   -- no saved status
  w := pg_temp.new_post(p.owner);
  update public.posts set status = 'hidden_pending_review' where post_id = w;

  perform kc_test.act_as(p.admin);
  perform public.admin_restore_target('post', v);
  perform kc_test.assert_eq(pg_temp.status_of(v), 'open', 'legacy removed row restores to open');
  perform public.admin_restore_target('post', w);
  perform kc_test.assert_eq(pg_temp.status_of(w), 'open', 'hidden post restores to open');
end $$;

-- ── 5. Restore leaves a post that was never removed alone (it used to reopen paused posts) ──
do $$
declare
  p personas;
  v uuid;
begin
  select * into p from personas;
  v := pg_temp.new_post(p.owner);
  update public.posts set status = 'paused' where post_id = v;

  perform kc_test.act_as(p.admin);
  perform public.admin_restore_target('post', v);
  perform kc_test.assert_eq(pg_temp.status_of(v), 'paused', 'restore is a no-op on a paused post');
  perform kc_test.assert_true(not exists (
    select 1 from public.audit_events
     where action = 'restore_target' and target_type = 'post' and target_id = v),
    'a no-op restore writes no audit row');
end $$;

-- ── 6. Removing the listing of a paused post saves paused and restores it (the 0666 body
--       failed on the check, and since 0667 updating the view lost the saved status) ──
do $$
declare
  p personas;
  v_listing uuid;
  v_post uuid;
begin
  select * into p from personas;
  v_listing := kc_test.create_listing(p.owner, 'time', 'volunteer_shift', 'give', 'Restore listing',
    '{"duration_minutes": 60}'::jsonb);
  -- Since 0667 a listing is a view row over its post (listing_id = post_id).
  select post_id into v_post from public.posts
   where post_id = v_listing or listing_id = v_listing or legacy_listing_id = v_listing
   limit 1;
  perform kc_test.assert_true(v_post is not null, 'fixture listing has a post');
  update public.posts set status = 'paused' where post_id = v_post;

  perform kc_test.act_as(p.admin);
  perform public.admin_remove_listing(v_listing);
  perform kc_test.assert_eq(pg_temp.status_of(v_post), 'removed_admin', 'listing removal removes the paused post');
  perform kc_test.assert_eq(
    (select status_before_admin_removal from public.posts where post_id = v_post), 'paused',
    'listing removal saves paused');

  perform public.admin_restore_target('listing', v_listing);
  perform kc_test.assert_eq(pg_temp.status_of(v_post), 'paused', 'listing restore returns the post to paused');
  perform kc_test.assert_true(exists (
    select 1 from public.audit_events
     where action = 'restore_target' and target_type = 'listing' and target_id = v_listing),
    'the listing restore is audited');
end $$;

rollback;

\echo '✓ 0682_fsm_post_admin_restore.sql passed'
