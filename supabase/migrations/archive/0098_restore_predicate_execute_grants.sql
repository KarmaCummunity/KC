-- ─────────────────────────────────────────────
-- Migration 0098 — hotfix: restore EXECUTE on the five SECURITY DEFINER
-- predicate functions to `authenticated`. Production-only regression: when
-- production applied 0070 cleanly, `is_admin`, `is_blocked`, `is_following`,
-- `has_blocked`, and `active_posts_count_for_viewer` ended up with no
-- EXECUTE grant for the `authenticated` role, exactly as 0070 §1.2 / §15.2
-- instructed. The dev project happened to retain pre-0070 grants on these
-- five (documented in 0095 lines 21-26: "the companion predicates currently
-- still have EXECUTE granted to anon + authenticated despite the parallel
-- revoke in 0070 §2, which is why those policies kept working") — so the
-- regression never surfaced until the mobile app on `main` started hitting
-- the production project.
--
-- Same root cause that 0095 fixed for `is_active_member`: 0070's header
-- claimed "RLS predicates run as the function owner (postgres)" and that
-- "an explicit `revoke ... from authenticated` does NOT break the internal
-- call chain". 0095's investigation (verified directly on dev) proved this
-- wrong — RLS policy expressions evaluate as the calling role, and
-- SECURITY DEFINER only affects the function body's execution context. The
-- caller still needs EXECUTE on the function to invoke it from any context.
--
-- Production-observed symptoms (2026-05-17):
--
--   GET /rest/v1/users?...                         → 403  (users_select_active
--     in 0069 calls `public.is_blocked(auth.uid(), user_id)` from USING)
--   GET /rest/v1/posts?select=...,owner:users(...) → 403  (the embedded
--     `users` join trips the same users_select_active throw)
--   GET /rest/v1/posts (status=open, with joins)   → 403  (additive admin
--     policy `posts_select_super_admin` in 0049 calls
--     `public.is_admin(auth.uid())` from USING — every authenticated user
--     evaluates it because permissive policies are OR'd)
--   permission denied for function is_blocked      → ChatError surface from
--     `getMyChats` — `chats_select_visible` (0004 §247) delegates to
--     `is_chat_visible_to`, which inlines `public.has_blocked(...)` into the
--     RLS-eval context when called from PostgREST.
--   inbox loader (`startInboxSub`) crashes         → same chain.
--
-- A 42501 thrown inside any one permissive USING expression aborts the whole
-- SELECT — the OR over permissive policies does NOT swallow exceptions in
-- PostgREST; this is why even `users_select_self` (a pure `auth.uid() =
-- user_id` predicate that should always succeed for the owner) does not
-- "rescue" reads of one's own row.
--
-- Scope of fix. Pure GRANT, same shape as 0095 but for five functions
-- instead of one. No policy bodies, no function bodies, no column grants are
-- touched. Idempotent — safe to re-apply (dev will already report
-- `has_function_privilege` = true on each predicate before this migration
-- runs).
--
-- Audit posture. This re-opens the audit-2026-05-10 finding (§1.2 / §15.2
-- of `AUDIT_2026-05-10_full_codebase_review.md`): the five functions become
-- callable as direct PostgREST RPCs again. Severity matches TD-68: low —
-- user_ids are not secret, and the boolean returns disclose only edges
-- already inferable from feed/profile reads (block state, follow state,
-- admin flag, open-post count). The proper future fix (per 0095's note)
-- is one of:
--   (a) Inline each predicate's body into the RLS expressions that need it
--       and DROP the function — the most defensive but the highest-touch.
--   (b) Add a `current_setting('request.path', true) IS NULL` guard inside
--       each function body that aborts when invoked via
--       `POST /rest/v1/rpc/<fn>` while still permitting RLS / SECURITY
--       DEFINER callers (PostgREST sets `request.path`; internal callers do
--       not).
--   (c) Migrate the five predicates to a non-public schema (e.g. `internal_`)
--       and grant `usage` only to `postgres` — then no PostgREST surface.
-- Tracked in `docs/SSOT/TECH_DEBT.md` under TD-68 (scope extended to cover
-- the five 0070-revoked predicates alongside the 0090-revoked
-- `is_active_member`).
-- ─────────────────────────────────────────────

set search_path = public;

grant execute on function public.is_admin(uuid)                              to authenticated;
grant execute on function public.is_blocked(uuid, uuid)                      to authenticated;
grant execute on function public.is_following(uuid, uuid)                    to authenticated;
grant execute on function public.has_blocked(uuid, uuid)                     to authenticated;
grant execute on function public.active_posts_count_for_viewer(uuid, uuid)   to authenticated;

comment on function public.is_admin(uuid) is
  'Returns true when the given user has is_super_admin = true. Invoked from '
  'RLS USING clauses on the moderation/admin permissive policies '
  '(reports, audit_log, posts_select_super_admin, posts_update_super_admin, '
  'closure_cleanup_jobs_select_admin, stats_*_select_admin, etc.). EXECUTE '
  'restored to authenticated by 0098 after the 0070 §1.2 revoke broke every '
  'SELECT/UPDATE on tables that carry those additive admin policies. '
  'Re-opens the audit-2026-05-10 §1.2 enumeration finding — tracked in TD-68 '
  '(extended scope).';

comment on function public.is_blocked(uuid, uuid) is
  'Bilateral block predicate. Invoked from RLS USING on `users_select_active` '
  '(0069) and from inside `is_post_visible_to` (0091) / `is_chat_visible_to` '
  '/ post-discovery RPCs. EXECUTE restored to authenticated by 0098 — see '
  '0070 §1.2 / 0095 / TD-68 extended.';

comment on function public.is_following(uuid, uuid) is
  'Follow-edge predicate. Invoked from RLS USING on follow-gated visibility '
  '(FollowersOnly posts via `is_post_visible_to`). EXECUTE restored to '
  'authenticated by 0098.';

comment on function public.has_blocked(uuid, uuid) is
  'Directional block predicate (used in chat visibility + INSERT defense-in-'
  'depth). Invoked from `chats_select_visible` via `is_chat_visible_to` and '
  'from `messages_insert_user` WITH CHECK (0090 §2). EXECUTE restored to '
  'authenticated by 0098.';

comment on function public.active_posts_count_for_viewer(uuid, uuid) is
  'Visible-active-post counter for profile screens. Invoked from RLS USING '
  'on profile-counter projections. EXECUTE restored to authenticated by 0098.';

-- Self-test sanity (raises if any grant did not land).
do $check$
declare
  v_targets text[] := array[
    'public.is_admin(uuid)',
    'public.is_blocked(uuid, uuid)',
    'public.is_following(uuid, uuid)',
    'public.has_blocked(uuid, uuid)',
    'public.active_posts_count_for_viewer(uuid, uuid)'
  ];
  v_target  text;
  v_has_exec boolean;
begin
  foreach v_target in array v_targets loop
    select has_function_privilege('authenticated', v_target, 'execute')
      into v_has_exec;
    if not v_has_exec then
      raise exception
        'migration 0098: authenticated still lacks EXECUTE on %', v_target;
    end if;
  end loop;
end
$check$;
