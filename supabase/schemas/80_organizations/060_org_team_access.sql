-- Organizations · team screen access
--
-- An organization's administrators manage its team (FR-ADMIN-030), so they must read the
-- role grants scoped to their own organization. The platform module only opens the roster
-- to platform staff; this adds the organization-scoped read next to it.

create policy admin_role_grants_select_org_admin on public.admin_role_grants
  for select to authenticated
  using (scope_org_id = any (kc_access.managed_org_ids()));
