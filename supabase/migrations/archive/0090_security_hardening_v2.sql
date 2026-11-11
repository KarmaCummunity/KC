-- ─────────────────────────────────────────────
-- Migration 0090 — BACKLOG P2.12 (audit 2026-05-16) — BE Security Hardening v2
-- (Renumbered from 0085: unique version required; 0085 reserved for post_actor FR-POST-021.)
--
-- Closes 3 BE-side HIGH findings from the 2026-05-16 audit
-- (`docs/SSOT/audit/2026-05-16/01_backend_security.md`):
--
--   TD-67  `messages_insert_user` (rewritten by 0072) dropped the
--          `chats.removed_at IS NULL` guard added in 0028 §5 and reverted to
--          the NULL-poisoned `auth.uid() IN (a, b)` form that 0028's comment
--          explicitly warned against. A user could INSERT messages into a
--          chat that they (or the counterpart) soft-removed.
--
--   TD-68  `is_active_member(uuid)` (introduced by 0072) is `SECURITY DEFINER`
--          and granted EXECUTE to `authenticated`, callable as
--          `POST /rest/v1/rpc/is_active_member` with any uuid. Same enumeration
--          class that 0070 §1.2 / §15.2 closed for `is_admin`, `is_blocked`,
--          `is_following`, `has_blocked`. Revoke + rely on policy-context
--          evaluation (RLS policies run as the table-owner role, not the
--          calling role).
--
--   TD-75  `messages_insert_user` lacks a `has_blocked` check. EXEC-9 deferred
--          user-visible block actions, so the `blocks` table is empty today,
--          but the policy must be correct on day-one of P3.1. A counterpart
--          who has blocked the sender currently could (post-P3.1) INSERT
--          messages, fire `messages_enqueue_notification`, and produce a push
--          to the blocker — direct violation of FR-CHAT-009 AC3.
--
-- Idempotent: revoke-then-grant cycle; drop-then-create policy. Safe to
-- re-apply.
-- ─────────────────────────────────────────────

set search_path = public;

-- ── 1. TD-68 — Revoke EXECUTE on `is_active_member` from PostgREST roles ────
-- The function remains callable from RLS-policy contexts (policies execute
-- as the table-owner role, not the calling role) and from SECURITY DEFINER
-- functions that wrap it. Pattern mirrors 0070 §1.2 + §15.2 for the sibling
-- predicate functions.
revoke execute on function public.is_active_member(uuid) from public;
revoke execute on function public.is_active_member(uuid) from anon;
revoke execute on function public.is_active_member(uuid) from authenticated;

comment on function public.is_active_member(uuid) is
  'TD-68 (audit 2026-05-16, P2.12): EXECUTE revoked from public/anon/authenticated. '
  'Reachable only via RLS policies (owner-role context) and SECURITY DEFINER wrappers. '
  'Same posture as is_admin/is_blocked/is_following/has_blocked after 0070.';

-- ── 2. TD-67 + TD-75 — Rewrite `messages_insert_user` ──────────────────────
-- Composed of:
--   • Account-gate from 0072 (`is_active_member(auth.uid())`).
--   • Kind/payload/status hardening from 0072 (`kind = 'user' AND ...`).
--   • Restored `chats.removed_at IS NULL` guard from 0028 §5.
--   • NULL-safe participant equality from 0028 §5
--     (`auth.uid() = participant_a OR auth.uid() = participant_b` instead of
--     `auth.uid() IN (participant_a, participant_b)`).
--   • New `has_blocked` defense-in-depth — the counterpart who has blocked
--     the sender denies the INSERT (NOT EXISTS form to keep the WITH CHECK
--     evaluable in PostgREST + to play nice with the existing has_blocked
--     SECURITY DEFINER predicate).
drop policy if exists messages_insert_user on public.messages;
create policy messages_insert_user on public.messages
  for insert
  to authenticated
  with check (
    auth.uid() = sender_id
    and kind = 'user'
    and system_payload is null
    and status = 'pending'
    and public.is_active_member(auth.uid())
    and exists (
      select 1 from public.chats c
      where c.chat_id = messages.chat_id
        and c.removed_at is null
        and (auth.uid() = c.participant_a or auth.uid() = c.participant_b)
        and not public.has_blocked(
          case
            when auth.uid() = c.participant_a then c.participant_b
            else c.participant_a
          end,
          auth.uid()
        )
    )
  );

comment on policy messages_insert_user on public.messages is
  'TD-67/TD-75 (audit 2026-05-16, P2.12): restores removed_at guard from 0028 §5, '
  'NULL-safe participant equality, has_blocked defense-in-depth ahead of P3.1 / EXEC-9, '
  'keeps is_active_member gate and user-kind hardening from 0072.';

-- ── 3. Self-test sanity (DO block, raises on policy missing) ────────────────
-- A migration-time check that the policy parses with the right column count.
-- Aborts the migration if PostgreSQL rejected the policy silently.
do $check$
declare
  v_count int;
begin
  select count(*) into v_count
  from pg_policies
  where schemaname = 'public'
    and tablename = 'messages'
    and policyname = 'messages_insert_user';
  if v_count <> 1 then
    raise exception 'migration 0085: messages_insert_user policy missing after rewrite (count=%)', v_count;
  end if;
end
$check$;
