import { describe, expect, it, vi } from 'vitest';
import type { IModerationQueueRepository, ModerationQueuePage } from '../IModerationQueueRepository';
import {
  AssignQueueEntryUseCase, ListModerationQueueUseCase, MODERATION_QUEUE_PAGE_SIZE, ResolveQueueEntryUseCase,
} from '../ModerationQueueUseCases';

const PAGE: ModerationQueuePage = {
  entries: [{
    entryId: 'q1', targetType: 'post', targetId: 'p1', reason: 'excessive_reopens', assigneeId: null,
    metadata: { reopen_count: 5 }, createdAt: '2026-11-11T10:00:00Z',
  }],
  nextCursor: null,
};

function fakeRepo() {
  return {
    listOpen: vi.fn(async () => PAGE),
    assign: vi.fn(async () => undefined),
    resolve: vi.fn(async () => undefined),
  } satisfies IModerationQueueRepository;
}

describe('moderation queue use cases (FR-MOD-008)', () => {
  it('lists the open entries with the default page size', async () => {
    const repo = fakeRepo();
    await expect(new ListModerationQueueUseCase(repo).execute()).resolves.toEqual(PAGE);
    expect(repo.listOpen).toHaveBeenCalledWith(null, MODERATION_QUEUE_PAGE_SIZE);
  });

  it('clamps the page size to 1..100', async () => {
    const repo = fakeRepo();
    await new ListModerationQueueUseCase(repo).execute(null, 1000);
    expect(repo.listOpen).toHaveBeenCalledWith(null, 100);
  });

  it('takes an entry for the caller, or hands it to someone, and resolves it', async () => {
    const repo = fakeRepo();
    await new AssignQueueEntryUseCase(repo).execute({ entryId: 'q1' });
    await new AssignQueueEntryUseCase(repo).execute({ entryId: 'q1', assigneeId: 'u2' });
    await new ResolveQueueEntryUseCase(repo).execute({ entryId: 'q1' });
    expect(repo.assign.mock.calls).toEqual([['q1', undefined], ['q1', 'u2']]);
    expect(repo.resolve).toHaveBeenCalledWith('q1');
  });

  it('propagates a refusal', async () => {
    const repo = fakeRepo();
    repo.resolve.mockRejectedValueOnce(new Error('queue_entry_not_open'));
    await expect(new ResolveQueueEntryUseCase(repo).execute({ entryId: 'q1' })).rejects.toThrow('queue_entry_not_open');
  });
});
