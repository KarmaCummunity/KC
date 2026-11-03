export type AdminRoleErrorCode =
  | 'forbidden'
  | 'forbidden_grant'
  | 'forbidden_revoke'
  | 'invalid_input'
  | 'invalid_role'
  | 'invalid_scope'
  | 'target_not_found'
  | 'target_not_active'
  | 'role_already_active'
  | 'grant_not_found'
  | 'grant_already_revoked'
  | 'cannot_revoke_last_super_admin'
  | 'unknown';

export class AdminRoleError extends Error {
  readonly code: AdminRoleErrorCode;

  constructor(code: AdminRoleErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = 'AdminRoleError';
  }
}

export function isAdminRoleError(err: unknown): err is AdminRoleError {
  return err instanceof AdminRoleError;
}
