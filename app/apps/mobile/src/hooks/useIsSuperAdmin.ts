/**
 * FR-ADMIN-009 — UI-only convenience flag. The server re-checks the role inside every staff
 * RPC (`kc_private.require_admin_role`), so a tampered client cannot escalate. Derived from the
 * caller's own staff roles (`get_my_admin_roles()`, cached for the session by `useAdminRoles`):
 * the super admin is the member whose roles contain `super_admin`. While the roles load, or when
 * they cannot be read, the flag is false (fail closed).
 */
import { useAdminRoles } from './useAdminRoles';

export function useIsSuperAdmin(): boolean {
  const { roles } = useAdminRoles();
  return roles.includes('super_admin');
}
