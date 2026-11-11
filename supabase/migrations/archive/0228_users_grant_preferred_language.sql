-- 0228_users_grant_preferred_language — FR-TRANSLATE-003
--
-- 0207 added public.users.preferred_language but never granted UPDATE on it,
-- and 0196 (security audit) had already revoked the table-wide UPDATE grant
-- and re-granted only a fixed column list that predates 0207. Result: the
-- reader-language picker's PATCH users?user_id=eq.<uuid> is rejected with
-- Postgres insufficient_privilege -> PostgREST 403, even though the RLS
-- policy (row ownership) passes.
--
-- Fix: grant UPDATE on just this column, following the 0196 pattern.

begin;

grant update (preferred_language) on public.users to authenticated;

commit;
