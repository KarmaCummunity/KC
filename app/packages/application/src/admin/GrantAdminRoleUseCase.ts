import {
  AdminRoleError,
  fitsGrantScope,
  type GrantableAdminRole,
  hasPermission,
  isGrantableAdminRole,
} from '@kc/domain';
import type { IAdminRoleRepository } from './IAdminRoleRepository';

export interface GrantAdminRoleInput {
  readonly targetUserId: string;
  readonly role: GrantableAdminRole;
  /** Org the role applies to; null for platform roles (FR-ADMIN-016). */
  readonly scopeOrgId: string | null;
}

export class GrantAdminRoleUseCase {
  constructor(private readonly repo: IAdminRoleRepository) {}

  async execute(input: GrantAdminRoleInput): Promise<string> {
    if (!input.targetUserId) {
      throw new AdminRoleError('invalid_input', 'target_user_id required');
    }
    if (!isGrantableAdminRole(input.role)) {
      throw new AdminRoleError('invalid_role', 'super_admin is not grantable');
    }
    if (!fitsGrantScope(input.role, input.scopeOrgId)) {
      throw new AdminRoleError('invalid_scope', 'platform roles take no org; org roles need one');
    }
    // Defence-in-depth (FR-ADMIN-006): only team managers reach the grant
    // flow (`admins.grant_role`); which role in which org is re-checked by the
    // RPC's `can_grant_role`, so an unauthorized caller fails fast here.
    const roles = await this.repo.getMyRoles();
    if (!hasPermission(roles, 'admins.grant_role')) {
      throw new AdminRoleError('forbidden', 'caller lacks admins.grant_role');
    }
    return this.repo.grantRole(input.targetUserId, input.role, input.scopeOrgId);
  }
}
