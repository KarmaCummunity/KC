// Baseline call failure → typed ChatError.
// Mapped to spec: FR-CHAT-002 (send failures), FR-CHAT-003 (access), FR-CHAT-007 (support thread).

import { BackendRuleError, BackendUnavailableError } from '@kc/domain';
import { ChatError, type ChatErrorCode } from '@kc/application';
import { unwrapCall, type CallResult } from '../rpc/mapRpcError';

/**
 * The stable reasons a messaging RPC refuses with, and the chat error each one becomes.
 * `user_unavailable` (the other member is inactive or gone) is the old "send to deleted user".
 * `message_body_invalid` is an empty or over-long body; the use case already refuses an empty one,
 * so what reaches the server is the length limit. `invalid_rate_limit_args` is a server-side
 * misconfiguration, not a member's mistake, so it is deliberately not listed and surfaces as
 * `unknown`.
 */
const CODE_BY_REASON: Readonly<Record<string, ChatErrorCode>> = {
  cannot_chat_self: 'cannot_chat_self',
  user_unavailable: 'send_to_deleted_user',
  blocked_relationship: 'blocked_relationship',
  account_not_active: 'account_not_active',
  post_unavailable: 'post_unavailable',
  chat_not_found: 'chat_not_found',
  message_not_found: 'message_not_found',
  support_thread_not_hideable: 'support_thread_not_hideable',
  rate_limited: 'rate_limited',
  message_body_invalid: 'message_too_long',
  invalid_media_payload: 'invalid_media_payload',
  invalid_reaction_type: 'invalid_reaction_type',
  unauthenticated: 'chat_forbidden',
  description_too_short: 'description_too_short',
  description_too_long: 'description_too_long',
};

/**
 * Turns any failure of a messaging call into the error the application sees: a missing backend
 * object stays `BackendUnavailableError` (the degrade rule), a stable rule reason becomes a
 * `ChatError`, anything else a `ChatError('unknown')` that keeps the original as its cause.
 */
export function mapChatError(error: unknown): Error {
  if (error instanceof BackendUnavailableError || error instanceof ChatError) return error;
  if (error instanceof BackendRuleError) {
    const code = CODE_BY_REASON[error.reason];
    if (code) return new ChatError(code, error.reason, error);
  }
  const message = error instanceof Error ? error.message : 'unknown';
  return new ChatError('unknown', message, error);
}

/**
 * Awaits one baseline call on `object` (`rpc:<name>` / `table:<name>`), returns its data and
 * throws `mapChatError(...)` for a failed one.
 */
export async function chatCall<T>(object: string, pending: PromiseLike<CallResult<T>>): Promise<T> {
  try {
    return unwrapCall(object, await pending);
  } catch (error) {
    throw mapChatError(error);
  }
}

/** The row an RPC that must return one answered with; a null answer is an unexpected failure. */
export function requireRow<T>(row: T | null | undefined, rpcName: string): T {
  if (row == null) throw new ChatError('unknown', `${rpcName} returned no row`);
  return row;
}
