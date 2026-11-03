// TD-148 / FR-CHAT-015 AC4-AC6 — the post-closure system messages are written
// by a DB trigger with a Hebrew body. The client renders them from the
// structured payload so an English UI shows English; unknown kinds keep the body.
import { describe, expect, it } from 'vitest';
import type { Message } from '@kc/domain';
import { systemMessageText } from '../systemMessageText';
// eslint-disable-next-line no-restricted-imports -- test pins the Hebrew copy to the strings the DB trigger stores
import { chatHe } from '../../../i18n/locales/he/modules/chat';

const t = ((key: string) => key) as unknown as Parameters<typeof systemMessageText>[1];

const system = (payload: Record<string, unknown> | null, body = 'גוף מהשרת'): Message => ({
  messageId: 'm1',
  chatId: 'c1',
  senderId: null,
  kind: 'system',
  body,
  systemPayload: payload,
  mediaPayload: null,
  status: 'delivered',
  createdAt: '2026-01-01T00:00:00.000Z',
  deliveredAt: null,
  readAt: null,
});

describe('systemMessageText', () => {
  it('localizes every post_closed variant from the payload', () => {
    const base = { kind: 'post_closed', post_id: 'p1' };
    expect(systemMessageText(system({ ...base, status: 'closed_delivered', recipient_user_id: 'u1' }), t)).toBe(
      'chat.systemPostClosed.deliveredToYou',
    );
    expect(systemMessageText(system({ ...base, status: 'closed_delivered', recipient_user_id: null }), t)).toBe(
      'chat.systemPostClosed.deliveredToOther',
    );
    expect(systemMessageText(system({ ...base, status: 'deleted_no_recipient', recipient_user_id: null }), t)).toBe(
      'chat.systemPostClosed.closedNotDelivered',
    );
  });

  it('keeps the server body for other system kinds, missing payloads and user messages', () => {
    expect(systemMessageText(system({ kind: 'something_else' }), t)).toBe('גוף מהשרת');
    expect(systemMessageText(system(null), t)).toBe('גוף מהשרת');
    expect(systemMessageText({ ...system(null, 'hi'), kind: 'user', senderId: 'u2' }, t)).toBe('hi');
  });

  it('keeps the Hebrew copy identical to the strings the DB trigger writes (0031)', () => {
    expect(chatHe.systemPostClosed).toEqual({
      deliveredToYou: 'הפוסט סומן כנמסר ✓ · תודה!',
      deliveredToOther: 'הפוסט נמסר למשתמש אחר',
      closedNotDelivered: 'המפרסם סגר את הפוסט — הפריט לא נמסר',
    });
  });
});
