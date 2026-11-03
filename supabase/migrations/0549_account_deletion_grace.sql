-- 0549_account_deletion_grace | ACCOUNT-RESTORE — FR-SETTINGS-012 / FR-AUTH-016
--
-- Deleting an account no longer hard-deletes it. The account is deactivated
-- (`account_status = 'pending_deletion'`) for 30 days and can be restored by signing in;
-- a daily job (`purge-deleted-accounts` Edge Function) then deletes it for good.
--
--   1. `users.deletion_requested_at`, `deletion_purge_at`, `status_before_deletion`
--      (no client grants: clients read the purge date through `auth_check_account_gate`).
--   2. New status `pending_deletion` and two audit actions.
--   3. `is_account_pending_deletion(uuid)` — internal predicate; `is_post_visible_to` and
--      `is_listing_visible_to` return false for a deactivated owner, so the posts, listings,
--      rides and feeds built on them disappear. Profiles, search and chat counterparts
--      already require `account_status = 'active'`.
--   4. `auth_check_account_gate` reports the status and the purge date.
--   5. `rpc_request_account_deletion()` / `rpc_restore_account()` — the client-facing pair.
--   6. `delete_account_data_for(uuid)` — the old hard delete, now service-role only, called by
--      the purge job. The client-callable `delete_account_data()` loses its grant.
--
-- Hidden content is kept, so a restore is complete. Follow edges, blocks and chats stay as
-- they were; push devices are dropped at deactivation.

begin;

-- ── 1–2. Columns, status, audit actions ─────────────────────────────────────
alter table public.users
  add column if not exists deletion_requested_at timestamptz,
  add column if not exists deletion_purge_at timestamptz,
  add column if not exists status_before_deletion text;

comment on column public.users.deletion_purge_at is
  'When a pending_deletion account is purged for good (request + 30 days). Not client-readable.';
comment on column public.users.status_before_deletion is
  'account_status to return to on restore (active or pending_verification).';

alter table public.users drop constraint if exists users_account_status_check;
alter table public.users
  add constraint users_account_status_check check (account_status in (
    'pending_verification', 'active', 'suspended_for_false_reports',
    'suspended_admin', 'banned', 'deleted', 'pending_deletion'
  ));

alter table public.users
  add constraint users_pending_deletion_purge_chk
  check ((account_status = 'pending_deletion') = (deletion_purge_at is not null));

create index if not exists users_pending_deletion_purge_idx
  on public.users (deletion_purge_at) where account_status = 'pending_deletion';

alter table public.audit_events drop constraint if exists audit_events_action_check;
alter table public.audit_events
  add constraint audit_events_action_check_v9 check (action in (
    'block_user','unblock_user',
    'report_target',
    'auto_remove_target','manual_remove_target','restore_target',
    'suspend_user','unsuspend_user',
    'ban_user',
    'false_report_sanction_applied',
    'dismiss_report','confirm_report',
    'delete_message',
    'delete_account',
    'unmark_recipient_self',
    'admin_role_grant','admin_role_revoke',
    'admin_task_create','admin_task_update','admin_task_delete',
    'org_application_approve','org_application_reject',
    'post_edited',
    'admin_set_manager',
    'account_deletion_requested','account_restored'
  )) not valid;
alter table public.audit_events validate constraint audit_events_action_check_v9;
alter table public.audit_events
  rename constraint audit_events_action_check_v9 to audit_events_action_check;

-- ── 3. Visibility ───────────────────────────────────────────────────────────
-- Internal predicate: runs inside the SECURITY DEFINER visibility functions (as their owner),
-- so no client role needs EXECUTE on it.
create or replace function public.is_account_pending_deletion(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.users
     where user_id = p_user_id and account_status = 'pending_deletion'
  );
$$;
revoke all on function public.is_account_pending_deletion(uuid) from public, anon, authenticated;
grant execute on function public.is_account_pending_deletion(uuid) to service_role;

