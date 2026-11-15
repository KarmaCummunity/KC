-- supabase/tests/0699_account_purge_retryable.sql
-- Wave 3c (#1989), FR-SETTINGS-012 AC4: the purge is retryable. The media paths are read before
-- any delete, the data purge keeps the users row (pending_deletion) until the auth identity delete
-- cascades it, it refuses an account not due, and it audits once. `deleted` is not an account
-- status. Runs in a rolled-back transaction.

begin;

create temp table personas as
select kc_test.create_user('w3c_leaving') as leaving,
       kc_test.create_user('w3c_member')  as member;

-- A published item post of the leaving member, with one image.
select kc_test.create_listing(
  (select leaving from personas), 'items', 'give_item', 'give', 'Purge lamp',
  '{"item_condition":"Good","fulfillment_mode":"owner_approval"}'::jsonb);
insert into public.media_assets (post_id, ordinal, path, mime_type, size_bytes)
select p.post_id, 0, 'w3c/lamp.jpg', 'image/jpeg', 1024
  from public.posts p where p.owner_id = (select leaving from personas);

-- ── 1. Only an account due for purge is purged ─────────────────────────────────
do $$
declare
  p personas;
begin
  select * into p from personas;
  perform kc_test.assert_raises(
    format('select public.delete_account_data_for(%L)', p.member),
    'account_not_due_for_purge', 'a live account is not purged');

  update public.users
     set status_before_deletion = account_status, account_status = 'pending_deletion',
         deletion_requested_at = now(), deletion_purge_at = now() + interval '1 day'
   where user_id = p.leaving;
  perform kc_test.assert_raises(
    format('select public.delete_account_data_for(%L)', p.leaving),
    'account_not_due_for_purge', 'an account still in its grace period is not purged');
end $$;

-- ── 2. Paths first, then the data; the users row waits for the identity ────────
do $$
declare
  p personas;
begin
  select * into p from personas;
  update public.users set deletion_purge_at = now() - interval '1 minute' where user_id = p.leaving;

  perform kc_test.assert_eq(
    public.account_purge_media_paths(p.leaving), array['w3c/lamp.jpg'], 'the media paths are read first');

  perform public.delete_account_data_for(p.leaving);
  perform kc_test.assert_eq(
    (select count(*) from public.posts where owner_id = p.leaving), 0::bigint, 'the posts are deleted');
  perform kc_test.assert_eq(
    (select account_status from public.users where user_id = p.leaving), 'pending_deletion',
    'the account stays pending_deletion, so a failed identity delete is retried');
  perform kc_test.assert_true(
    exists (select 1 from public.accounts_due_for_purge(200) where user_id = p.leaving),
    'and the next run lists it again');

  -- The retry: nothing more to delete, and the audit event is not written twice.
  perform public.delete_account_data_for(p.leaving);
  perform kc_test.assert_eq(
    (select count(*) from public.audit_events
      where action = 'delete_account' and target_type = 'user' and target_id = p.leaving),
    1::bigint, 'one audit event across retries');

  -- The identity delete cascades the users row: the account is gone.
  delete from auth.users where id = p.leaving;
  perform kc_test.assert_true(
    not exists (select 1 from public.users where user_id = p.leaving), 'the users row is gone');
  perform kc_test.assert_eq(
    (public.delete_account_data_for(p.leaving) -> 'counts' ->> 'posts')::int, 0,
    'a purge after the identity is gone is a no-op');
end $$;

-- ── 3. `deleted` is not an account status; clients reach none of this ──────────
do $$
begin
  perform kc_test.assert_true(
    position('''deleted''' in pg_get_constraintdef(
      (select oid from pg_constraint where conname = 'users_account_status_check'))) = 0,
    'users_account_status_check has no deleted state');
  perform kc_test.assert_true(
    not has_function_privilege('authenticated', 'public.account_purge_media_paths(uuid)', 'EXECUTE'),
    'authenticated cannot read purge paths');
end $$;

rollback;

\echo '✓ 0699_account_purge_retryable.sql passed'
