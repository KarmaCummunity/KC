-- 0198_revoke_internal_function_execute | FR-CHAT-*, FR-KARMA-*, FR-ADMIN-* (security audit 2026-06-14)
--
-- Postgres grants EXECUTE on every function to PUBLIC by default. Several
-- SECURITY DEFINER functions are INTERNAL helpers — meant to be invoked only by
-- triggers, cron, or gated wrapper functions (all of which run as the function
-- OWNER) — but the default PUBLIC EXECUTE left them directly callable by any
-- authenticated (and often anon) client via PostgREST `rpc/`. Their bodies do
-- NOT gate on auth.uid(), so direct calls are exploitable (confirmed live):
--   * karma_apply / karma_grant_once → mint arbitrary karma for any user
--       (inserts karma_ledger + bumps users.karma_points for the passed p_user)
--   * inject_system_message          → forge `system` messages into any chat
--       (only checks the chat exists, not that the caller is a participant)
--   * admin_audit_lookup             → read any user's audit_events, bypassing
--       the is_admin gate that lives in admin_audit_lookup_guarded
--   * find_or_create_support_chat     → create support threads for arbitrary users
--
-- None has a direct app caller: the client uses admin_audit_lookup_guarded and the
-- support-thread RPC wrapper; karma_apply/karma_grant_once/inject_system_message
-- are trigger/RPC-only. Revoking client EXECUTE does not affect internal callers
-- (triggers, cron jobs, SECURITY DEFINER wrappers) because they execute as the
-- function owner, which retains EXECUTE.

begin;

revoke execute on function public.karma_apply(uuid, text, text, text, integer)      from public, anon, authenticated;
revoke execute on function public.karma_grant_once(uuid, text, text, text, integer) from public, anon, authenticated;
revoke execute on function public.inject_system_message(uuid, jsonb, text)          from public, anon, authenticated;
revoke execute on function public.admin_audit_lookup(uuid, integer)                 from public, anon, authenticated;
revoke execute on function public.find_or_create_support_chat(uuid)                 from public, anon, authenticated;

commit;
