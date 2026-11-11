-- 0103_about_team_members_select_policy | Public read for active team roster.
-- The companion public.about_team_profiles view already grants SELECT to
-- anon + authenticated; without an underlying-table policy, anything other
-- than `security definer` view access would be silently empty.
-- Also satisfies supabase/tests/rls-lint.sql (every RLS-enabled table needs
-- ≥1 policy). Writes remain service-role-only (no INSERT/UPDATE/DELETE
-- policies — roster is migration-managed).

create policy "about_team_members_select_active"
  on public.about_team_members
  for select
  to anon, authenticated
  using (is_active = true);
