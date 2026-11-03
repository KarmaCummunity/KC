import { describe, expect, it } from 'vitest';
import type { IBlockRepository } from '../../ports/IBlockRepository';
import { SetUserBlockedUseCase } from '../SetUserBlockedUseCase';

function fakeRepo() {
  const calls: string[] = [];
  const repo: IBlockRepository = {
    isBlocking: async () => false,
    block: async (a, b) => void calls.push(`block:${a}:${b}`),
    unblock: async (a, b) => void calls.push(`unblock:${a}:${b}`),
    listMyBlockedUsers: async () => [],
  };
  return { repo, calls };
}

describe('SetUserBlockedUseCase', () => {
  it('blocks and unblocks', async () => {
    const { repo, calls } = fakeRepo();
    const uc = new SetUserBlockedUseCase(repo);
    await uc.execute({ blockerId: 'a', targetUserId: 'b', blocked: true });
    await uc.execute({ blockerId: 'a', targetUserId: 'b', blocked: false });
    expect(calls).toEqual(['block:a:b', 'unblock:a:b']);
  });
  it('rejects blocking yourself or missing ids', async () => {
    const { repo, calls } = fakeRepo();
    const uc = new SetUserBlockedUseCase(repo);
    await expect(uc.execute({ blockerId: 'a', targetUserId: 'a', blocked: true })).rejects.toThrow('block_self');
    await expect(uc.execute({ blockerId: '', targetUserId: 'b', blocked: true })).rejects.toThrow('block_missing_user');
    expect(calls).toEqual([]);
  });
});
