import { describe, it, expect } from 'vitest';
import { SearchUsersForClosureUseCase } from '../SearchUsersForClosureUseCase';
import type { IUserRepository } from '../../ports/IUserRepository';
import type { User } from '@kc/domain';

const mkUser = (overrides: Partial<User> = {}): User =>
  ({
    userId: 'u_x',
    displayName: 'דנה לוי',
    avatarUrl: null,
    cityName: 'תל אביב',
    shareHandle: 'dana',
    biography: null,
    city: 'tel-aviv',
    privacyMode: 'Public',
    accountStatus: 'active',
    onboardingState: 'completed',
    closureExplainerDismissed: false,
    firstPostNudgeDismissed: false,
    isSuperAdmin: false,
    itemsGivenCount: 0,
    itemsReceivedCount: 0,
    activePostsCountInternal: 0,
    followersCount: 0,
    followingCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as unknown as User);

describe('SearchUsersForClosureUseCase', () => {
  it('forwards query + excludeUserId to the repo and shapes results', async () => {
    let captured: { query: string; opts: { excludeUserId: string; limit: number } } | null = null;
    const userRepo: Partial<IUserRepository> = {
      async searchUsers(query, opts) {
        captured = { query, opts };
        return [mkUser({ userId: 'u_a', displayName: 'דנה' })];
      },
    };
    const uc = new SearchUsersForClosureUseCase(userRepo as IUserRepository);

    const results = await uc.execute({ query: 'דנה', ownerId: 'u_owner', limit: 10 });

    expect(captured).toEqual({ query: 'דנה', opts: { excludeUserId: 'u_owner', limit: 10 } });
    expect(results).toEqual([
      { userId: 'u_a', fullName: 'דנה', avatarUrl: null, cityName: 'תל אביב', lastMessageAt: '' },
    ]);
  });

  it('uses default limit of 20 when not specified', async () => {
    let capturedLimit: number | null = null;
    const userRepo: Partial<IUserRepository> = {
      async searchUsers(_q, opts) {
        capturedLimit = opts.limit;
        return [];
      },
    };
    const uc = new SearchUsersForClosureUseCase(userRepo as IUserRepository);

    await uc.execute({ query: 'x', ownerId: 'u_owner' });

    expect(capturedLimit).toBe(20);
  });

  it('maps missing or null cityName to null in candidate', async () => {
    const userRepo: Partial<IUserRepository> = {
      async searchUsers() {
        return [mkUser({ userId: 'u_b', displayName: 'User B', cityName: null })];
      },
    };
    const uc = new SearchUsersForClosureUseCase(userRepo as IUserRepository);

    const results = await uc.execute({ query: 'b', ownerId: 'u_owner' });
    expect(results[0]?.cityName).toBeNull();
  });
});
