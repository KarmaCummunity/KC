-- Migration: replace the admin_role_grants read policy to consume the new
-- has_admin_role predicate rather than the legacy is_admin/users.is_super_admin
-- denormalisation. Closes a layering smell flagged in code review of A0.
-- Mapped to spec: FR-ADMIN-010.

drop policy if exists admin_role_grants_super_admin_read_all on public.admin_role_grants;

create policy admin_role_grants_super_admin_read_all
  on public.admin_role_grants for select
  using (public.has_admin_role(auth.uid(), 'super_admin'));
