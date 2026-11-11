export type ReportErrorCode =
  | 'invalid_target'
  | 'duplicate_within_24h'
  | 'target_already_moderated'
  /** The reporter owns the target (server guard `cannot_report_self`). */
  | 'cannot_report_self'
  /** The reporter hit the hourly report cap (server guard `rate_limit_exceeded`). */
  | 'rate_limited'
  | 'unknown';

export class ReportError extends Error {
  readonly code: ReportErrorCode;
  readonly cause?: unknown;
  constructor(code: ReportErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'ReportError';
    this.code = code;
    this.cause = cause;
    Object.setPrototypeOf(this, ReportError.prototype);
  }
}
