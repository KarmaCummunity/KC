import { describe, it, expect } from 'vitest';
import { ListChatsUseCase } from '../ListChatsUseCase';
import type { ChatWithPreview, IChatRepository } from '../../ports/IChatRepository';

// Minimal stub that returns whatever the test sets, so we can verify the
// use case's defensive `lastMessageAt desc` sort even if a future repo
// happens to return rows out of order.
class StubChatRepo implements Partial<IChatRepository> {
  toReturn: ChatWithPreview[] = [];
  lastUserId: string | null = null;

  getMyChats = async (userId: string): Promise<ChatWithPreview[]> => {
    this.lastUserId = userId;
    return this.toReturn;
  };
}

function makeChat(id: string, lastMessageAt: string | null): ChatWithPreview {
  return {
    chatId: id,
    participantIds: ['u_me', 'u_other'],
    anchorPostId: null,
    isSupportThread: false,
    lastMessageAt,
    createdAt: '2026-05-01T00:00:00.000Z',
    otherParticipant: {
      userId: 'u_other',
      displayName: 'other',
      avatarUrl: null,
      shareHandle: 'other',
      isDeleted: false,
    },
    lastMessage: null,
    unreadCount: 0,
  };
}

describe('ListChatsUseCase', () => {
  it('forwards userId to the repository', async () => {
    const repo = new StubChatRepo();
    const uc = new ListChatsUseCase(repo as unknown as IChatRepository);

    await uc.execute({ userId: 'u_me' });

    expect(repo.lastUserId).toBe('u_me');
  });

  it('returns chats sorted by lastMessageAt desc (newest first)', async () => {
    const repo = new StubChatRepo();
    repo.toReturn = [
      makeChat('c_oldest', '2026-05-01T10:00:00.000Z'),
      makeChat('c_newest', '2026-05-10T10:00:00.000Z'),
      makeChat('c_middle', '2026-05-05T10:00:00.000Z'),
    ];
    const uc = new ListChatsUseCase(repo as unknown as IChatRepository);

    const out = await uc.execute({ userId: 'u_me' });

    expect(out.map((c) => c.chatId)).toEqual(['c_newest', 'c_middle', 'c_oldest']);
  });

  it('places chats with null lastMessageAt at the end', async () => {
    const repo = new StubChatRepo();
    repo.toReturn = [
      makeChat('c_empty', null),
      makeChat('c_recent', '2026-05-10T10:00:00.000Z'),
    ];
    const uc = new ListChatsUseCase(repo as unknown as IChatRepository);

    const out = await uc.execute({ userId: 'u_me' });

    expect(out.map((c) => c.chatId)).toEqual(['c_recent', 'c_empty']);
  });

  it('orders chats correctly when one has a date and the other has null, or both null', async () => {
    const repo = new StubChatRepo();
    repo.toReturn = [
      makeChat('c_recent', '2026-05-10T10:00:00.000Z'),
      makeChat('c_null_1', null),
      makeChat('c_null_2', null),
    ];
    const uc = new ListChatsUseCase(repo as unknown as IChatRepository);

    const out = await uc.execute({ userId: 'u_me' });
    expect(out[0]?.chatId).toBe('c_recent');
    expect(out.map((c) => c.chatId)).toContain('c_null_1');
    expect(out.map((c) => c.chatId)).toContain('c_null_2');
  });

  it('returns an empty list when the repo returns nothing', async () => {
    const repo = new StubChatRepo();
    repo.toReturn = [];
    const uc = new ListChatsUseCase(repo as unknown as IChatRepository);

    const out = await uc.execute({ userId: 'u_me' });

    expect(out).toEqual([]);
  });

  it('does not mutate the array returned by the repo (defensive copy)', async () => {
    const repo = new StubChatRepo();
    const original = [
      makeChat('c_oldest', '2026-05-01T10:00:00.000Z'),
      makeChat('c_newest', '2026-05-10T10:00:00.000Z'),
    ];
    repo.toReturn = original;
    const uc = new ListChatsUseCase(repo as unknown as IChatRepository);

    await uc.execute({ userId: 'u_me' });

    // The use case sorts a spread copy — the repo's original order must be intact.
    expect(original.map((c) => c.chatId)).toEqual(['c_oldest', 'c_newest']);
  });
});
