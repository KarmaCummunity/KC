-- ─────────────────────────────────────────────
-- Migration 0095 — hotfix: restore EXECUTE on is_active_member to `authenticated`.
--
-- Closes a regression introduced by 0090 §1 (TD-68 mitigation): revoking
-- EXECUTE on `is_active_member(uuid)` from public/anon/authenticated broke
-- every INSERT policy that calls the predicate from its WITH CHECK clause —
-- `posts_insert_self` (0072 §1), `chats_insert_self` (0072 §2), and
-- `messages_insert_user` (rewritten by 0090 §2).
--
-- The 0090 header claimed "RLS policies run as the table-owner role, not the
-- calling role". That is incorrect. RLS policy expressions are evaluated as
-- the calling user, and SECURITY DEFINER only affects the function body's
-- execution context — the caller still needs EXECUTE on the function to invoke
-- it from any context (RLS predicates included). Verified directly on the dev
-- project:
--
--     set role authenticated;
--     select public.is_active_member(uuid_nil());
--   → ERROR  42501: permission denied for function is_active_member
--
-- The companion predicates (is_admin/is_blocked/is_following/has_blocked/
-- active_posts_count_for_viewer) currently still have EXECUTE granted to
-- anon + authenticated despite the parallel revoke in 0070 §2, which is why
-- those policies kept working; the inconsistency is tracked separately (TD-68
-- reopen note below) — fixing this single function unblocks the user-visible
-- 403 immediately.
--
-- User-visible symptom: client receives `POST /rest/v1/posts → 403`
-- (PostgREST surface of `42501`). The mobile error string maps `forbidden` →
-- "אין לך הרשאה לפעולה זו. נסה להתחבר מחדש" — re-login does not help because
-- the cause is RLS, not session state.
--
-- TD-68 (enumeration via POST /rest/v1/rpc/is_active_member) is intentionally
-- re-opened. The enumeration risk is low — user_ids are already disclosed by
-- feed/profile reads and the function only returns `active vs other` — but a
-- proper future fix should either (a) inline the `account_status = 'active'`
-- exists-test into the three INSERT policies and drop the function, or
-- (b) wrap the function with a `current_setting('request.path', true)` guard
-- that rejects direct PostgREST RPC calls.
--
-- Idempotent: a pure GRANT. Safe to re-apply.
-- ─────────────────────────────────────────────

set search_path = public;

grant execute on function public.is_active_member(uuid) to authenticated;

comment on function public.is_active_member(uuid) is
  'Returns true when the given user has account_status = active. Invoked from '
  'RLS WITH CHECK clauses on posts_insert_self / chats_insert_self / '
  'messages_insert_user (0072, 0090). EXECUTE restored to authenticated by '
  '0095 after the 0090 §1 revoke broke those policies. TD-68 (RPC enumeration) '
  'is reopened pending a proper fix.';

-- Self-test sanity (DO block, raises if the grant did not land).
do $check$
declare
  v_has_exec boolean;
begin
  select has_function_privilege('authenticated', 'public.is_active_member(uuid)', 'execute')
    into v_has_exec;
  if not v_has_exec then
    raise exception
      'migration 0095: authenticated still lacks EXECUTE on is_active_member';
  end if;
end
$check$;
