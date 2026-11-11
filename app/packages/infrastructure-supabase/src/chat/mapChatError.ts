// Postgres error → typed ChatError mapping.
// Mapped to SRS: FR-CHAT-002 (send failures), FR-CHAT-003 (RLS), FR-CHAT-007 (support thread).

import { ChatError } from '@kc/application';

export function mapChatError(err: { code?: string; message?: string }): Error {
  const code = err.code ?? '';
  if (code === '23503') {
    return new ChatError('send_to_deleted_user', err.message ?? 'send_to_deleted_user', err);
  }
  if (code === '42501') {
    return new ChatError('chat_forbidden', err.message ?? 'chat_forbidden', err);
  }
  // Named support-issue length errors are raised as 23514 too (`description_too_short` today,
  // `description_too_long` once #2138 lands), so they are matched before the generic CHECK branch.
  const supportIssueCode = (['description_too_short', 'description_too_long'] as const).find((c) =>
    err.message?.includes(c),
  );
  if (supportIssueCode) {
    return new ChatError(supportIssueCode, err.message ?? supportIssueCode, err);
  }
  if (code === '23514') {
    return new ChatError('message_too_long', err.message ?? 'message_too_long', err);
  }
  if (err.message?.includes('super_admin_not_found')) {
    return new ChatError('super_admin_not_found', err.message, err);
  }
  if (err.message?.includes('support_thread_not_hideable')) {
    return new ChatError('support_thread_not_hideable', err.message, err);
  }
  if (err.message?.includes('chat_not_found')) {
    return new ChatError('chat_not_found', err.message, err);
  }
  return new ChatError('unknown', err.message ?? 'unknown', err);
}
