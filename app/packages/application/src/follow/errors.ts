// app/packages/application/src/follow/errors.ts
// Follow-domain orchestration errors. Mirrors posts/errors.ts.
// Mapped to SRS: FR-FOLLOW-001..009, 011.

export type FollowErrorCode =
  | 'self_follow'
  | 'blocked_relationship'
  | 'cooldown_active'
  /** A direct follow reached a Private profile: the server filed a request instead (FR-FOLLOW-012 AC2). */
  | 'request_required'
  /** The caller's account is not active (waiting for verification, sanctioned or pending deletion). */
  | 'account_not_active'
  | 'rate_limited'
  | 'user_not_found'
  | 'privacy_mode_no_change'
  | 'unknown';

export class FollowError extends Error {
  readonly code: FollowErrorCode;
  /** ISO-8601 cooldown_until from DB; only present when code === 'cooldown_active'. */
  readonly cooldownUntil?: string;
  readonly cause?: unknown;

  constructor(
    code: FollowErrorCode,
    message: string,
    opts: { cooldownUntil?: string; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'FollowError';
    this.code = code;
    this.cooldownUntil = opts.cooldownUntil;
    this.cause = opts.cause;
    Object.setPrototypeOf(this, FollowError.prototype);
  }
}

export function isFollowError(value: unknown): value is FollowError {
  return value instanceof FollowError;
}
