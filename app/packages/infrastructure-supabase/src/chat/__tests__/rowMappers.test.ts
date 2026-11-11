import { describe, it, expect } from 'vitest';
import { readAtFor, rowToChat, rowToMessage, type ChatRowSlice, type MessageRowSlice } from '../rowMappers';

const CHAT: ChatRowSlice = {
  id: 'c_1',
  kind: 'direct',
  direct_user_a: 'u_a',
  direct_user_b: 'u_b',
  support_user_id: null,
  anchor_post_id: 'p_1',
  last_message_at: '2026-05-16T12:00:00.000Z',
  created_at: '2026-05-16T11:00:00.000Z',
};

const MESSAGE: MessageRowSlice = {
  id: 'm_1',
  chat_id: 'c_1',
  sender_id: 'u_a',
  kind: 'user',
  body: 'hello',
  system_payload: null,
  media_payload: null,
  created_at: '2026-05-16T12:00:00.000Z',
};

describe('rowToChat', () => {
  it('maps a direct chat: the pair, the pinned post, no ride or listing anchor', () => {
    expect(rowToChat(CHAT)).toEqual({
      chatId: 'c_1',
      participantIds: ['u_a', 'u_b'],
      anchorPostId: 'p_1',
      anchorRideId: null,
      anchorListingId: null,
      isSupportThread: false,
      lastMessageAt: '2026-05-16T12:00:00.000Z',
      createdAt: '2026-05-16T11:00:00.000Z',
    });
  });

  it('maps a support thread to the member it belongs to and flags it', () => {
    const chat = rowToChat({ ...CHAT, kind: 'support', direct_user_a: null, direct_user_b: null, support_user_id: 'u_s', anchor_post_id: null });
    expect(chat.participantIds).toEqual(['u_s', null]);
    expect(chat.isSupportThread).toBe(true);
  });

  it('keeps a chat without messages as lastMessageAt null', () => {
    expect(rowToChat({ ...CHAT, last_message_at: null }).lastMessageAt).toBeNull();
  });

  it('keeps a member that left as a null participant (deleted counterpart)', () => {
    expect(rowToChat({ ...CHAT, direct_user_b: null }).participantIds).toEqual(['u_a', null]);
  });
});

describe('readAtFor', () => {
  const markers = [
    { userId: 'u_a', lastReadAt: '2026-05-16T12:10:00.000Z' },
    { userId: 'u_b', lastReadAt: '2026-05-16T12:05:00.000Z' },
  ];

  it("is the other member's marker once it reached the message", () => {
    expect(readAtFor(MESSAGE, markers)).toBe('2026-05-16T12:05:00.000Z');
  });

  it("never counts the sender's own marker", () => {
    expect(readAtFor(MESSAGE, [{ userId: 'u_a', lastReadAt: '2026-05-16T13:00:00.000Z' }])).toBeNull();
  });

  it('is null while the other marker is still before the message', () => {
    expect(readAtFor(MESSAGE, [{ userId: 'u_b', lastReadAt: '2026-05-16T11:59:59.999Z' }])).toBeNull();
  });

  it('counts a marker exactly at the message time (mark_chat_read stores the newest created_at)', () => {
    expect(readAtFor(MESSAGE, [{ userId: 'u_b', lastReadAt: '2026-05-16T12:00:00.000Z' }])).toBe('2026-05-16T12:00:00.000Z');
  });

  it('lets any member read a system message (no sender)', () => {
    const system = { sender_id: null, created_at: MESSAGE.created_at };
    expect(readAtFor(system, [{ userId: 'u_b', lastReadAt: '2026-05-16T12:05:00.000Z' }])).toBe('2026-05-16T12:05:00.000Z');
  });

  it('is null without markers', () => {
    expect(readAtFor(MESSAGE, [])).toBeNull();
  });
});

describe('rowToMessage', () => {
  it('maps a user message as delivered when nobody has read it', () => {
    expect(rowToMessage(MESSAGE)).toEqual({
      messageId: 'm_1',
      chatId: 'c_1',
      senderId: 'u_a',
      kind: 'user',
      body: 'hello',
      systemPayload: null,
      mediaPayload: null,
      status: 'delivered',
      createdAt: '2026-05-16T12:00:00.000Z',
      deliveredAt: '2026-05-16T12:00:00.000Z',
      readAt: null,
    });
  });

  it('maps a read message with the time it was read', () => {
    const message = rowToMessage(MESSAGE, '2026-05-16T12:05:00.000Z');
    expect(message.status).toBe('read');
    expect(message.readAt).toBe('2026-05-16T12:05:00.000Z');
  });

  it('maps a system message: null sender, payload kept, empty body', () => {
    const message = rowToMessage({ ...MESSAGE, sender_id: null, kind: 'system', body: null, system_payload: { kind: 'post_closed' } });
    expect(message).toMatchObject({ senderId: null, kind: 'system', body: '', systemPayload: { kind: 'post_closed' } });
  });

  it('maps a media message with its payload', () => {
    const message = rowToMessage({ ...MESSAGE, kind: 'media', body: null, media_payload: { type: 'image', url: 'x' } });
    expect(message).toMatchObject({ kind: 'media', body: '', mediaPayload: { type: 'image', url: 'x' } });
  });
});
