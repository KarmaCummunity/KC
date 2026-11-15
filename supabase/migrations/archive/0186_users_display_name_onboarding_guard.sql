-- 0186_users_display_name_onboarding_guard.sql — TD-90.
--
-- 0084 dropped NOT NULL on users.display_name and relaxed users_display_name_check
-- to allow NULL unconditionally, so handle_new_user can defer the name to the
-- basic-info onboarding step. The side effect: a user (column-level UPDATE grant)
-- can set display_name back to NULL *after* onboarding — a blank-profile / self-
-- grief vector. Add a forward-enforcing guard: a NULL display_name is only valid
-- while onboarding_state = 'pending_basic_info'.
--
-- NOT VALID so the migration applies cleanly regardless of any legacy rows; a
-- CHECK still enforces on every subsequent INSERT/UPDATE (constraints are not
-- skipped for new writes when NOT VALID — only the initial full-table scan is).

BEGIN;

alter table public.users
  drop constraint if exists users_display_name_onboarding_check;
alter table public.users
  add constraint users_display_name_onboarding_check
  check (display_name is not null or onboarding_state = 'pending_basic_info') not valid;

COMMIT;
