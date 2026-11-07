/** FR-MOD-007 + FR-MOD-010 + FR-ADMIN-002..007 — moderation domain errors. */

export type ModerationErrorCode =
  | 'forbidden'
  | 'invalid_target_type'
  | 'invalid_restore_state'
  | 'report_not_open'
  | 'invalid_ban_reason'
  | 'cannot_ban_self'
  | 'cannot_ban_admin'
  | 'cannot_delete_system_message'
  | 'target_not_found'
  | 'cannot_report_self'
  | 'unknown';

export class ModerationError extends Error {
  constructor(
    public readonly code: ModerationErrorCode,
    message?: string,
    public readonly cause?: unknown,
  ) {
    super(message ?? code);
    this.name = 'ModerationError';
  }
}

export class ModerationForbiddenError extends ModerationError {
  constructor(cause?: unknown) {
    super('forbidden', 'admin permission required', cause);
    this.name = 'ModerationForbiddenError';
  }
}

export class InvalidRestoreStateError extends ModerationError {
  constructor(cause?: unknown) {
    super('invalid_restore_state', 'target is not in a restorable state', cause);
    this.name = 'InvalidRestoreStateError';
  }
}

export type AccountGateRejectionReason =
  | 'banned'
  | 'suspended_admin'
  | 'suspended_for_false_reports';

export class AccountGateError extends Error {
  constructor(
    public readonly reason: AccountGateRejectionReason,
    public readonly until: Date | null,
  ) {
    super(`account_gate:${reason}`);
    this.name = 'AccountGateError';
  }
}

export type RestoreAccountErrorCode =
  | 'not_pending_deletion'
  | 'grace_expired'
  | 'unauthenticated'
  | 'network';

/** FR-AUTH-016 — why a restore did not go through; the UI maps the code to a message. */
export class RestoreAccountError extends Error {
  constructor(public readonly code: RestoreAccountErrorCode, public readonly cause?: unknown) {
    super(`restore_account:${code}`);
    this.name = 'RestoreAccountError';
  }
}

/** Wraps unexpected infrastructure-layer failures so the UI can react with a
 *  generic "network error" message and the use case still sees a typed error. */
export class InfrastructureError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'InfrastructureError';
  }
}
