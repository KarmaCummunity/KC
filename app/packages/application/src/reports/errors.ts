/**
 * Why a report was refused. `duplicate_within_24h` keeps its historical name: the baseline
 * allows one open report per reporter and target (FR-MOD-001 AC7), which is what it signals.
 */
export type ReportErrorCode =
  | 'invalid_target'
  | 'duplicate_within_24h'
  | 'target_already_moderated'
  | 'cannot_report_self'
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
