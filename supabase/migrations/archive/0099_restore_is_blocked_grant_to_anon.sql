-- ─────────────────────────────────────────────
-- Migration 0099 — hotfix: restore EXECUTE on `is_blocked` to `anon`.
--
-- Production-only regression, observed 2026-05-18 on the guest-preview
-- surface (FR-AUTH-014):
--
--   GET /rest/v1/posts?select=...,owner:users(...)&status=eq.open&limit=7
--     → 401 / { "code": "42501", "message": "permission denied for function is_blocked" }
--
-- The guest feed query embeds `owner:users!posts_owner_id_fkey(...)`. The
-- `users` join is RLS-gated by `users_select_active` (migration 0069 line 54)
-- whose USING clause directly calls `public.is_blocked(auth.uid(), user_id)`.
-- RLS policy expressions evaluate as the calling role (verified in 0095 lines
-- 9-19), so the `anon` role needs EXECUTE on `is_blocked` even though the
-- function itself is SECURITY DEFINER. When 0070 §1.2 revoked EXECUTE from
-- `public, anon, authenticated`, the production project applied the revoke
-- cleanly and lost the `anon` grant. 0098 restored the grant to
-- `authenticated`, which fixed signed-in surfaces; the guest surface stayed
-- broken because `anon` was not restored.
--
-- The dev project happened to retain pre-0070 grants on all five companion
-- predicates for both `anon` and `authenticated` (the parallel revokes in
-- 0070 §2 never fired on dev — documented at 0095 lines 21-26 and again at
-- 0098 lines 8-13), which is why the guest regression never surfaced on the
-- dev environment.
--
-- Scope of fix. Pure GRANT, smallest possible step to unbreak the
-- user-visible guest surface. The remaining four 0070-revoked predicates
-- (`is_admin`, `is_following`, `has_blocked`, `active_posts_count_for_viewer`)
-- are NOT granted to `anon` here because the anon code path never reaches
-- them:
--   - `is_admin` is invoked only from `posts_select_super_admin` (0049
--     line 26) which is `FOR SELECT TO authenticated` — anon does not
--     evaluate it.
--   - `is_following` is invoked from `is_post_visible_to` (0091 line 131)
--     which is SECURITY DEFINER, so internal calls run as the function
--     owner; anon never invokes it directly.
--   - `has_blocked` is invoked from chat-visibility predicates which anon
--     cannot reach (anon has no SELECT grant on `chats` / `messages`).
--   - `active_posts_count_for_viewer` is a profile-counter helper called
--     from the app layer; anon does not call it.
--
-- Audit posture. Re-confirms (does not widen) the audit-2026-05-10 §1.2
-- enumeration finding for `is_blocked` — the function becomes RPC-callable
-- by anon as it was before 0070. Severity matches the rest of TD-68: low —
-- the boolean discloses only block-edge state, blocking is not currently a
-- user-visible feature (0069 line 53: "today it short-circuits to false"),
-- and `user_id` values are already inferable from public posts / profiles.
-- TD-68 scope is extended in this migration to track the anon spillover.
--
-- Idempotent: pure GRANT. Safe to re-apply (dev will already report
-- `has_function_privilege` = true for `anon`).
-- ─────────────────────────────────────────────

set search_path = public;

grant execute on function public.is_blocked(uuid, uuid) to anon;

comment on function public.is_blocked(uuid, uuid) is
  'Bilateral block predicate. Invoked from RLS USING on `users_select_active` '
  '(0069) and from inside `is_post_visible_to` (0091) / `is_chat_visible_to` '
  '/ post-discovery RPCs. EXECUTE granted to authenticated by 0098 and to '
  'anon by 0099 (guest preview surface). See 0070 §1.2 / 0095 / TD-68 '
  '(extended scope).';

-- Self-test sanity (raises if the grant did not land).
do $check$
declare
  v_has_exec boolean;
begin
  select has_function_privilege('anon', 'public.is_blocked(uuid, uuid)', 'execute')
    into v_has_exec;
  if not v_has_exec then
    raise exception
      'migration 0099: anon still lacks EXECUTE on public.is_blocked(uuid, uuid)';
  end if;
end
$check$;
