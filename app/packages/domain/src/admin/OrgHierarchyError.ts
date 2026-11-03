export type OrgHierarchyErrorCode =
  | 'forbidden'
  | 'forbidden_manage'
  | 'invalid_input'
  | 'invalid_manager'
  | 'grant_not_found'
  | 'grant_already_revoked'
  | 'manager_not_found'
  | 'manager_revoked'
  | 'manager_other_org'
  | 'manager_cycle'
  /** A report must be strictly junior to its new manager (FR-ADMIN-027). */
  | 'manager_rank'
  | 'unknown';

export class OrgHierarchyError extends Error {
  readonly code: OrgHierarchyErrorCode;

  constructor(code: OrgHierarchyErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = 'OrgHierarchyError';
  }
}

export function isOrgHierarchyError(err: unknown): err is OrgHierarchyError {
  return err instanceof OrgHierarchyError;
}
