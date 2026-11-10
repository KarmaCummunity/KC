// Errors a knowledge booking use case raises before reaching the server (#2034). The message is
// the server's own error code, so the app's server-error mapper gives both the same copy.
export type KnowledgeBookingErrorCode =
  | 'slot_not_found'
  | 'slot_started'
  | 'slots_exhausted'
  | 'already_booked'
  | 'session_not_started'
  | 'handoff_not_found';

export class KnowledgeBookingError extends Error {
  readonly code: KnowledgeBookingErrorCode;
  constructor(code: KnowledgeBookingErrorCode) {
    super(code);
    this.name = 'KnowledgeBookingError';
    this.code = code;
    Object.setPrototypeOf(this, KnowledgeBookingError.prototype);
  }
}
