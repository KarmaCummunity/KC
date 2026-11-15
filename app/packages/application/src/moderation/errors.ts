/** FR-MOD-007 + FR-MOD-010 + FR-ADMIN-002..007 — moderation domain errors. */

/**
 * Why a staff moderation action was refused. Each value except `unknown` is a stable
 * `P0001` message of the baseline moderation RPCs (`supabase/schemas/60_moderation`).
 */
export type ModerationErrorCode =
  | 'forbidden'
  | 'invalid_restore_state'
  | 'invalid_target_state'
  | 'report_not_open'
  | 'invalid_sanction_reason'
  | 'cannot_sanction_self'
  | 'cannot_sanction_admin'
  | 'account_pending_deletion'
  | 'target_not_found'
  | 'message_not_found'
  | 'cannot_report_self'
  | 'queue_entry_not_open'
  | 'assignee_not_staff'
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