-- Body of 0452 plus one branch: a deactivated owner's posts are invisible to everyone else.
create or replace function public.is_post_visible_to(p_post posts, p_viewer uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select case
    when p_post.owner_id = p_viewer then true
    when public.is_account_pending_deletion(p_post.owner_id) then false
    when public.is_blocked(p_viewer, p_post.owner_id) then false
    when exists (
      select 1 from public.reporter_hides h
      where h.reporter_id = p_viewer
        and h.target_type = 'post'
        and h.target_id   = p_post.post_id
    ) then false
    when p_post.status in ('removed_admin','hidden_pending_review','deleted_no_recipient','expired') then false
    when p_post.status = 'closed_delivered' then
      case
        when exists (
          select 1 from public.recipients r
          where r.post_id = p_post.post_id
            and r.recipient_user_id = p_viewer
        ) then true
        when public.participant_closed_surface_visible(p_post, p_post.owner_id, p_viewer) then true
        when exists (
          select 1 from public.recipients r2
          where r2.post_id = p_post.post_id
            and r2.recipient_user_id is not null
            and public.participant_closed_surface_visible(p_post, r2.recipient_user_id, p_viewer)
        ) then true
        else false
      end
    when p_post.status = 'open' and p_post.visibility = 'Public' then true
    when p_post.status = 'open' and p_post.visibility = 'OnlyMe' then false
    when p_post.status = 'open' and p_post.visibility = 'FollowersOnly' then
      public.is_following(p_viewer, p_post.owner_id)
    else false
  end;
$function$;

-- Body of 0468 plus one early return for a deactivated owner (covers legacy posts, rides and
-- native listings alike, since all of them carry the same owner).
create or replace function public.is_listing_visible_to(p_listing listings, p_viewer uuid)
returns boolean
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_post public.posts;
  v_ride public.ride_listings;
begin
  if p_listing.owner_id = p_viewer then
    return true;
  end if;

  if public.is_account_pending_deletion(p_listing.owner_id) then
    return false;
  end if;

  -- KC#1298: a listing the viewer reported stays hidden from them (FR-MOD-001 AC1).
  if exists (
    select 1 from public.reporter_hides h
     where h.reporter_id = p_viewer
       and h.target_type = 'listing'
       and h.target_id   = p_listing.listing_id
  ) then
    return false;
  end if;

  if p_listing.legacy_post_id is not null then
    select * into v_post from public.posts where post_id = p_listing.legacy_post_id;
    if not found then
      return false;
    end if;
    return public.is_post_visible_to(v_post, p_viewer);
  end if;

  if p_listing.legacy_ride_id is not null then
    select * into v_ride from public.ride_listings where ride_id = p_listing.legacy_ride_id;
    if not found then
      return false;
    end if;
    if v_ride.owner_id = p_viewer then
      return true;
    end if;
    if public.is_blocked(p_viewer, v_ride.owner_id) then
      return false;
    end if;
    if v_ride.status <> 'open' then
      return false;
    end if;
    return v_ride.visibility = 'Public'
      or (v_ride.visibility = 'FollowersOnly' and public.is_following(p_viewer, v_ride.owner_id));
  end if;

  if p_listing.moderation_status <> 'published' then
    return false;
  end if;

  if p_listing.status not in ('open', 'closed') then
    return false;
  end if;

  if public.is_blocked(p_viewer, p_listing.owner_id) then
    return false;
  end if;

  case p_listing.anonymity_level
    when 3 then
      return p_listing.status = 'open'
        or (p_listing.status = 'closed' and p_listing.owner_id = p_viewer);
    when 2 then
      return p_listing.status = 'open'
        and public.is_following(p_viewer, p_listing.owner_id);
    when 1 then
      return public.is_listing_operator(p_viewer);
    else
      return false;
  end case;
end;
$$;

-- ── 4. Account gate: report the purge date for a deactivated account ────────
create or replace function public.auth_check_account_gate(p_user_id uuid)
returns table (
  allowed boolean,
  reason  text,
  until_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_status text;
  v_until  timestamptz;
  v_purge  timestamptz;
begin
  if v_caller is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_caller <> p_user_id and not public.is_admin(v_caller) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.users
     set account_status       = 'active',
         account_status_until = null
   where user_id = p_user_id
     and account_status = 'suspended_for_false_reports'
     and account_status_until is not null
     and account_status_until <= now();
  if found then
    insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
    values (null, 'unsuspend_user', 'user', p_user_id,
            jsonb_build_object('lazy', true));
  end if;

  select account_status, account_status_until, deletion_purge_at
    into v_status, v_until, v_purge
    from public.users where user_id = p_user_id;

  if v_status = 'active' then
    return query select true, null::text, null::timestamptz;
    return;
  end if;

  -- A deactivated account reports its purge date, which the restore screen shows.
  return query select
    false,
    case v_status
      when 'banned' then 'banned'
      when 'suspended_admin' then 'suspended_admin'
      when 'suspended_for_false_reports' then 'suspended_for_false_reports'
      else v_status
    end,
    case when v_status = 'pending_deletion' then v_purge else v_until end;
end;
$$;

-- ── 5. Client-facing pair ───────────────────────────────────────────────────
-- Deactivates the caller's account for 30 days. Idempotent: a repeat call returns the
-- existing purge date. A suspended or banned user cannot use it (moderation evasion, Q5).
create or replace function public.rpc_request_account_deletion()
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_status text;
  v_purge  timestamptz;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  select account_status, deletion_purge_at into v_status, v_purge
    from public.users where user_id = v_uid for update;
  if not found then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  if v_status = 'pending_deletion' then
    return v_purge;
  end if;
  if v_status in ('suspended_for_false_reports', 'suspended_admin', 'banned', 'deleted') then
    raise exception 'suspended' using errcode = 'P0001';
  end if;

  v_purge := now() + interval '30 days';
  update public.users
     set status_before_deletion = account_status,
         account_status         = 'pending_deletion',
         deletion_requested_at  = now(),
         deletion_purge_at      = v_purge
   where user_id = v_uid;

  -- Push stops at once; everything else is kept for a possible restore.
  delete from public.devices where user_id = v_uid;

  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (v_uid, 'account_deletion_requested', 'user', v_uid,
          jsonb_build_object('purge_at', v_purge));
  return v_purge;
end;
$$;

-- Restores the caller's account while its grace period is running.
create or replace function public.rpc_restore_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_status text;
  v_before text;
  v_purge  timestamptz;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  select account_status, status_before_deletion, deletion_purge_at
    into v_status, v_before, v_purge
    from public.users where user_id = v_uid for update;
  if not found or v_status <> 'pending_deletion' then
    raise exception 'not_pending_deletion' using errcode = 'P0001';
  end if;
  if v_purge <= now() then
    raise exception 'grace_expired' using errcode = 'P0001';
  end if;

  update public.users
     set account_status         = coalesce(v_before, 'active'),
         status_before_deletion = null,
         deletion_requested_at  = null,
         deletion_purge_at      = null
   where user_id = v_uid;

  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (v_uid, 'account_restored', 'user', v_uid, '{}'::jsonb);
end;
$$;

revoke all on function public.rpc_request_account_deletion() from public, anon;
grant execute on function public.rpc_request_account_deletion() to authenticated;
revoke all on function public.rpc_restore_account() from public, anon;
grant execute on function public.rpc_restore_account() to authenticated;

-- ── 6. The hard delete, for the purge job only ──────────────────────────────
-- Same body as 0029's delete_account_data(), taking the user instead of auth.uid(). It deletes
-- what a deactivated account kept: posts, follow edges, blocks, reports, chats' user side and
-- finally the users row. The Edge Function then removes Storage objects and the auth identity.
create or replace function public.delete_account_data_for(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_avatar    text;
  v_paths     text[];
  v_audit_id  uuid;
  v_posts     int := 0;
  v_chats_a   int := 0;
  v_chats_d   int := 0;
begin
  select avatar_url into v_avatar from public.users where user_id = p_user_id;
  if not found then
    -- Idempotency: the row is already gone (a retry of a partly finished purge).
    return jsonb_build_object(
      'media_paths', '[]'::jsonb,
      'avatar_path', null,
      'counts',      jsonb_build_object('posts',0,'chats_anonymized',0,'chats_dropped',0)
    );
  end if;

  select coalesce(array_agg(path), '{}') into v_paths
    from public.media_assets
    where post_id in (select post_id from public.posts where owner_id = p_user_id);

  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
    values (p_user_id, 'delete_account', 'user', p_user_id,
            jsonb_build_object('actor_id_snapshot', p_user_id::text, 'purge', true))
    returning event_id into v_audit_id;

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

  delete from public.users where user_id = p_user_id;

  update public.audit_events
    set metadata = jsonb_build_object(
      'actor_id_snapshot', p_user_id::text,
      'purge',             true,
      'posts_deleted',     v_posts,
      'chats_anonymized',  v_chats_a,
      'chats_dropped',     v_chats_d
    )
    where event_id = v_audit_id;

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
revoke all on function public.delete_account_data_for(uuid) from public, anon, authenticated;
grant execute on function public.delete_account_data_for(uuid) to service_role;

-- The immediate, client-callable hard delete is retired: deletion now goes through
-- rpc_request_account_deletion().
revoke execute on function public.delete_account_data() from authenticated;

-- Accounts whose grace period has ended, oldest first; read by the purge job.
create or replace function public.accounts_due_for_purge(p_limit integer default 50)
returns table (user_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select u.user_id
    from public.users u
   where u.account_status = 'pending_deletion'
     and u.deletion_purge_at <= now()
   order by u.deletion_purge_at
   limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;
revoke all on function public.accounts_due_for_purge(integer) from public, anon, authenticated;
grant execute on function public.accounts_due_for_purge(integer) to service_role;

-- ── 7. Daily purge (03:30 UTC, after the 03:00 suspension sweep) ────────────
-- Same pg_net bridge as 0079: the purge needs the Storage API, so a cron job calls the
-- `purge-deleted-accounts` Edge Function with the service-role key.
do $mig$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'purge_deleted_accounts') then
      perform cron.unschedule('purge_deleted_accounts');
    end if;

    perform cron.schedule(
      'purge_deleted_accounts',
      '30 3 * * *',
      $cron$
      do $body$
      declare
        functions_url text := current_setting('app.settings.functions_url', true);
        service_key   text := current_setting('app.settings.service_role_key', true);
      begin
        if functions_url is null or functions_url = '' then
          raise warning 'purge_deleted_accounts: app.settings.functions_url not set — skipping';
          return;
        end if;
        perform net.http_post(
          url     := functions_url || '/functions/v1/purge-deleted-accounts',
          headers := jsonb_build_object(
            'Content-Type',  'application/json',
            'Authorization', 'Bearer ' || service_key
          ),
          body    := '{}'::jsonb
        );
      end;
      $body$;
      $cron$
    );
  end if;
end;
$mig$;

commit;
