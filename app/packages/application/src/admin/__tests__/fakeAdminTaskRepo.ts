import { vi } from 'vitest';
import type { IAdminTaskRepository } from '../IAdminTaskRepository';

export function fakeAdminTaskRepo(overrides: Partial<IAdminTaskRepository> = {}): IAdminTaskRepository {
  return {
    list:        vi.fn(async () => ({ rows: [], nextCursor: null })),
    openCount:   vi.fn(async () => 0),
    getDetail:   vi.fn(async () => null),
    create:      vi.fn(async () => 'task-1'),
    update:      vi.fn(async () => {}),
    setStatus:   vi.fn(async () => {}),
    assign:      vi.fn(async () => {}),
    addComment:  vi.fn(async () => 'activity-1'),
    delete:      vi.fn(async () => {}),
    ...overrides,
  };
}
