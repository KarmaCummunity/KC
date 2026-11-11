-- 0199_posts_guard_client_status_transition | TD-172 (security audit 2026-06-14, finding M2)
--
-- Problem (live-verified on dev):
--   Supabase's default privileges grant `authenticated` a table-wide UPDATE on
--   `public.posts`, and `posts_update_self` is an ownership-only RLS policy with
--   no value guard. A post owner could therefore issue a raw PostgREST UPDATE
--   that bypasses the closure state-machine entirely:
--     • `status = 'closed_delivered'`  → the `karma_on_post_change` AFTER trigger
--        mints closure karma (giver +20 / receiver +15) with no real delivery;
--     • `status = 'removed_admin'`     → fakes a moderation removal;
--     • `status = 'expired'`           → fakes the day-300 expiry;
--     • `reopen_count = 0`             → resets the reopen ceiling.
--   (0070 already revoked the table-wide grant and re-granted a narrow column
--   list, but the default-privilege `GRANT ALL` has drifted back on the live
--   dev/prod DBs — see the audit's "Systemic root cause" — so on those DBs the
--   only enforcement is RLS, which doesn't gate values.)
--
-- Fix — two coordinated parts:
--   1. A BEFORE UPDATE guard trigger that, for CLIENT-originated updates only,
--      allows just `open → deleted_no_recipient` (the lone legitimate
--      client-direct transition, used by close-without-recipient in
--      `closureMethods.ts`) and forbids any `reopen_count` change. Trusted
--      server contexts bypass via `current_user not in ('authenticated','anon')`.
--   2. Move every OTHER status transition behind SECURITY DEFINER RPCs (the
--      audit's recommended shape). `close_post_with_recipient`,
--      `reopen_post_marked` and `reopen_post_deleted_no_recipient` were SECURITY
--      INVOKER; they each already assert `auth.uid() = owner` explicitly, so
--      DEFINER is safe and additionally lets them write the server-managed
--      `reopen_count` column regardless of the (narrow) client grant. As DEFINER
--      they run as `postgres`, so the guard trigger above lets them through.
--
-- Latent bug this also fixes: because `reopen_count` is NOT in 0070's client
-- grant, the INVOKER reopen RPCs raised `permission denied for table posts`
-- whenever the broad grant was correctly narrow (e.g. a fresh CI stack) —
-- reopen only "worked" on the drifted dev/prod DBs. DEFINER fixes that.
--
-- Side effect: `reopen_post_deleted_no_recipient` (created in 0070) was found
-- MISSING from the live dev catalog (drift); recreating it here heals that.
--
-- Mapped to spec: FR-CLOSURE-001..005 (closure state machine), FR-KARMA-005
--   (closure karma is server-authoritative). No new ACs.

set search_path = public;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Guard trigger — runs as the CALLER (security invoker) so current_user
--    reflects the real role. Must NOT be security definer.
-- ──────────────────────────────────────────────────────────────────────────
create or replace function public.posts_guard_client_status_transition()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Trusted server contexts bypass: every privileged status writer
  -- (close_post_with_recipient, reopen_post_marked,
  -- reopen_post_deleted_no_recipient, rpc_recipient_unmark_self, admin_remove_post,
  -- admin_restore_target, the report-effects + posts_expiry_transition
  -- triggers/cron) is SECURITY DEFINER owned by `postgres`; service_role /
  -- direct postgres are operators. Only PostgREST clients run as
  -- 'authenticated'/'anon'.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  -- === remaining: a raw client UPDATE by the post owner ===

  -- reopen_count is server-managed (bumped only by the reopen RPCs).
  if new.reopen_count is distinct from old.reopen_count then
    raise exception 'posts_reopen_count_is_server_managed'
      using errcode = 'check_violation';
  end if;

  -- Status: the only client-direct transition is open -> deleted_no_recipient
  -- (close-without-recipient). closed_delivered (mints karma), removed_admin
  -- (moderation), expired (cron) and the reopen transitions must all go through
  -- their SECURITY DEFINER RPC / privileged path.
  if new.status is distinct from old.status
     and not (old.status = 'open' and new.status = 'deleted_no_recipient') then
    raise exception 'posts_illegal_status_transition'
      using errcode = 'check_violation',
            detail  = format('client status change %s -> %s is not permitted',
                             old.status, new.status);
  end if;

  return new;
end;
$$;

drop trigger if exists posts_guard_client_status_transition on public.posts;
create trigger posts_guard_client_status_transition
  before update on public.posts
  for each row
  execute function public.posts_guard_client_status_transition();

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Move the status-changing closure/reopen RPCs behind SECURITY DEFINER.
--    Bodies are otherwise the current canonical definitions (0017 / 0015 / 0070);
--    the only change is `security invoker` → `security definer`. Each already
--    asserts auth.uid() = owner, so DEFINER does not weaken authorization.
-- ──────────────────────────────────────────────────────────────────────────

-- 2a. close_post_with_recipient (canonical: 0017) — open -> closed_delivered.
create or replace function public.close_post_with_recipient(p_post_id uuid, p_recipient_user_id uuid)
returns public.posts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner   uuid;
  v_status  text;
  v_post    public.posts;
  v_user_ok boolean;
begin
  -- Lock the post row to serialize concurrent close attempts.
  select owner_id, status into v_owner, v_status
    from public.posts
   where post_id = p_post_id
   for update;

  if v_owner is null then
    raise exception 'closure_wrong_status' using errcode = 'P0001';
  end if;
  if v_owner <> auth.uid() then
    raise exception 'closure_not_owner' using errcode = 'P0001';
  end if;
  if v_status <> 'open' then
    raise exception 'closure_wrong_status' using errcode = 'P0001';
  end if;

  -- Reject self-recipient (owner cannot mark themselves).
  if v_owner = p_recipient_user_id then
    raise exception 'closure_recipient_not_in_chat' using errcode = 'P0001';
  end if;

  -- Validate the recipient user exists.
  select exists (select 1 from public.users where user_id = p_recipient_user_id)
    into v_user_ok;
  if not v_user_ok then
    raise exception 'closure_recipient_not_in_chat' using errcode = 'P0001';
  end if;

  -- Insert recipient first (trigger fires items_received +1).
  insert into public.recipients (post_id, recipient_user_id)
       values (p_post_id, p_recipient_user_id);

  -- Then flip status (trigger fires items_given +1).
  update public.posts
     set status = 'closed_delivered',
         delete_after = null,
         updated_at = now()
   where post_id = p_post_id
   returning * into v_post;

  return v_post;
end;
$$;

-- 2b. reopen_post_marked (canonical: 0015) — closed_delivered -> open.
create or replace function public.reopen_post_marked(p_post_id uuid)
returns public.posts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner   uuid;
  v_status  text;
  v_post    public.posts;
begin
  select owner_id, status into v_owner, v_status
    from public.posts
   where post_id = p_post_id
   for update;

  if v_owner is null then
    raise exception 'closure_wrong_status' using errcode = 'P0001';
  end if;
  if v_owner <> auth.uid() then
    raise exception 'closure_not_owner' using errcode = 'P0001';
  end if;
  if v_status <> 'closed_delivered' then
    raise exception 'closure_wrong_status' using errcode = 'P0001';
  end if;

  -- Delete the recipient row (trigger fires items_received -1).
  delete from public.recipients where post_id = p_post_id;

  -- Flip status back to open + bump reopen_count (trigger fires items_given -1).
  update public.posts
     set status = 'open',
         reopen_count = reopen_count + 1,
         delete_after = null,
         updated_at = now()
   where post_id = p_post_id
   returning * into v_post;

  return v_post;
end;
$$;

-- 2c. reopen_post_deleted_no_recipient (canonical: 0070; recreated to heal
--     dev-DB drift) — deleted_no_recipient -> open.
create or replace function public.reopen_post_deleted_no_recipient(p_post_id uuid)
returns public.posts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner   uuid;
  v_status  text;
  v_post    public.posts;
begin
  select owner_id, status into v_owner, v_status
    from public.posts
   where post_id = p_post_id
   for update;

  if v_owner is null then
    raise exception 'closure_wrong_status' using errcode = 'P0001';
  end if;
  if v_owner <> auth.uid() then
    raise exception 'closure_not_owner' using errcode = 'P0001';
  end if;
  if v_status <> 'deleted_no_recipient' then
    raise exception 'closure_wrong_status' using errcode = 'P0001';
  end if;

  update public.posts
     set status = 'open',
         reopen_count = reopen_count + 1,
         delete_after = null,
         updated_at = now()
   where post_id = p_post_id
   returning * into v_post;

  return v_post;
end;
$$;

revoke execute on function public.reopen_post_deleted_no_recipient(uuid) from public;
grant  execute on function public.reopen_post_deleted_no_recipient(uuid) to authenticated;

comment on function public.posts_guard_client_status_transition() is
  'TD-172: rejects illegal client-direct posts.status transitions + reopen_count rewrites. Trusted SECURITY DEFINER writers (postgres) bypass via current_user.';
