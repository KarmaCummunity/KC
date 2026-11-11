import { describe, it, expect } from 'vitest';
import { ChatError } from '@kc/application';
import { mapChatError } from '../mapChatError';

describe('mapChatError', () => {
  // ── SQLSTATE-based branches ────────────────────────────────────────────
  it('maps 23503 (FK violation) → send_to_deleted_user', () => {
    const out = mapChatError({ code: '23503', message: 'violates messages_sender_fkey' });
    expect(out).toBeInstanceOf(ChatError);
    expect((out as ChatError).code).toBe('send_to_deleted_user');
  });

  it('maps 42501 (RLS deny) → chat_forbidden', () => {
    const out = mapChatError({ code: '42501', message: 'permission denied for table messages' });
    expect((out as ChatError).code).toBe('chat_forbidden');
  });

  it('maps 23514 (CHECK violation) → message_too_long', () => {
    const out = mapChatError({ code: '23514', message: 'messages_body_chk' });
    expect((out as ChatError).code).toBe('message_too_long');
  });

  // #2096: the support-issue RPC raises its length errors as 23514 too; the named code wins.
  it('maps a 23514 "description_too_short" to description_too_short, not message_too_long', () => {
    const out = mapChatError({ code: '23514', message: 'description_too_short' });
    expect((out as ChatError).code).toBe('description_too_short');
  });

  it('maps a 23514 "description_too_long" to description_too_long, not message_too_long', () => {
    const out = mapChatError({ code: '23514', message: 'description_too_long' });
    expect((out as ChatError).code).toBe('description_too_long');
  });

  // ── Message-substring branches ──────────────────────────────────────────
  it('matches "super_admin_not_found" in the message', () => {
    const out = mapChatError({ message: 'super_admin_not_found' });
    expect((out as ChatError).code).toBe('super_admin_not_found');
  });

  it('matches "support_thread_not_hideable" in the message', () => {
    const out = mapChatError({ message: 'support_thread_not_hideable' });
    expect((out as ChatError).code).toBe('support_thread_not_hideable');
  });

  it('matches "chat_not_found" in the message', () => {
    const out = mapChatError({ message: 'chat_not_found' });
    expect((out as ChatError).code).toBe('chat_not_found');
  });

  // ── Fallthrough ─────────────────────────────────────────────────────────
  it('returns ChatError with code=unknown for an empty input', () => {
    const out = mapChatError({});
    expect(out).toBeInstanceOf(ChatError);
    expect((out as ChatError).code).toBe('unknown');
  });

  it('returns ChatError with code=unknown for an unrecognized message', () => {
    const out = mapChatError({ message: 'mysterious failure' });
    expect((out as ChatError).code).toBe('unknown');
  });

  // ── Precedence: SQLSTATE wins over the message-substring branches ───────
  it('prefers the SQLSTATE branch over a message substring when both match', () => {
    const out = mapChatError({ code: '42501', message: 'chat_not_found' });
    expect((out as ChatError).code).toBe('chat_forbidden');
  });

  // ── Message + cause preservation ────────────────────────────────────────
  it('preserves the original message in the wrapped ChatError', () => {
    const out = mapChatError({ code: '23514', message: 'check failed: posts_body_chk' });
    expect(out.message).toBe('check failed: posts_body_chk');
  });

  it('falls back to the symbolic code when message is absent', () => {
    const out = mapChatError({ code: '23514' });
    expect(out.message).toBe('message_too_long');
  });

  it('preserves the original throwable as cause', () => {
    const src = { code: '23503', message: 'fk' };
    const out = mapChatError(src);
    expect((out as ChatError).cause).toBe(src);
  });
});
