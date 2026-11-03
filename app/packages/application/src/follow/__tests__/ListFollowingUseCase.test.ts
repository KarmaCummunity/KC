import { describe, it, expect } from 'vitest';
import { ListFollowingUseCase } from '../ListFollowingUseCase';
import { FollowFakeUserRepository, makeUser } from './followFakeUserRepository';

describe('ListFollowingUseCase', () => {
  it('forwards and paginates', async () => {
    const repo = new FollowFakeUserRepository();
    repo.following = [makeUser({ userId: 'u_x' })];
    const uc = new ListFollowingUseCase(repo);

    const out = await uc.execute({ userId: 'u_owner', limit: 50 });
    expect(repo.lastGetFollowing).toEqual({ userId: 'u_owner', limit: 50, cursor: undefined });
    expect(out.users).toHaveLength(1);
    expect(out.nextCursor).toBeNull();
  });

  it('uses default limit of 50 and returns nextCursor when count matches limit', async () => {
    const repo = new FollowFakeUserRepository();
    repo.following = [makeUser({ userId: 'u_1' }), makeUser({ userId: 'u_2' })];
    const uc = new ListFollowingUseCase(repo);

    const out = await uc.execute({ userId: 'u_owner', limit: 2 });
    expect(out.nextCursor).toBe('u_2');

    await uc.execute({ userId: 'u_owner' });
    expect(repo.lastGetFollowing?.limit).toBe(50);
  });

  it('clamps limit to [1, 100]', async () => {
    const repo = new FollowFakeUserRepository();
    const uc = new ListFollowingUseCase(repo);

    await uc.execute({ userId: 'u_owner', limit: 0 });
    expect(repo.lastGetFollowing?.limit).toBe(1);

    await uc.execute({ userId: 'u_owner', limit: 200 });
    expect(repo.lastGetFollowing?.limit).toBe(100);
  });
});
