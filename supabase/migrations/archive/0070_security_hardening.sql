-- 0070_security_hardening | Closes 7 CRITICAL/HIGH findings from
--                          AUDIT_2026-05-10_full_codebase_review.md.
--
-- Sequence note: this migration was originally drafted as 0068 against a stale
-- main; rebased onto dev (which had already shipped 0068 verification-status
-- and 0069 privacy-mode-as-follow-flag) and renumbered to 0070. Content is
-- unchanged.
--
-- §1.1   anon can SELECT public.follow_edges — entire follow graph enumerable.
-- §1.2   is_admin / is_blocked / is_following callable over PostgREST by anon.
-- §15.2  active_posts_count_for_viewer / has_blocked callable over PostgREST by anon.
-- §15.3  rpc_get_or_create_support_thread races on read-then-insert; concurrent
--        callers receive unique_violation instead of the existing chat.
-- §15.11 inject_system_message is EXECUTE-granted to `authenticated` and has no
--        admin check — any signed-in user can forge a `system` message into any
--        chat whose UUID they obtain.
-- §15.5  posts.reopen_count is in the client-writable column grant — owners can
--        directly inflate it to either self-flag the moderation queue (waste of
--        admin time) or hide a real spam pattern by capping just under the 5-
--        reopen threshold.
-- §15.1  reports.resolved_at / reports.resolved_by are in the client-writable
--        column grant — clients can clobber admin-set values; the
--        reports_on_status_change trigger is the only intended writer.
--
-- The fixes are intentionally bundled in one migration: same class (grant
-- hardening on SECURITY DEFINER surface + tightening column grants + closing
-- one race in the support-thread RPC), same rollback story, same blast radius.
-- Backwards-compatible with all shipped client code (verified by grepping
-- app/packages/infrastructure-supabase/src and app/apps/mobile for callers).
--
-- §15.5 requires a small companion change: the closure flow's reopen-of-
-- deleted-no-recipient transition was a single-table client UPDATE that wrote
-- `reopen_count` directly (see 0015 lead-in comment). It moves into a new
-- SECURITY INVOKER RPC `reopen_post_deleted_no_recipient` so the client never
-- writes the column. `closureMethods.ts:reopenPost` is updated in the same PR.

set search_path = public;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. §1.1 — drop anon SELECT on follow_edges
-- ──────────────────────────────────────────────────────────────────────────
-- Authenticated grant intact (0003_init_following_blocking.sql:403).
-- Mobile + web never read follow_edges from a signed-out context; guest
-- preview surfaces only consume aggregate counts.
revoke select on public.follow_edges from anon;

-- ──────────────────────────────────────────────────────────────────────────
-- 2. §1.2 / §15.2 — lock SECURITY DEFINER predicate functions to authenticated
-- ──────────────────────────────────────────────────────────────────────────
-- These functions are SQL-internal: called from RLS USING clauses and from
-- other SECURITY DEFINER trigger functions. PostgREST exposure was never
-- intended. RLS predicates run as the function owner (postgres), so an
-- explicit `revoke ... from authenticated` does NOT break the internal call
-- chain; it only blocks direct `POST /rest/v1/rpc/<fn>` invocation.
--
-- Listing every variant: `from public, anon` covers both the default PUBLIC
-- grant (is_blocked / is_following / has_blocked, which had no explicit grant)
-- and the explicit anon grant on is_admin / active_posts_count_for_viewer.

revoke execute on function public.is_admin(uuid) from public, anon, authenticated;

revoke execute on function public.is_blocked(uuid, uuid) from public, anon, authenticated;

revoke execute on function public.is_following(uuid, uuid) from public, anon, authenticated;

revoke execute on function public.has_blocked(uuid, uuid) from public, anon, authenticated;

revoke execute on function public.active_posts_count_for_viewer(uuid, uuid)
  from public, anon, authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 3. §15.11 — drop client EXECUTE on inject_system_message
-- ──────────────────────────────────────────────────────────────────────────
-- Every caller is a SECURITY DEFINER trigger function (reports_after_insert_*,
-- closure system messages, donation-link report, owner notification). Those
-- run as the function owner (postgres) and reach this function through the
-- owner's implicit EXECUTE — they do NOT depend on the `authenticated` grant.
-- Revoking from `authenticated` blocks the forgery vector without affecting
-- any legitimate code path.
revoke execute on function public.inject_system_message(uuid, jsonb, text)
  from public, anon, authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 4. §15.3 — atomic upsert for rpc_get_or_create_support_thread
