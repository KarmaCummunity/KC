import { describe, expect, it } from 'vitest';
import type { BlockedUser, IBlockRepository } from '../../ports/IBlockRepository';
import { ListMyBlockedUsersUseCase } from '../ListMyBlockedUsersUseCase';

const rows: BlockedUser[] = [
  { userId: 'u2', displayName: 'Second', avatarUrl: null, blockedAt: '2026-11-02T10:00:00Z' },
  { userId: 'u1', displayName: null, avatarUrl: 'https://cdn.kc.test/a.jpg', blockedAt: '2026-11-01T10:00:00Z' },
];

function repo(list: () => Promise<BlockedUser[]>): IBlockRepository {
  return {
    isBlocking: async () => false,
    block: async () => undefined,
    unblock: async () => undefined,
    listMyBlockedUsers: list,
  };
}

describe('ListMyBlockedUsersUseCase', () => {
  it('returns the repository rows as they come (newest first, server-ordered)', async () => {
    await expect(new ListMyBlockedUsersUseCase(repo(async () => rows)).execute()).resolves.toEqual(rows);
  });

  it('returns an empty list when nobody is blocked', async () => {
    await expect(new ListMyBlockedUsersUseCase(repo(async () => [])).execute()).resolves.toEqual([]);
  });

  it('propagates a repository failure to the caller', async () => {
    const failing = repo(async () => {
      throw new Error('network');
    });
    await expect(new ListMyBlockedUsersUseCase(failing).execute()).rejects.toThrow('network');
  });
});
