-- 0029_delete_account_rpc | P2.2 — FR-SETTINGS-012 V1
-- Extend audit_events.action allowed set with 'delete_account', and define
-- the SECURITY DEFINER RPC that performs the DB portion of self-deletion.
-- The RPC takes no parameter (identity comes from auth.uid() only) and is
-- explicitly granted only to authenticated, never to public/anon.

set search_path = public;

-- ── 1. Extend audit_events.action CHECK ─────────────────────────────────────
alter table public.audit_events drop constraint audit_events_action_check;
alter table public.audit_events
  add constraint audit_events_action_check
  check (action in (
    'block_user','unblock_user',
    'report_target',
    'auto_remove_target','manual_remove_target','restore_target',
    'suspend_user','unsuspend_user',
    'false_report_sanction_applied',
    'dismiss_report','confirm_report',
    'delete_account'
  ));

-- ── 2. delete_account_data() RPC ────────────────────────────────────────────
create or replace function public.delete_account_data()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id   uuid;
  v_status    text;
  v_avatar    text;
  v_paths     text[];
  v_audit_id  uuid;
  v_posts     int := 0;
  v_chats_a   int := 0;
  v_chats_d   int := 0;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  -- Status gate (Q5): block suspended / banned to prevent moderation evasion.
  select account_status, avatar_url into v_status, v_avatar
    from public.users where user_id = v_user_id;
  if not found then
    -- Idempotency: user row already gone (retry of a partially-completed flow).
    return jsonb_build_object(
      'media_paths', '[]'::jsonb,
      'avatar_path', null,
      'counts',      jsonb_build_object('posts',0,'chats_anonymized',0,'chats_dropped',0)
    );
  end if;
  if v_status in ('suspended_for_false_reports','suspended_admin','banned') then
    raise exception 'suspended' using errcode = 'P0001';
  end if;

  -- 1. Snapshot media paths BEFORE post deletion cascades clear them.
  select coalesce(array_agg(path), '{}') into v_paths
    from public.media_assets
    where post_id in (select post_id from public.posts where owner_id = v_user_id);

  -- 2. Audit row. actor_id will be nulled by FK cascade at step 6 — snapshot
  --    the user_id into metadata so the audit trail retains it.
  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
    values (v_user_id, 'delete_account', 'user', v_user_id,
            jsonb_build_object('actor_id_snapshot', v_user_id::text))
    returning event_id into v_audit_id;

  -- 3. Explicit per-user cleanup (before users delete).
  delete from public.devices          where user_id      = v_user_id;
  delete from public.follow_edges     where follower_id  = v_user_id or followed_id = v_user_id;
  delete from public.follow_requests  where requester_id = v_user_id or target_id   = v_user_id;
  delete from public.blocks           where blocker_id   = v_user_id or blocked_id  = v_user_id;
  delete from public.reports          where reporter_id  = v_user_id or target_id   = v_user_id;
  delete from public.donation_links   where submitted_by = v_user_id;
  -- donation_links.hidden_by has no on-delete action — null it explicitly to
  -- avoid an FK violation later when auth.admin.deleteUser fires.
  update public.donation_links set hidden_by = null where hidden_by = v_user_id;
  delete from public.auth_identities  where user_id      = v_user_id;

  -- 4. Posts (cascades to recipients, media_assets — paths already captured).
  select count(*) into v_posts from public.posts where owner_id = v_user_id;
  delete from public.posts where owner_id = v_user_id;

  -- 5. Chats: drop orphans first (other side already NULL), then null-out the
  --    remaining ones. The CHECK constraint from migration 0028 prevents
  --    rows with both participants NULL from being created.
  select count(*) into v_chats_d from public.chats
    where (participant_a = v_user_id and participant_b is null)
       or (participant_b = v_user_id and participant_a is null);
  delete from public.chats
    where (participant_a = v_user_id and participant_b is null)
       or (participant_b = v_user_id and participant_a is null);

  -- Count the unique chats that will be anonymized in a single query before
  -- updating; this is more accurate than summing GET DIAGNOSTICS across the
  -- two UPDATEs (a chat only has the deletee on one side, but we want one
  -- count for the audit metadata regardless of which side).
  select count(*) into v_chats_a from public.chats
    where participant_a = v_user_id or participant_b = v_user_id;
  update public.chats set participant_a = null where participant_a = v_user_id;
  update public.chats set participant_b = null where participant_b = v_user_id;

  -- 6. Delete public.users. FK cascade to auth.users does NOT fire (FK is
  --    public->auth, not auth->public). The Edge Function calls
  --    auth.admin.deleteUser() next; that DOES cascade-delete public.users
  --    too but the row is already gone here.
  delete from public.users where user_id = v_user_id;

  -- 7. Finalize audit metadata with the counts gathered.
  update public.audit_events
    set metadata = jsonb_build_object(
      'actor_id_snapshot', v_user_id::text,
      'posts_deleted',     v_posts,
      'chats_anonymized',  v_chats_a,
      'chats_dropped',     v_chats_d
    )
    where event_id = v_audit_id;

  -- 8. Return paths to the caller (service-role Edge Function) for storage
  --    cleanup, plus counts for telemetry.
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

-- ── 3. Lock down execution ──────────────────────────────────────────────────
revoke execute on function public.delete_account_data() from public;
grant  execute on function public.delete_account_data() to authenticated;
