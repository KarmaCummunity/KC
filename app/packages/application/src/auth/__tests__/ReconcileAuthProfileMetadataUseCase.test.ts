import { describe, expect, it, vi } from 'vitest';
import type { User } from '@kc/domain';
import type { IUserRepository } from '../../ports/IUserRepository';
import { ReconcileAuthProfileMetadataUseCase } from '../ReconcileAuthProfileMetadataUseCase';
import { FakeAuthService, makeSession } from './fakeAuthService';

const baseUser = (over: Partial<User>): User =>
  ({
    userId: 'u-1',
    authProvider: 'google',
    shareHandle: 'u1',
    displayName: 'DB Name',
    city: '4000',
    cityName: 'חיפה',
    profileStreet: null,
    profileStreetNumber: null,
    contactPhone: null,
    biography: null,
    avatarUrl: 'https://db.example/a.jpg',
    privacyMode: 'Public',
    privacyChangedAt: null,
    accountStatus: 'active',
    onboardingState: 'completed',
    notificationPreferences: {},
    isSuperAdmin: false,
    closureExplainerDismissed: false,
    firstPostNudgeDismissed: false,
    itemsGivenCount: 0,
    itemsReceivedCount: 0,
    activePostsCountInternal: 0,
    followersCount: 0,
    followingCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }) as User;

describe('ReconcileAuthProfileMetadataUseCase', () => {
  it('syncs when DB profile fields differ from the restored session', async () => {
    const users = {
      findById: vi.fn().mockResolvedValue(baseUser({})),
    } as unknown as IUserRepository;
    const auth = new FakeAuthService();
    auth.currentSession = makeSession({
      userId: 'u-1',
      displayName: 'JWT Name',
      avatarUrl: 'https://jwt.example/old.jpg',
    });

    await new ReconcileAuthProfileMetadataUseCase(users, auth).execute({ userId: 'u-1' });

    expect(auth.syncProfileCalls).toEqual([
      { displayName: 'DB Name', avatarUrl: 'https://db.example/a.jpg' },
    ]);
  });

  it('no-ops when session already matches DB', async () => {
    const users = {
      findById: vi.fn().mockResolvedValue(
        baseUser({ displayName: 'Same', avatarUrl: 'https://x.example/a.jpg' }),
      ),
    } as unknown as IUserRepository;
    const auth = new FakeAuthService();
    auth.currentSession = makeSession({
      userId: 'u-1',
      displayName: 'Same',
      avatarUrl: 'https://x.example/a.jpg',
    });

    await new ReconcileAuthProfileMetadataUseCase(users, auth).execute({ userId: 'u-1' });

    expect(auth.syncProfileCalls).toHaveLength(0);
  });

  it('no-ops when input userId is blank', async () => {
    const users = { findById: vi.fn() } as unknown as IUserRepository;
    const auth = new FakeAuthService();

    await new ReconcileAuthProfileMetadataUseCase(users, auth).execute({ userId: '   ' });

    expect(users.findById).not.toHaveBeenCalled();
    expect(auth.syncProfileCalls).toHaveLength(0);
  });

  it('no-ops when user not found or session missing or session userId does not match', async () => {
    const users = {
      findById: vi.fn().mockResolvedValue(null),
    } as unknown as IUserRepository;
    const auth = new FakeAuthService();
    auth.currentSession = makeSession({ userId: 'u-1' });

    const uc = new ReconcileAuthProfileMetadataUseCase(users, auth);

    // user is null
    await uc.execute({ userId: 'u-1' });
    expect(auth.syncProfileCalls).toHaveLength(0);

    // session is null
    users.findById = vi.fn().mockResolvedValue(baseUser({}));
    auth.currentSession = null;
    await uc.execute({ userId: 'u-1' });
    expect(auth.syncProfileCalls).toHaveLength(0);

    // session userId does not match
    auth.currentSession = makeSession({ userId: 'other-user' });
    await uc.execute({ userId: 'u-1' });
    expect(auth.syncProfileCalls).toHaveLength(0);
  });

  it('syncs only displayName when only name drifts', async () => {
    const users = {
      findById: vi.fn().mockResolvedValue(
        baseUser({ displayName: 'New Name', avatarUrl: 'https://same.example/a.jpg' }),
      ),
    } as unknown as IUserRepository;
    const auth = new FakeAuthService();
    auth.currentSession = makeSession({
      userId: 'u-1',
      displayName: 'Old Name',
      avatarUrl: 'https://same.example/a.jpg',
    });

    await new ReconcileAuthProfileMetadataUseCase(users, auth).execute({ userId: 'u-1' });

    expect(auth.syncProfileCalls).toEqual([{ displayName: 'New Name' }]);
  });

  it('syncs only avatarUrl when only avatar drifts', async () => {
    const users = {
      findById: vi.fn().mockResolvedValue(
        baseUser({ displayName: 'Same Name', avatarUrl: 'https://new.example/a.jpg' }),
      ),
    } as unknown as IUserRepository;
    const auth = new FakeAuthService();
    auth.currentSession = makeSession({
      userId: 'u-1',
      displayName: 'Same Name',
      avatarUrl: 'https://old.example/a.jpg',
    });

    await new ReconcileAuthProfileMetadataUseCase(users, auth).execute({ userId: 'u-1' });

    expect(auth.syncProfileCalls).toEqual([{ avatarUrl: 'https://new.example/a.jpg' }]);
  });
});
