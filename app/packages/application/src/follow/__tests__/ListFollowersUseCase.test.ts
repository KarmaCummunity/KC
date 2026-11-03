import { describe, it, expect } from 'vitest';
import { ListFollowersUseCase } from '../ListFollowersUseCase';
import { FollowFakeUserRepository, makeUser } from './followFakeUserRepository';

describe('ListFollowersUseCase', () => {
  it('forwards (userId, limit, cursor) and returns paginated users', async () => {
    const repo = new FollowFakeUserRepository();
    repo.followers = [makeUser({ userId: 'u_1' }), makeUser({ userId: 'u_2' })];
    const uc = new ListFollowersUseCase(repo);

    const out = await uc.execute({ userId: 'u_owner', limit: 50 });

    expect(repo.lastGetFollowers).toEqual({ userId: 'u_owner', limit: 50, cursor: undefined });
    expect(out.users).toHaveLength(2);
    expect(out.nextCursor).toBeNull();
  });

  it('returns nextCursor when limit equals page size', async () => {
    const repo = new FollowFakeUserRepository();
    repo.followers = Array.from({ length: 50 }, (_, i) => makeUser({ userId: `u_${i}` }));
    const uc = new ListFollowersUseCase(repo);

    const out = await uc.execute({ userId: 'u_owner', limit: 50 });
    expect(out.nextCursor).toBe('u_49');
  });

  it('clamps limit to a sensible max (100) and min (1), defaults to 50', async () => {
    const repo = new FollowFakeUserRepository();
    const uc = new ListFollowersUseCase(repo);

    await uc.execute({ userId: 'u_owner', limit: 9999 });
    expect(repo.lastGetFollowers?.limit).toBe(100);

    await uc.execute({ userId: 'u_owner', limit: 0 });
    expect(repo.lastGetFollowers?.limit).toBe(1);

    await uc.execute({ userId: 'u_owner' });
    expect(repo.lastGetFollowers?.limit).toBe(50);
  });
});
