import type { AdminRole } from './AdminRole';

export interface AdminGrant {
  readonly grantId: string;
  readonly userId: string;
  readonly displayName: string | null;
  readonly avatarUrl: string | null;
  readonly role: AdminRole;
  /** Org the grant applies to; null for platform-scoped grants (FR-ADMIN-016). */
  readonly scopeOrgId: string | null;
  readonly grantedAt: Date;
  readonly grantedBy: string | null;
  readonly grantedByDisplayName: string | null;
  readonly revokedAt: Date | null;
  readonly revokedBy: string | null;
  readonly lastSeenAt: Date | null;
}

export function isAdminGrantActive(g: AdminGrant): boolean {
  return g.revokedAt === null;
}

/** Every role the portal can grant; super_admin is DB-only (CLAUDE.md §7). */
export type GrantableAdminRole = Exclude<AdminRole, 'super_admin'>;

/** Grantable roles, highest authority first (FR-ADMIN-016 V2 hierarchy). */
export const GRANTABLE_ADMIN_ROLES: readonly GrantableAdminRole[] = [
  'moderator', 'support',
  'org_admin', 'org_manager', 'operators_manager', 'volunteer_manager',
  'org_employee', 'operator', 'org_volunteer',
];

export function isGrantableAdminRole(role: AdminRole): role is GrantableAdminRole {
  return GRANTABLE_ADMIN_ROLES.includes(role as GrantableAdminRole);
}

/** Roles granted on the platform (null scope); every other grantable role needs an org. */
const PLATFORM_GRANT_ROLES: ReadonlySet<GrantableAdminRole> = new Set(['moderator', 'support']);

export function isPlatformGrantRole(role: GrantableAdminRole): boolean {
  return PLATFORM_GRANT_ROLES.has(role);
}

/** Whether `scopeOrgId` has the shape `role` requires (mirrors `admin_grant_role`). */
export function fitsGrantScope(role: GrantableAdminRole, scopeOrgId: string | null): boolean {
  return isPlatformGrantRole(role) === (scopeOrgId === null);
}
