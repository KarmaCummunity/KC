// Chat orchestration errors. Mirrors posts/errors.ts.
// Mapped to SRS: FR-CHAT-002, FR-CHAT-003, FR-CHAT-007.

export type ChatErrorCode =
  | 'message_body_required'
  | 'message_too_long'
  | 'chat_not_found'
  | 'chat_forbidden'
  | 'send_to_deleted_user'
  | 'super_admin_not_found'
  | 'support_thread_not_hideable'
  | 'description_too_short'
  | 'description_too_long'
  | 'both_anchors_forbidden'
  | 'unknown';

export class ChatError extends Error {
  readonly code: ChatErrorCode;
  readonly cause?: unknown;

  constructor(code: ChatErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'ChatError';
    this.code = code;
    this.cause = cause;
    Object.setPrototypeOf(this, ChatError.prototype);
  }
}
