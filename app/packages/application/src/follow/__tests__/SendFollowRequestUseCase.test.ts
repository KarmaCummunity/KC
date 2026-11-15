import { describe, it, expect } from 'vitest';
import { SendFollowRequestUseCase } from '../SendFollowRequestUseCase';
import { FollowFakeUserRepository } from './followFakeUserRepository';
import { FollowError } from '../errors';

describe('SendFollowRequestUseCase', () => {
  it('creates a pending request', async () => {
    const repo = new FollowFakeUserRepository();
    const uc = new SendFollowRequestUseCase(repo);

    const out = await uc.execute({ viewerId: 'u_a', targetUserId: 'u_b' });

    expect(repo.lastSendRequest).toEqual({ requesterId: 'u_a', targetId: 'u_b' });
    expect(out.request.status).toBe('pending');
  });

  it('rejects self-request', async () => {
    const repo = new FollowFakeUserRepository();
    const uc = new SendFollowRequestUseCase(repo);

    await expect(
      uc.execute({ viewerId: 'u_a', targetUserId: 'u_a' }),
    ).rejects.toMatchObject({ code: 'self_follow' });
  });

  it('propagates cooldown_active with cooldownUntil', async () => {
    const repo = new FollowFakeUserRepository();
    repo.sendRequestError = new FollowError('cooldown_active', 'cooldown', {
      cooldownUntil: '2026-06-01T00:00:00Z',
    });
    const uc = new SendFollowRequestUseCase(repo);

    await expect(
      uc.execute({ viewerId: 'u_a', targetUserId: 'u_b' }),
    ).rejects.toMatchObject({ code: 'cooldown_active', cooldownUntil: '2026-06-01T00:00:00Z' });
  });
});
