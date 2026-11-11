import { describe, expect, it, vi } from 'vitest';
import type {
  AdminSearchPage, AdminUserSearchResult,
} from '@kc/domain';
import { AdminSearchUsersUseCase } from '../AdminSearchUsersUseCase';
import { AdminSearchPostsUseCase } from '../AdminSearchPostsUseCase';
import { AdminSearchAuditUseCase } from '../AdminSearchAuditUseCase';
import { AdminFindMembersUseCase } from '../AdminFindMembersUseCase';
import type { IAdminContentRepository } from '../IAdminContentRepository';

function fakeRepo(overrides: Partial<IAdminContentRepository> = {}): IAdminContentRepository {
  return {
    findActiveMembers: vi.fn(async () => []),
    searchUsers: vi.fn(async () => ({ rows: [], nextCursor: null })),
    searchPosts: vi.fn(async () => ({ rows: [], nextCursor: null })),
    searchAudit: vi.fn(async () => ({ rows: [], nextCursor: null })),
    ...overrides,
  };
}

describe('AdminSearchUsersUseCase', () => {
  it('forwards filters and returns the repo page', async () => {
    const repo = fakeRepo();
    const uc = new AdminSearchUsersUseCase(repo);
    await uc.execute({ query: 'אל', status: 'banned', limit: 10, cursor: { createdAt: 't', id: 'u0' } });
    expect(repo.searchUsers).toHaveBeenCalledWith({
      query: 'אל', status: 'banned', limit: 10, cursor: { createdAt: 't', id: 'u0' },
    });
  });

  it('returns the repo result verbatim', async () => {
    const page: AdminSearchPage<AdminUserSearchResult> = {
      rows: [{
        userId: 'u1', displayName: 'A', shareHandle: null, accountStatus: 'active',
        cityId: null, createdAt: new Date(),
      }],
      nextCursor: { createdAt: 't', id: 'u1' },
    };
    const repo = fakeRepo({ searchUsers: vi.fn(async () => page) });
    const uc = new AdminSearchUsersUseCase(repo);
    expect(await uc.execute({})).toBe(page);
  });
});

describe('AdminSearchPostsUseCase', () => {
  it('passes filters straight through', async () => {
    const repo = fakeRepo();
    const uc = new AdminSearchPostsUseCase(repo);
    await uc.execute({ query: 'help', status: 'open' });
    expect(repo.searchPosts).toHaveBeenCalledWith({ query: 'help', status: 'open' });
  });
});

describe('AdminSearchAuditUseCase', () => {
  it('passes filters straight through', async () => {
    const repo = fakeRepo();
    const uc = new AdminSearchAuditUseCase(repo);
    await uc.execute({ targetUserId: 'u1', action: 'ban_user' });
    expect(repo.searchAudit).toHaveBeenCalledWith({ targetUserId: 'u1', action: 'ban_user' });
  });

  it('handles empty filter object', async () => {
    const repo = fakeRepo();
    const uc = new AdminSearchAuditUseCase(repo);
    const r = await uc.execute({});
    expect(repo.searchAudit).toHaveBeenCalledWith({});
    expect(r.rows).toEqual([]);
    expect(r.nextCursor).toBeNull();
  });
});

describe('AdminFindMembersUseCase', () => {
  it('looks members up by the trimmed text with the picker limit', async () => {
    const repo = fakeRepo({ findActiveMembers: vi.fn(async () => [{ userId: 'u1', displayName: 'Dana' }]) });
    const found = await new AdminFindMembersUseCase(repo).execute('  dan  ');
    expect(repo.findActiveMembers).toHaveBeenCalledWith('dan', 8);
    expect(found).toEqual([{ userId: 'u1', displayName: 'Dana' }]);
  });

  it('does not query for fewer than two characters', async () => {
    const repo = fakeRepo();
    expect(await new AdminFindMembersUseCase(repo).execute(' d ')).toEqual([]);
    expect(repo.findActiveMembers).not.toHaveBeenCalled();
  });
});
