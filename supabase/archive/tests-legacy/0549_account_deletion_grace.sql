-- 0549 | ACCOUNT-RESTORE (FR-SETTINGS-012, FR-AUTH-016)
-- Deleting an account deactivates it for 30 days, hides its content, and can be undone;
-- the purge removes it for good.
begin;

create temp table personas as
  select kc_test.create_user('del_owner_' || substr(gen_random_uuid()::text, 1, 6)) as owner,
         kc_test.create_user('del_viewer_' || substr(gen_random_uuid()::text, 1, 6)) as viewer;

-- A published item listing of the owner.
create temp table fixture as
  select kc_test.create_listing(
           (select owner from personas), 'items', 'give_item', 'give', 'Grace lamp',
           '{"item_condition":"Good","fulfillment_mode":"owner_approval"}'::jsonb) as listing_id;

do $$
declare
  p record;
  f record;
  v_visible boolean;
  v_purge   timestamptz;
  v_gate    record;
begin
  select * into p from personas;
  select * into f from fixture;

  -- Before: another member sees the listing.
  perform kc_test.act_as(p.viewer);
  select public.is_listing_visible_to(l, p.viewer) into v_visible
    from public.listings l where l.listing_id = f.listing_id;
  perform kc_test.assert_true(v_visible, 'the listing is visible before the owner deletes the account');

  -- The owner requests deletion.
  perform kc_test.act_as(p.owner);
  v_purge := public.rpc_request_account_deletion();
  perform kc_test.assert_true(
    v_purge between now() + interval '29 days 23 hours' and now() + interval '30 days 1 hour',
    'the purge date is 30 days ahead');
  perform kc_test.assert_eq(
    (select account_status from public.users where user_id = p.owner), 'pending_deletion',
    'the account is pending deletion');

  -- A repeat request keeps the same purge date.
  perform kc_test.assert_eq(public.rpc_request_account_deletion(), v_purge, 'the request is idempotent');

  -- The gate reports the status and the purge date.
  select * into v_gate from public.auth_check_account_gate(p.owner);
  perform kc_test.assert_true(v_gate.allowed is false, 'the gate does not allow a pending-deletion account');
  perform kc_test.assert_eq(v_gate.reason, 'pending_deletion', 'the gate reason');
  perform kc_test.assert_eq(v_gate.until_at, v_purge, 'the gate carries the purge date');

  -- The content disappears for everyone else.
  perform kc_test.act_as(p.viewer);
  select public.is_listing_visible_to(l, p.viewer) into v_visible
    from public.listings l where l.listing_id = f.listing_id;
  perform kc_test.assert_true(v_visible is false, 'the listing is hidden while the owner is pending deletion');

  -- The owner cannot write while deactivated.
  perform kc_test.assert_true(
    not public.is_active_member(p.owner), 'a pending-deletion account is not an active member');

  -- Restore brings everything back.
  perform kc_test.act_as(p.owner);
  perform public.rpc_restore_account();
  perform kc_test.assert_eq(
    (select account_status from public.users where user_id = p.owner), 'active',
    'the account is active again after a restore');
  perform kc_test.assert_true(
    (select deletion_purge_at is null from public.users where user_id = p.owner),
    'the purge date is cleared on restore');
  perform kc_test.act_as(p.viewer);
  select public.is_listing_visible_to(l, p.viewer) into v_visible
    from public.listings l where l.listing_id = f.listing_id;
  perform kc_test.assert_true(v_visible, 'the listing is visible again after a restore');

  raise notice '✓ request, hide, gate, restore';
end $$;

-- Guards: restore needs a pending deletion, and it expires with the grace period.
do $$
declare
  p record;
begin
  select * into p from personas;
  perform kc_test.act_as(p.owner);
  perform kc_test.assert_raises(
    'select public.rpc_restore_account()', 'not_pending_deletion',
    'an active account cannot be restored');

  perform public.rpc_request_account_deletion();
  update public.users set deletion_purge_at = now() - interval '1 minute' where user_id = p.owner;
  perform kc_test.assert_raises(
    'select public.rpc_restore_account()', 'grace_expired',
    'a restore after the grace period fails');

  -- A suspended account cannot use deletion to dodge moderation.
  perform kc_test.act_as(p.viewer);
  update public.users set account_status = 'suspended_admin' where user_id = p.viewer;
  perform kc_test.assert_raises(
    'select public.rpc_request_account_deletion()', 'suspended',
    'a suspended account cannot request deletion');
  update public.users set account_status = 'active' where user_id = p.viewer;

  raise notice '✓ restore guards';
end $$;

-- The purge job: due accounts are listed, then deleted for good.
do $$
declare
  p record;
  v_result jsonb;
begin
  select * into p from personas;
  -- The owner's purge date was set in the past above.
  perform kc_test.assert_true(
    exists (select 1 from public.accounts_due_for_purge(50) where user_id = p.owner),
    'the due account is listed for the purge');
  perform kc_test.assert_true(
    not exists (select 1 from public.accounts_due_for_purge(50) where user_id = p.viewer),
    'an active account is not listed');

  v_result := public.delete_account_data_for(p.owner);
  perform kc_test.assert_true(v_result ? 'media_paths', 'the purge returns the media paths');
  -- 0699: the users row stays pending_deletion until the auth identity delete cascades it.
  perform kc_test.assert_eq(
    (select account_status from public.users where user_id = p.owner), 'pending_deletion',
    'the users row waits for the identity delete');
  -- Idempotent: a retry after a partial purge deletes nothing more.
  perform kc_test.assert_eq(
    (public.delete_account_data_for(p.owner) -> 'counts' ->> 'posts')::int, 0,
    'a retry is a no-op');
  delete from auth.users where id = p.owner;
  perform kc_test.assert_true(
    not exists (select 1 from public.users where user_id = p.owner), 'the identity delete removes the users row');

  raise notice '✓ purge';
end $$;

-- Privileges: clients can neither purge nor call the hard delete.
do $$
begin
  perform kc_test.assert_true(
    not has_function_privilege('authenticated', 'public.delete_account_data_for(uuid)', 'EXECUTE'),
    'authenticated cannot run the purge');
  perform kc_test.assert_true(
    not has_function_privilege('authenticated', 'public.accounts_due_for_purge(integer)', 'EXECUTE'),
    'authenticated cannot list due accounts');
  perform kc_test.assert_true(
    not has_function_privilege('authenticated', 'public.delete_account_data()', 'EXECUTE'),
    'the immediate hard delete is no longer client-callable');
  perform kc_test.assert_true(
    not has_column_privilege('authenticated', 'public.users', 'deletion_purge_at', 'SELECT'),
    'the purge date is not client-readable');
  perform kc_test.assert_true(
    has_function_privilege('authenticated', 'public.rpc_request_account_deletion()', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.rpc_restore_account()', 'EXECUTE'),
    'members can request deletion and restore');
  raise notice '✓ privileges';
end $$;

rollback;

\echo '✓ 0549_account_deletion_grace.sql passed'
