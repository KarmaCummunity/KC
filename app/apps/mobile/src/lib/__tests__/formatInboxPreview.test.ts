import { describe, expect, it } from 'vitest';
import type { Message } from '@kc/domain';
import { formatInboxPreview } from '../formatInboxPreview';

// Stub TFunction: returns the i18n key verbatim so we can assert prefixes
// without bringing the full i18next runtime into the test bundle.
const t = ((key: string) => key) as unknown as Parameters<typeof formatInboxPreview>[1];

const msg = (over: Partial<Message> = {}): Message => ({
  messageId: 'm1',
  chatId: 'c1',
  senderId: 'u2',
  kind: 'user',
  body: 'hello there',
  systemPayload: null,
  mediaPayload: null,
  status: 'delivered',
  createdAt: '2026-01-01T00:00:00.000Z',
  deliveredAt: null,
  readAt: null,
  ...over,
});

describe('formatInboxPreview', () => {
  it('returns the new-conversation placeholder when no last message', () => {
    expect(formatInboxPreview(null, t)).toBe('chat.inboxNewConversation');
    expect(formatInboxPreview(undefined, t)).toBe('chat.inboxNewConversation');
  });

  it('returns the user body for user messages', () => {
    expect(formatInboxPreview(msg(), t)).toBe('hello there');
  });

  it('returns the new-conversation placeholder when user body is empty', () => {
    expect(formatInboxPreview(msg({ body: '' }), t)).toBe('chat.inboxNewConversation');
    expect(formatInboxPreview(msg({ body: '   ' }), t)).toBe('chat.inboxNewConversation');
  });

  it('prefixes system messages with (system message)', () => {
    expect(formatInboxPreview(msg({ kind: 'system', body: 'post closed' }), t))
      .toBe('chat.inboxSystemPrefix post closed');
  });

  it('returns only the system prefix when the system body is empty', () => {
    expect(formatInboxPreview(msg({ kind: 'system', body: '' }), t))
      .toBe('chat.inboxSystemPrefix');
    expect(formatInboxPreview(msg({ kind: 'system', body: null as unknown as string }), t))
      .toBe('chat.inboxSystemPrefix');
  });
});

describe('formatInboxPreview — closure system messages (TD-148)', () => {
  it('previews a post_closed message in the UI language, not the stored Hebrew body', () => {
    const closed = msg({
      kind: 'system',
      senderId: null,
      body: 'הפוסט נמסר למשתמש אחר',
      systemPayload: { kind: 'post_closed', status: 'closed_delivered', recipient_user_id: null },
    });
    expect(formatInboxPreview(closed, t)).toBe('chat.inboxSystemPrefix chat.systemPostClosed.deliveredToOther');
  });
});
