import { describe, expect, it } from 'vitest';
import type { User } from '@kc/domain';
import { ReconcileDeferredBasicInfoUseCase } from '../ReconcileDeferredBasicInfoUseCase';
import { makeFakeUserRepo } from './onboardingFakeUserRepository';

const userId = 'u-1';

const completeRow = {
  displayName: 'Nave',
  city: 'tlv',
  cityName: 'Tel Aviv',
  profileStreet: 'Herzl',
  profileStreetNumber: '12',
  contactPhone: '050',
  dateOfBirth: '1990-01-01',
  onboardingState: 'pending_basic_info' as const,
  avatarUrl: 'https://example.test/a.png',
};

function asUser(overrides: Partial<typeof completeRow> = {}): User {
  return {
    userId,
    authProvider: 'phone',
    shareHandle: 'nave',
    biography: null,
    privacyMode: 'public',
    privacyChangedAt: null,
    accountStatus: 'active',
    notificationPreferences: {},
    isSuperAdmin: false,
    closureExplainerDismissed: false,
    firstPostNudgeDismissed: false,
    itemsGivenCount: 0,
    itemsReceivedCount: 0,
    followersCount: 0,
    followingCount: 0,
    preferredLanguage: 'he',
    verificationLevel: 1,
    createdAt: '',
    updatedAt: '',
    ...completeRow,
    ...overrides,
  } as User;
}

describe('ReconcileDeferredBasicInfoUseCase', () => {
  it('no-ops when onboarding is already past basic info', async () => {
    const repo = makeFakeUserRepo({
      [userId]: { ...completeRow, onboardingState: 'completed' },
    });
    repo.findById = async () => asUser();
    const uc = new ReconcileDeferredBasicInfoUseCase(repo);
    await expect(uc.execute({ userId })).resolves.toBeNull();
  });

  it('no-ops when profile fields are still incomplete', async () => {
    const repo = makeFakeUserRepo({ [userId]: { ...completeRow, contactPhone: null } });
    repo.findById = async () => asUser({ contactPhone: null });
    const uc = new ReconcileDeferredBasicInfoUseCase(repo);
    await expect(uc.execute({ userId })).resolves.toBeNull();
    expect(repo.rows.get(userId)?.onboardingState).toBe('pending_basic_info');
  });

  it('advances to completed when the level-1 profile is complete', async () => {
    const repo = makeFakeUserRepo({ [userId]: completeRow });
    repo.findById = async () => asUser();
    const uc = new ReconcileDeferredBasicInfoUseCase(repo);
    await expect(uc.execute({ userId })).resolves.toBe('completed');
    expect(repo.rows.get(userId)?.onboardingState).toBe('completed');
  });
});