-- ──────────────────────────────────────────────────────────────────────────
-- Replaces the read-then-insert pattern in 0011_chat_helpers.sql lines 78-86.
-- The unique constraint on chats(participant_a, participant_b) drives the
-- conflict resolution. The DO UPDATE clause is a no-op whose purpose is to
-- make the upsert RETURN the existing row (DO NOTHING does not return rows).
-- Signature + grant unchanged so SupabaseChatRepository.getOrCreateSupportThread
-- continues to work without code changes.
create or replace function public.rpc_get_or_create_support_thread()
returns public.chats
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
  v_viewer   uuid := auth.uid();
  v_a        uuid;
  v_b        uuid;
  v_chat     public.chats;
begin
  if v_viewer is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select user_id into v_admin_id
  from public.users
  where is_super_admin = true
  limit 1;

  if v_admin_id is null then
    raise exception 'super_admin_not_found' using errcode = 'P0001';
  end if;

  if v_admin_id = v_viewer then
    raise exception 'super_admin_self_thread_forbidden' using errcode = 'P0001';
  end if;

  if v_viewer < v_admin_id then v_a := v_viewer; v_b := v_admin_id;
  else v_a := v_admin_id; v_b := v_viewer; end if;

  insert into public.chats (participant_a, participant_b, is_support_thread)
  values (v_a, v_b, true)
  on conflict (participant_a, participant_b) do update
    set participant_a = excluded.participant_a
  returning * into v_chat;

  return v_chat;
end;
$$;

-- Re-apply the client grant (CREATE OR REPLACE preserves grants in modern PG,
-- but be explicit so a stale local DB ends up in the right state).
grant execute on function public.rpc_get_or_create_support_thread() to authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 5a. §15.5 — drop posts.reopen_count from the client UPDATE grant
-- ──────────────────────────────────────────────────────────────────────────
-- After this revoke, reopen_count is writable only by SECURITY INVOKER RPCs
-- whose owner is postgres:
--   - reopen_post_marked              (0015, closed_delivered → open)
--   - reopen_post_deleted_no_recipient (this migration, see §6 below;
--                                       deleted_no_recipient → open)
-- The trigger posts_after_update_reopen_count (0005) reads the column and
-- emits the moderation queue entry at ≥5 — read-only, unaffected.

-- Revoke + re-grant is the safe shape because PostgreSQL column grants are
-- cumulative; revoking the entire UPDATE and re-granting the desired column
-- list is the only way to remove a single column from the existing grant.
revoke update on public.posts from authenticated;
grant update (
  status, visibility, title, description, category,
  city, street, street_number, location_display_level,
  item_condition, urgency, delete_after, updated_at
) on public.posts to authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 5b. §15.1 — drop reports.resolved_at / resolved_by from client UPDATE grant
-- ──────────────────────────────────────────────────────────────────────────
-- These columns are stamped by reports_on_status_change (0005:470-501) and
-- must never be written by clients. Clients still need UPDATE (status) for
-- their own rows under the existing reports_update_admin policy (admins
-- only). Removing the columns gives column-level defense in depth even if a
-- future RLS revision broadens the row-level predicate.
revoke update on public.reports from authenticated;
grant update (status) on public.reports to authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 6. reopen_post_deleted_no_recipient — new RPC backing the §5a removal
-- ──────────────────────────────────────────────────────────────────────────
-- Sister of reopen_post_marked (0015) for the deleted_no_recipient → open
-- transition. Single-table UPDATE; trigger posts_after_change_counters
-- handles items_given −1 when applicable.
--
-- SECURITY INVOKER (same posture as 0015) — the owner check is explicit so
-- callers see a clean PostError code instead of an opaque RLS rejection.
create or replace function public.reopen_post_deleted_no_recipient(p_post_id uuid)
returns public.posts
language plpgsql
security invoker
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

grant execute on function public.reopen_post_deleted_no_recipient(uuid) to authenticated;

-- end of 0068_security_hardening
