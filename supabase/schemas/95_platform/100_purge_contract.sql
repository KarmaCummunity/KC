-- Platform · database side of the two storage workers (design §4.1, §5.3 "Cleanup")
--
-- purge-deleted-accounts (Edge Function, daily). For each account past its 30-day grace
-- period (kc_private.accounts_due_for_purge), in this order:
--   1. kc_private.account_purge_prepare  tombstone + money records detached
--   2. the worker deletes the member's folder `<user_id>/` in every storage bucket
--   3. kc_private.account_purge_finish   the auth identity is deleted; every member row
--                                        goes with it by cascade
-- Each step can be repeated, and an account stays listed as due until step 3 succeeded,
-- so a run that fails half-way is finished by the next one.
--
-- reconcile-storage-orphans (Edge Function, daily). Lists the objects of a bucket and asks
-- kc_private.storage_orphan_keys which of them no row references any more.

-- Raises unless the account exists and its grace period has ended. Locks the account row,
-- so a purge and a late restore cannot interleave.
create function kc_private.account_purge_require_due(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.user_account a
    where a.user_id = p_user_id and a.deletion_purge_at <= now()
      for update;
  if not found then
    raise exception 'account_not_due_for_purge' using errcode = 'P0001';
  end if;
end;
$$;
comment on function kc_private.account_purge_require_due(uuid) is
  'Purge guard: the account is pending deletion and past its purge date.';

-- Step 1. Leaves the deletion tombstone (audit) and replaces the member's reference in the
-- money records by it (billing). Both parts are idempotent.
create function kc_private.account_purge_prepare(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform kc_private.account_purge_require_due(p_user_id);
  perform kc_private.audit_record_deletion(p_user_id);
  perform kc_private.billing_detach_user(p_user_id);
end;
$$;
comment on function kc_private.account_purge_prepare(uuid) is
  'Account purge, step 1: deletion tombstone and detachment of money records; repeatable.';

-- Step 3. Deletes the auth identity; the member's rows follow by cascade. Returns false
-- when the account is already gone, so repeating a finished purge is not an error.
create function kc_private.account_purge_finish(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from auth.users au where au.id = p_user_id) then
    return false;
  end if;
  perform kc_private.account_purge_require_due(p_user_id);
  delete from auth.users au where au.id = p_user_id;
  return true;
end;
$$;
comment on function kc_private.account_purge_finish(uuid) is
  'Account purge, step 3: removes the auth identity and, by cascade, every row of the member.';

-- Of the object keys p_keys in bucket p_bucket, those no row references. Only buckets whose
-- objects are recorded row by row can be judged: for any other bucket nothing is returned,
-- so the worker never deletes a file it cannot prove unreferenced.
--   post-images  referenced by post_media (storage_bucket, storage_key)
create function kc_private.storage_orphan_keys(p_bucket text, p_keys text[])
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select k.key
    from unnest(p_keys) as k (key)
   where p_bucket = 'post-images'
     and not exists (select 1 from public.post_media m
                      where m.storage_bucket = p_bucket and m.storage_key = k.key);
$$;
comment on function kc_private.storage_orphan_keys(text, text[]) is
  'Storage reconciliation: the listed object keys of a bucket that no row references.';
