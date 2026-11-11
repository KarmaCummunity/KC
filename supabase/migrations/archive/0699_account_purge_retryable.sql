-- 0699_account_purge_retryable | Wave 3c of the FSM kernel program (#1989, G61), FR-SETTINGS-012 AC4
--
-- The daily purge (`purge-deleted-accounts`) deleted the `users` row first and the auth identity
-- last. When the identity delete failed, the account was no longer listed as due, so the half-done
-- purge was never retried. Now the account stays `pending_deletion` until its identity is gone:
--
-- 1. `account_purge_media_paths(user)`: the post media paths, read before anything is deleted so
--    Storage cleanup can run first and be retried.
-- 2. `delete_account_data_for(user)` deletes the account's data but keeps the `users` row; deleting
--    the auth identity cascades it (`users.user_id` references `auth.users` on delete cascade). It
--    refuses an account that is not due for purge, and writes its audit event once across retries.
-- 3. `deleted` leaves `users_account_status_check`: no writer ever set it, and the kernel graph
--    (`account_status`, 0696) has no such state. The purge removes the row instead.

-- ── 1. Post media paths, read first ────────────────────────────────────────────
create or replace function public.account_purge_media_paths(p_user_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(m.path), '{}')
    from public.media_assets m
   where m.post_id in (select p.post_id from public.posts p where p.owner_id = p_user_id);
$$;

comment on function public.account_purge_media_paths(uuid) is
  'FR-SETTINGS-012 AC4 (0699): post media paths of an account due for purge; read before its data is deleted.';

revoke all on function public.account_purge_media_paths(uuid) from public, anon, authenticated;
grant execute on function public.account_purge_media_paths(uuid) to service_role;

-- ── 2. The data purge keeps the users row ──────────────────────────────────────
-- Same deletes as 0549 except the final `delete from public.users`. Return shape unchanged.
create or replace function public.delete_account_data_for(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status    text;
  v_purge_at  timestamptz;
  v_avatar    text;
  v_paths     text[];
  v_posts     int := 0;
  v_chats_a   int := 0;
  v_chats_d   int := 0;
begin
  select account_status, deletion_purge_at, avatar_url
    into v_status, v_purge_at, v_avatar
    from public.users where user_id = p_user_id
    for update;
  if not found then
    -- The identity delete already cascaded the row: nothing is left to purge.
    return jsonb_build_object(
      'media_paths', '[]'::jsonb,
      'avatar_path', null,
      'counts',      jsonb_build_object('posts',0,'chats_anonymized',0,'chats_dropped',0)
    );
  end if;
  -- Only an account whose grace period has ended is purged (a restore may have raced the job).
  if v_status <> 'pending_deletion' or v_purge_at > now() then
    raise exception 'account_not_due_for_purge' using errcode = 'P0001';
  end if;

  v_paths := public.account_purge_media_paths(p_user_id);

  delete from public.devices          where user_id      = p_user_id;
  delete from public.follow_edges     where follower_id  = p_user_id or followed_id = p_user_id;
  delete from public.follow_requests  where requester_id = p_user_id or target_id   = p_user_id;
  delete from public.blocks           where blocker_id   = p_user_id or blocked_id  = p_user_id;
  delete from public.reports          where reporter_id  = p_user_id or target_id   = p_user_id;
  delete from public.donation_links   where submitted_by = p_user_id;
  update public.donation_links set hidden_by = null where hidden_by = p_user_id;
  delete from public.auth_identities  where user_id      = p_user_id;

  select count(*) into v_posts from public.posts where owner_id = p_user_id;
  delete from public.posts where owner_id = p_user_id;

  select count(*) into v_chats_d from public.chats
    where (participant_a = p_user_id and participant_b is null)
       or (participant_b = p_user_id and participant_a is null);
  delete from public.chats
    where (participant_a = p_user_id and participant_b is null)
       or (participant_b = p_user_id and participant_a is null);

  select count(*) into v_chats_a from public.chats
    where participant_a = p_user_id or participant_b = p_user_id;
  update public.chats set participant_a = null where participant_a = p_user_id;
  update public.chats set participant_b = null where participant_b = p_user_id;

  -- One audit event per account: a retry after a failed identity delete finds it already written.
  if not exists (
    select 1 from public.audit_events
     where action = 'delete_account' and target_type = 'user' and target_id = p_user_id
       and (metadata ->> 'purge')::boolean
  ) then
    insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
    values (p_user_id, 'delete_account', 'user', p_user_id,
            jsonb_build_object(
              'actor_id_snapshot', p_user_id::text,
              'purge',             true,
              'posts_deleted',     v_posts,
              'chats_anonymized',  v_chats_a,
              'chats_dropped',     v_chats_d
            ));
  end if;

  return jsonb_build_object(
    'media_paths',  to_jsonb(v_paths),
    'avatar_path',  v_avatar,
    'counts', jsonb_build_object(
      'posts',            v_posts,
      'chats_anonymized', v_chats_a,
      'chats_dropped',    v_chats_d
    )
  );
end;
$$;

comment on function public.delete_account_data_for(uuid) is
  'FR-SETTINGS-012 AC4 (0699): deletes the data of an account due for purge and keeps its users row, which the auth identity delete cascades; raises account_not_due_for_purge otherwise.';

revoke all on function public.delete_account_data_for(uuid) from public, anon, authenticated;
grant execute on function public.delete_account_data_for(uuid) to service_role;

-- ── 3. `deleted` is not an account status ──────────────────────────────────────
alter table public.users drop constraint if exists users_account_status_check;
alter table public.users
  add constraint users_account_status_check check (account_status in (
    'pending_verification', 'active', 'suspended_for_false_reports',
    'suspended_admin', 'banned', 'pending_deletion'
  )) not valid;
alter table public.users validate constraint users_account_status_check;
