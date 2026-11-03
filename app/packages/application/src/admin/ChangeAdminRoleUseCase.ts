import {
  AdminRoleError,
  type GrantableAdminRole,
  hasPermission,
  isGrantableAdminRole,
} from '@kc/domain';
import type { IAdminRoleRepository } from './IAdminRoleRepository';

export interface ChangeAdminRoleInput {
  readonly grantId: string;
  readonly newRole: GrantableAdminRole;
}

/**
 * FR-ADMIN-030 — replaces one grant's role in place. The RPC revokes the old
 * grant and inserts the new one with the same user, scope and manager in one
 * transaction, so the person keeps their place in the reporting chain.
 * Returns the new grant id.
 */
export class ChangeAdminRoleUseCase {
  constructor(private readonly repo: IAdminRoleRepository) {}

  async execute(input: ChangeAdminRoleInput): Promise<string> {
    if (!input.grantId) {
      throw new AdminRoleError('invalid_input', 'grant_id required');
    }
    if (!isGrantableAdminRole(input.newRole)) {
      throw new AdminRoleError('invalid_role', 'super_admin is not grantable');
    }
    // A change is a revoke plus a grant, so the caller needs both gates; the
    // RPC re-checks scoped authority over the old and the new role.
    const roles = await this.repo.getMyRoles();
    if (!hasPermission(roles, 'admins.grant_role') || !hasPermission(roles, 'admins.revoke_role')) {
      throw new AdminRoleError('forbidden', 'caller lacks admins.grant_role / admins.revoke_role');
    }
    return this.repo.changeRole(input.grantId, input.newRole);
  }
}
