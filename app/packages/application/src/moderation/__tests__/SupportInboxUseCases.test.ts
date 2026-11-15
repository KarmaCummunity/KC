import { describe, expect, it, vi } from 'vitest';
import type { ISupportInboxRepository, SupportThreadPage } from '../ISupportInboxRepository';
import {
  JoinSupportThreadUseCase, ListSupportThreadsUseCase, OpenMemberSupportThreadUseCase, SUPPORT_INBOX_PAGE_SIZE,
} from '../SupportInboxUseCases';

const PAGE: SupportThreadPage = {
  threads: [{
    chatId: 'c1', memberId: 'u1', memberDisplayName: 'Dana', memberAvatarUrl: null,
    lastMessageAt: '2026-11-11T10:00:00Z', joined: false,
  }],
  nextCursor: null,
};

function fakeRepo(): ISupportInboxRepository & { [K in keyof ISupportInboxRepository]: ReturnType<typeof vi.fn> } {
  return {
    listThreads: vi.fn(async () => PAGE),
    joinThread: vi.fn(async (chatId: string) => chatId),
    openMemberThread: vi.fn(async () => 'c_member'),
  };
}

describe('support inbox use cases', () => {
  it('lists a page with the default size, newest first as the server returns it', async () => {
    const repo = fakeRepo();
    await expect(new ListSupportThreadsUseCase(repo).execute()).resolves.toEqual(PAGE);
    expect(repo.listThreads).toHaveBeenCalledWith(null, SUPPORT_INBOX_PAGE_SIZE);
  });

  it('clamps the page size to 1..100 and passes the cursor on', async () => {
    const repo = fakeRepo();
    const cursor = { lastMessageAt: '2026-11-11T10:00:00Z', chatId: 'c1' };
    await new ListSupportThreadsUseCase(repo).execute(cursor, 500);
    await new ListSupportThreadsUseCase(repo).execute(cursor, 0);
    expect(repo.listThreads.mock.calls).toEqual([[cursor, 100], [cursor, 1]]);
  });

  it('joins a thread and opens a member thread through the repository', async () => {
    const repo = fakeRepo();
    await expect(new JoinSupportThreadUseCase(repo).execute('c1')).resolves.toBe('c1');
    await expect(new OpenMemberSupportThreadUseCase(repo).execute('u9')).resolves.toBe('c_member');
    expect(repo.openMemberThread).toHaveBeenCalledWith('u9');
  });

  it('propagates a refusal', async () => {
    const repo = fakeRepo();
    repo.joinThread.mockRejectedValueOnce(new Error('forbidden'));
    await expect(new JoinSupportThreadUseCase(repo).execute('c1')).rejects.toThrow('forbidden');
  });
});
