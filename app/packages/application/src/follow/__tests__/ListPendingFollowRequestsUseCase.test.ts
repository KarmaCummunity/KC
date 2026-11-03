import { describe, it, expect } from 'vitest';
import { ListPendingFollowRequestsUseCase } from '../ListPendingFollowRequestsUseCase';
import { FollowFakeUserRepository, makeUser } from './followFakeUserRepository';

describe('ListPendingFollowRequestsUseCase', () => {
  it('forwards (targetId, limit, cursor) and returns requests with requester users', async () => {
    const repo = new FollowFakeUserRepository();
    repo.pendingRequestsWithUsers = {
      requests: [
        {
          request: {
            requesterId: 'u_r',
            targetId: 'u_target',
            createdAt: '2026-05-01T00:00:00Z',
            status: 'pending',
            cooldownUntil: null,
          },
          requester: makeUser({ userId: 'u_r' }),
        },
      ],
      nextCursor: null,
    };
    const uc = new ListPendingFollowRequestsUseCase(repo);

    const out = await uc.execute({ targetId: 'u_target', limit: 50 });
    expect(out.requests).toHaveLength(1);
    expect(out.requests[0]?.requester.userId).toBe('u_r');
  });

  it('clamps limit between 1 and 100, defaults to 50', async () => {
    let capturedLimit: number | undefined;
    const repo = new FollowFakeUserRepository();
    repo.getPendingFollowRequestsWithUsers = async (_targetId, limit) => {
      capturedLimit = limit;
      return { requests: [], nextCursor: null };
    };
    const uc = new ListPendingFollowRequestsUseCase(repo);

    await uc.execute({ targetId: 'u_target' });
    expect(capturedLimit).toBe(50);

    await uc.execute({ targetId: 'u_target', limit: 0 });
    expect(capturedLimit).toBe(1);

    await uc.execute({ targetId: 'u_target', limit: 200 });
    expect(capturedLimit).toBe(100);
  });
});
