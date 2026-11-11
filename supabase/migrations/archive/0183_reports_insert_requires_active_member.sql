-- 0183_reports_insert_requires_active_member.sql — TD-88 / D-57.
--
-- Gate `reports_insert_self` on `is_active_member(auth.uid())` so suspended or
-- banned users can no longer file (retaliatory) reports via the direct
-- PostgREST path. Consistent with the 0072 INSERT-active stance already enforced
-- on posts / chats / messages, and with the `suspended_for_false_reports`
-- sanction (a user suspended for abusing reports must not keep filing them).
--
-- Defense-in-depth: the mobile client already routes suspended/banned users to
-- /account-blocked (useEnforceAccountGate), so this closes the server-side
-- bypass rather than changing any in-app flow. FR-MOD-001 has no AC requiring
-- a non-active user to be able to report. `is_active_member` already holds
-- EXECUTE for `authenticated` (0072 + restored by 0098).

BEGIN;

drop policy if exists reports_insert_self on public.reports;
create policy reports_insert_self on public.reports
  for insert
  with check (
    auth.uid() = reporter_id
    and status = 'open'
    and public.is_active_member(auth.uid())
  );

COMMIT;
