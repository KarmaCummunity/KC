// #2566 — the conversation screen's first frame comes from the cached inbox row.
import { describe, expect, it } from 'vitest';
import type { ChatWithPreview } from '@kc/application';
import { chatOpenSeedFromInbox } from '../chatOpenSeed';
import type { ChatInboxSnapshot } from '../chatInboxQuery';

const directRow: ChatWithPreview = {
  chatId: 'c1',
  participantIds: ['me', 'peer'],
  anchorPostId: 'p1',
  isSupportThread: false,
  lastMessageAt: '2026-11-20T10:00:00.000Z',
  createdAt: '2026-11-20T10:00:00.000Z',
  otherParticipant: {
    userId: 'peer',
    displayName: 'Dana',
    avatarUrl: 'https://example.invalid/a.png',
    shareHandle: 'dana',
    isDeleted: false,
    verificationLevel: 1,
  },
  lastMessage: null,
  unreadCount: 2,
};

const snapshotOf = (...chats: ChatWithPreview[]): ChatInboxSnapshot => ({ chats, unreadTotal: 0 });

describe('chatOpenSeedFromInbox', () => {
  it('returns null without a cached inbox or when the chat is not in it', () => {
    expect(chatOpenSeedFromInbox(undefined, 'c1')).toBeNull();
    expect(chatOpenSeedFromInbox(snapshotOf(directRow), 'other')).toBeNull();
  });

  it('seeds the chat row, the counterpart and the unread count of a direct chat', () => {
    const seed = chatOpenSeedFromInbox(snapshotOf(directRow), 'c1');
    expect(seed).toEqual({
      chat: {
        chatId: 'c1',
        participantIds: ['me', 'peer'],
        anchorPostId: 'p1',
        isSupportThread: false,
        lastMessageAt: '2026-11-20T10:00:00.000Z',
        createdAt: '2026-11-20T10:00:00.000Z',
      },
      counterpart: { userId: 'peer', displayName: 'Dana', shareHandle: 'dana', isDeleted: false, verificationLevel: 1 },
      unreadCount: 2,
    });
    // The preview's own fields never leak into the chat row.
    expect(seed?.chat).not.toHaveProperty('otherParticipant');
    expect(seed?.chat).not.toHaveProperty('unreadCount');
  });

  it('keeps a gone counterpart as the deleted-user placeholder', () => {
    const gone: ChatWithPreview = {
      ...directRow,
      participantIds: ['me', null],
      otherParticipant: { userId: null, displayName: null, avatarUrl: null, shareHandle: null, isDeleted: true },
    };
    expect(chatOpenSeedFromInbox(snapshotOf(gone), 'c1')?.counterpart).toEqual({
      userId: null,
      displayName: null,
      shareHandle: null,
      isDeleted: true,
      verificationLevel: undefined,
    });
  });

  it('shows no counterpart for a support thread, even when the inbox names its member', () => {
    const support: ChatWithPreview = { ...directRow, isSupportThread: true, unreadCount: 0 };
    const seed = chatOpenSeedFromInbox(snapshotOf(support), 'c1');
    expect(seed?.counterpart).toEqual({ userId: null, displayName: null, shareHandle: null, isDeleted: false });
    expect(seed?.unreadCount).toBe(0);
  });
});
