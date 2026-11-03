import type { AdminGrant, AdminRole, GrantableAdminRole } from '@kc/domain';

export interface IAdminRoleRepository {
  getMyRoles(): Promise<readonly AdminRole[]>;
  listAdmins(includeRevoked: boolean): Promise<readonly AdminGrant[]>;
  /** Grants `role` in `scopeOrgId` (null = platform); returns the new grant id. */
  grantRole(targetUserId: string, role: GrantableAdminRole, scopeOrgId: string | null): Promise<string>;
  revokeRole(grantId: string): Promise<void>;
  /** Replaces a grant's role atomically (FR-ADMIN-030); returns the new grant id. */
  changeRole(grantId: string, newRole: GrantableAdminRole): Promise<string>;
}
