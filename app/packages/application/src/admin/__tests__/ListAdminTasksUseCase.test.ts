import { describe, expect, it, vi } from 'vitest';
import type { AdminTask } from '@kc/domain';
import { CountOpenAdminTasksUseCase, ListAdminTasksUseCase } from '../ListAdminTasksUseCase';
import { fakeAdminTaskRepo } from './fakeAdminTaskRepo';

function task(overrides: Partial<AdminTask> = {}): AdminTask {
  return {
    taskId: 't1', title: 'x', description: null,
    status: 'open', priority: 'medium', category: 'other',
    assigneeId: null,
    assigneeDisplayName: null, createdBy: 'u1', createdByDisplayName: null,
    dueAt: null, labels: [], createdAt: new Date(), updatedAt: new Date(),
    commentCount: 0, ...overrides,
  };
}

describe('ListAdminTasksUseCase', () => {
  it('passes filters and the cursor straight through to the repo', async () => {
    const repo = fakeAdminTaskRepo({ list: vi.fn(async () => ({ rows: [task()], nextCursor: null })) });
    const uc = new ListAdminTasksUseCase(repo);
    await uc.execute({ onlyMine: true, status: 'open', cursor: 'c1' });
    expect(repo.list).toHaveBeenCalledWith({ onlyMine: true, status: 'open', cursor: 'c1' });
  });

  it('returns the repo page verbatim', async () => {
    const page = { rows: [task({ taskId: 'a' }), task({ taskId: 'b', createdBy: null })], nextCursor: 'next' };
    const repo = fakeAdminTaskRepo({ list: vi.fn(async () => page) });
    const uc = new ListAdminTasksUseCase(repo);
    expect(await uc.execute({})).toBe(page);
  });
});

describe('CountOpenAdminTasksUseCase', () => {
  it('returns the repo count', async () => {
    const repo = fakeAdminTaskRepo({ openCount: vi.fn(async () => 7) });
    expect(await new CountOpenAdminTasksUseCase(repo).execute()).toBe(7);
  });
});
