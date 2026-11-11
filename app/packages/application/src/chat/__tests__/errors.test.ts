import { describe, it, expect } from 'vitest';
import { ChatError } from '../errors';

describe('ChatError', () => {
  it('is an Error subclass with name="ChatError", carries code/message/cause', () => {
    const cause = new Error('inner');
    const err = new ChatError('message_too_long', 'Body exceeds 2000 chars', cause);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ChatError);
    expect(err.name).toBe('ChatError');
    expect(err.code).toBe('message_too_long');
    expect(err.message).toBe('Body exceeds 2000 chars');
    expect(err.cause).toBe(cause);
  });

  it('cause defaults to undefined', () => {
    expect(new ChatError('chat_not_found', 'x').cause).toBeUndefined();
  });

  it('preserves the prototype chain via setPrototypeOf (instanceof works across ES5 transpile)', () => {
    // The explicit Object.setPrototypeOf is what makes this true after
    // class-to-function downleveling — without it, ChatError instances
    // would still pass `instanceof Error` but fail `instanceof ChatError`.
    const err = new ChatError('chat_forbidden', 'x');
    expect(err instanceof ChatError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });

  it('preserves every code in the ChatErrorCode union (exhaustive)', () => {
    for (const code of [
      'message_body_required', 'message_too_long', 'chat_not_found', 'chat_forbidden',
      'send_to_deleted_user', 'super_admin_not_found', 'support_thread_not_hideable',
      'description_too_short', 'cannot_chat_self', 'blocked_relationship',
      'account_not_active', 'post_unavailable', 'rate_limited', 'invalid_media_payload',
      'message_not_found', 'description_too_long', 'invalid_reaction_type', 'unknown',
    ] as const) {
      expect(new ChatError(code, code).code).toBe(code);
    }
  });
});
