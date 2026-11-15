-- 0358_users_grant_select_preferred_language | QA pass (e2e on dev)
-- Bug: every signed-in page load fires
--   GET /rest/v1/users?select=...,preferred_language&user_id=eq.<me>  -> 403
-- 0163 revoked table-wide SELECT on public.users and re-granted a fixed column list;
-- 0207 added preferred_language later and 0228 only granted UPDATE on it. The own-profile
-- fetch (SupabaseUserRepository) selects the column, so the whole request is rejected.
-- Fix: grant SELECT on just this column to authenticated (RLS still scopes rows).

begin;

grant select (preferred_language) on public.users to authenticated;

commit;
