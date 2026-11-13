/**
 * Every staff role the database knows (`kc_private.admin_roles`, FR-ADMIN-027, FR-FIN-002),
 * platform roles first. A grant of a role missing here would vanish from every list, so the
 * list follows the database vocabulary exactly.
 */
export const KNOWN_ADMIN_ROLES = [
  'super_admin', 'admin', 'moderator', 'support',
  'operator', 'operators_manager',
  'org_admin', 'org_manager', 'org_employee',
  'org_treasurer', 'org_accountant',
  'volunteer_manager', 'org_volunteer', 'volunteer',
] as const;

export type AdminRole = (typeof KNOWN_ADMIN_ROLES)[number];

/** The role a server value names, or null for a value the app does not know. */
export function parseAdminRole(value: string | null | undefined): AdminRole | null {
  if (value == null) return null;
  return (KNOWN_ADMIN_ROLES as readonly string[]).includes(value)
    ? (value as AdminRole)
    : null;
}
