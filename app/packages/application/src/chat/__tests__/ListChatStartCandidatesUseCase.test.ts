import { describe, it, expect, vi } from 'vitest';
import type { User } from '@kc/domain';
import { ListChatStartCandidatesUseCase } from '../ListChatStartCandidatesUseCase';
import type { IUserRepository } from '../../ports/IUserRepository';
import type { IBlockRepository, BlockedUser } from '../../ports/IBlockRepository';

const mkUser = (userId: string, name: string, overrides: Partial<User> = {}): User =>
  ({
    userId,
    displayName: name,
    shareHandle: `h_${userId}`,
    avatarUrl: null,
    accountStatus: 'active',
    ...overrides,
  }) as unknown as User;

const blocked = (userId: string): BlockedUser => ({
  userId,
  displayName: null,
  avatarUrl: null,
  blockedAt: '2026-01-01T00:00:00.000Z',
});

function setup(opts: { following?: User[]; found?: User[]; blockedByMe?: BlockedUser[] } = {}) {
  const users = {
    getFollowing: vi.fn(async () => opts.following ?? []),
    searchUsers: vi.fn(async () => opts.found ?? []),
  };
  const blocks = { listMyBlockedUsers: vi.fn(async () => opts.blockedByMe ?? []) };
  const uc = new ListChatStartCandidatesUseCase(
    users as unknown as IUserRepository,
    blocks as unknown as IBlockRepository,
  );
  return { uc, users, blocks };
}

describe('ListChatStartCandidatesUseCase (FR-CHAT-017)', () => {
  it('AC2: an empty query lists the people I follow and searches no one else', async () => {
    const { uc, users } = setup({ following: [mkUser('a', 'Avi'), mkUser('b', 'Bat')] });
    const res = await uc.execute({ viewerId: 'me', query: '' });
    expect(res.following.map((u) => u.userId)).toEqual(['a', 'b']);
    expect(res.others).toEqual([]);
    expect(users.searchUsers).not.toHaveBeenCalled();
  });

  it('AC3: a single character filters followed people but never searches everyone', async () => {
    const { uc, users } = setup({ following: [mkUser('a', 'Avi'), mkUser('b', 'Bat')] });
    const res = await uc.execute({ viewerId: 'me', query: 'a' });
    expect(res.following.map((u) => u.userId)).toEqual(['a', 'b']);
    expect(users.searchUsers).not.toHaveBeenCalled();
  });

  it('AC3: 2+ characters filter followed people by name or handle and add other people', async () => {
    const { uc, users } = setup({
      following: [mkUser('a', 'Avi Cohen'), mkUser('b', 'Bat Levi')],
      found: [mkUser('c', 'Avital Bar')],
    });
    const res = await uc.execute({ viewerId: 'me', query: ' AVI ' });
    expect(res.following.map((u) => u.userId)).toEqual(['a']);
    expect(res.others.map((u) => u.userId)).toEqual(['c']);
    expect(users.searchUsers).toHaveBeenCalledWith('AVI', { excludeUserId: 'me', limit: 20 });
  });

  it('AC3: a followed person is never repeated in the second group', async () => {
    const avi = mkUser('a', 'Avi');
    const { uc } = setup({ following: [avi], found: [avi, mkUser('c', 'Avital')] });
    const res = await uc.execute({ viewerId: 'me', query: 'avi' });
    expect(res.following.map((u) => u.userId)).toEqual(['a']);
    expect(res.others.map((u) => u.userId)).toEqual(['c']);
  });

  it('AC4: drops me, inactive accounts and people I blocked from both groups', async () => {
    const { uc } = setup({
      following: [
        mkUser('me', 'Me Myself'),
        mkUser('ban', 'Banned Bob', { accountStatus: 'banned' }),
        mkUser('blk', 'Blocked Bo'),
        mkUser('ok', 'Okay Bo'),
      ],
      found: [
        mkUser('del', 'Deleted Bo', { accountStatus: 'deleted' }),
        mkUser('pend', 'Pending Bo', { accountStatus: 'pending_verification' }),
        mkUser('blk2', 'Blocked Bo Two'),
        mkUser('ok2', 'Okay Bo Two'),
      ],
      blockedByMe: [blocked('blk'), blocked('blk2')],
    });
    const res = await uc.execute({ viewerId: 'me', query: 'bo' });
    expect(res.following.map((u) => u.userId)).toEqual(['ok']);
    expect(res.others.map((u) => u.userId)).toEqual(['ok2']);
  });

  it('AC4: people with no display name are matched by handle', async () => {
    const { uc } = setup({ following: [mkUser('a', '', { displayName: null, shareHandle: 'zed_99' })] });
    const res = await uc.execute({ viewerId: 'me', query: 'zed' });
    expect(res.following.map((u) => u.userId)).toEqual(['a']);
  });

  it('propagates a repository failure instead of returning a half result', async () => {
    const { uc, users } = setup();
    users.getFollowing.mockRejectedValueOnce(new Error('boom'));
    await expect(uc.execute({ viewerId: 'me', query: '' })).rejects.toThrow('boom');
  });
});
