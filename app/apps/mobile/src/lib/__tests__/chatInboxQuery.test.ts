import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { ChatWithPreview } from '@kc/application';
import {
  chatInboxQueryKey,
  markChatReadInSnapshot,
  readChatInboxSnapshot,
  upsertChatPreviewInSnapshot,
  writeChatInboxSnapshot,
} from '../chatInboxQuery';

const CHAT = {
  chatId: 'c1',
  lastMessageAt: '2026-05-16T12:00:00.000Z',
  unreadCount: 2,
} as ChatWithPreview;

describe('chatInboxQuery', () => {
  it('upsert sorts by lastMessageAt desc', () => {
    const snap = {
      chats: [{ ...CHAT, chatId: 'c_old', lastMessageAt: '2026-05-15T12:00:00.000Z', unreadCount: 0 }],
      unreadTotal: 0,
    };
    const next = upsertChatPreviewInSnapshot(snap, {
      chatId: 'c_new',
      lastMessageAt: '2026-05-17T12:00:00.000Z',
    } as never);
    expect(next.chats[0]?.chatId).toBe('c_new');
  });

  it('markChatReadInSnapshot decrements unreadTotal', () => {
    const snap = { chats: [CHAT], unreadTotal: 2 };
    const patched = markChatReadInSnapshot(snap, 'c1');
    expect(patched?.snapshot.unreadTotal).toBe(0);
    expect(patched?.snapshot.chats[0]?.unreadCount).toBe(0);
  });

  it('read/write snapshot on QueryClient', () => {
    const qc = new QueryClient();
    writeChatInboxSnapshot(qc, 'u1', { chats: [CHAT], unreadTotal: 2 });
    expect(readChatInboxSnapshot(qc, 'u1')?.unreadTotal).toBe(2);
    expect(chatInboxQueryKey('u1')).toEqual(['chat-inbox', 'u1']);
  });
});

describe('chatInboxQuery new chat', () => {
  it('inserts a new bare chat with a safe participant placeholder', () => {
    const next = upsertChatPreviewInSnapshot({ chats: [], unreadTotal: 0 }, {
      chatId: 'c_new',
      lastMessageAt: '2026-05-17T12:00:00.000Z',
    } as never);
    expect(next.chats[0]?.otherParticipant).toBeDefined();
    expect(next.chats[0]?.unreadCount).toBe(0);
  });
});
