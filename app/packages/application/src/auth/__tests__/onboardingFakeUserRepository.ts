// onboardingFakeUserRepository.ts — in-memory IUserRepository for auth/onboarding
// use-case tests. Only methods those tests exercise are implemented; the rest
// throw to flag accidental reach-through.

import type { IUserRepository, OnboardingBootstrap } from '../../ports/IUserRepository';
import type { OnboardingState } from '@kc/domain';

interface Row {
  displayName: string;
  city: string;
  cityName: string;
  profileStreet?: string | null;
  profileStreetNumber?: string | null;
  contactPhone?: string | null;
  dateOfBirth?: string | null;
  onboardingState: OnboardingState;
  basicInfoSkipped?: boolean;
  avatarUrl?: string | null;
  biography?: string | null;
  closureExplainerDismissed?: boolean;
  firstPostNudgeDismissed?: boolean;
}

export interface FakeUserRepo extends IUserRepository {
  rows: Map<string, Row>;
}

export function makeFakeUserRepo(seed: Record<string, Row> = {}): FakeUserRepo {
  const rows = new Map(Object.entries(seed));
  const notImpl =
    (name: string) =>
    async (..._args: unknown[]): Promise<never> => {
      throw new Error(`onboardingFakeUserRepo: ${name} not implemented`);
    };
  return {
    rows,
    findById: notImpl('findById'),
    findByHandle: notImpl('findByHandle'),
    getChatCounterpartyContact: notImpl('getChatCounterpartyContact'),
    create: notImpl('create'),
    update: notImpl('update'),
    delete: notImpl('delete'),
    deleteAccountViaEdgeFunction: notImpl('deleteAccountViaEdgeFunction'),
    follow: notImpl('follow'),
    unfollow: notImpl('unfollow'),
    isFollowing: notImpl('isFollowing'),
    getFollowers: notImpl('getFollowers'),
    getFollowing: notImpl('getFollowing'),
    sendFollowRequest: notImpl('sendFollowRequest'),
    acceptFollowRequest: notImpl('acceptFollowRequest'),
    rejectFollowRequest: notImpl('rejectFollowRequest'),
    cancelFollowRequest: notImpl('cancelFollowRequest'),
    getPendingFollowRequests: notImpl(
      'getPendingFollowRequests',
    ),
    getPendingFollowRequestsWithUsers: notImpl(
      'getPendingFollowRequestsWithUsers',
    ),
    findByAuthIdentity: notImpl('findByAuthIdentity'),
    createAuthIdentity: notImpl('createAuthIdentity'),
    async getOnboardingBootstrap(userId): Promise<OnboardingBootstrap> {
      const row = rows.get(userId);
      if (!row) throw new Error(`onboardingFakeUserRepo: no row for userId=${userId}`);
      return {
        state: row.onboardingState,
        basicInfoSkipped: row.basicInfoSkipped === true,
      };
    },
    async markBasicInfoSkipped(userId: string): Promise<void> {
      const row = rows.get(userId) ?? {
        displayName: '',
        city: '',
        cityName: '',
        onboardingState: 'pending_basic_info' as OnboardingState,
      };
      rows.set(userId, { ...row, basicInfoSkipped: true });
    },
    async clearBasicInfoSkipped(userId: string): Promise<void> {
      const row = rows.get(userId) ?? {
        displayName: '',
        city: '',
        cityName: '',
        onboardingState: 'pending_basic_info' as OnboardingState,
      };
      rows.set(userId, { ...row, basicInfoSkipped: false });
    },
    async setBasicInfo(userId, { displayName, city, cityName }) {
      const row = rows.get(userId) ?? {
        displayName: '',
        city: '',
        cityName: '',
        onboardingState: 'pending_basic_info' as OnboardingState,
      };
      rows.set(userId, { ...row, displayName, city, cityName, basicInfoSkipped: false });
    },
    // Acts on the signed-in member, like the RPC: the one seeded row (as setDateOfBirth below).
    async setOnboardingState(state) {
      const userId = [...rows.keys()][0]!;
      rows.set(userId, { ...rows.get(userId)!, onboardingState: state });
    },
    resetOnboardingForDev: notImpl('resetOnboardingForDev'),
    async setAvatar(userId, avatarUrl) {
      const row = rows.get(userId) ?? {
        displayName: '',
        city: '',
        cityName: '',
        onboardingState: 'pending_basic_info' as OnboardingState,
      };
      rows.set(userId, { ...row, avatarUrl });
    },
    async setBiography(userId, biography) {
      const row = rows.get(userId) ?? {
        displayName: '',
        city: '',
        cityName: '',
        onboardingState: 'pending_basic_info' as OnboardingState,
      };
      rows.set(userId, { ...row, biography });
    },
    async getEditableProfile(userId) {
      const row = rows.get(userId);
      if (!row) throw new Error(`onboardingFakeUserRepo: no row for userId=${userId}`);
      return {
        displayName: row.displayName,
        city: row.city,
        cityName: row.cityName,
        profileStreet: row.profileStreet ?? null,
        profileStreetNumber: row.profileStreetNumber ?? null,
        contactPhone: row.contactPhone ?? null,
        biography: row.biography ?? null,
        avatarUrl: row.avatarUrl ?? null,
      };
    },
    async setProfileAddressLines(userId, street, streetNumber) {
      const row = rows.get(userId) ?? {
        displayName: '',
        city: '',
        cityName: '',
        onboardingState: 'pending_basic_info' as OnboardingState,
      };
      rows.set(userId, { ...row, profileStreet: street, profileStreetNumber: streetNumber });
    },
    // The caller's own row: the real RPC takes no user id and reads auth.uid().
    async setDateOfBirth(dateOfBirth) {
      const userId = [...rows.keys()][0]!;
      rows.set(userId, { ...rows.get(userId)!, dateOfBirth });
    },
    async setContactPhone(userId, contactPhone) {
      const row = rows.get(userId) ?? {
        displayName: '',
        city: '',
        cityName: '',
        onboardingState: 'pending_basic_info' as OnboardingState,
      };
      rows.set(userId, { ...row, contactPhone });
    },
    async updateEditableProfile(userId, patch) {
      const row = rows.get(userId) ?? {
        displayName: '',
        city: '',
        cityName: '',
        onboardingState: 'pending_basic_info' as OnboardingState,
      };
      const next = { ...row };
      if (patch.displayName !== undefined) next.displayName = patch.displayName;
      if (patch.city !== undefined) next.city = patch.city;
      if (patch.cityName !== undefined) next.cityName = patch.cityName;
      if (patch.profileStreet !== undefined) next.profileStreet = patch.profileStreet;
      if (patch.profileStreetNumber !== undefined) next.profileStreetNumber = patch.profileStreetNumber;
      if (patch.contactPhone !== undefined) next.contactPhone = patch.contactPhone;
      if (patch.biography !== undefined) next.biography = patch.biography;
      if (patch.avatarUrl !== undefined) next.avatarUrl = patch.avatarUrl;
      rows.set(userId, next);
    },
    async dismissClosureExplainer(userId) {
      const row = rows.get(userId) ?? {
        displayName: '',
        city: '',
        cityName: '',
        onboardingState: 'pending_basic_info' as OnboardingState,
      };
      rows.set(userId, { ...row, closureExplainerDismissed: true });
    },
    async dismissFirstPostNudge(userId) {
      const row = rows.get(userId) ?? {
        displayName: '',
        city: '',
        cityName: '',
        onboardingState: 'pending_basic_info' as OnboardingState,
      };
      rows.set(userId, { ...row, firstPostNudgeDismissed: true });
    },
    searchUsers: notImpl('searchUsers'),
    setPrivacyMode: notImpl('setPrivacyMode'),
    getFollowStateRaw: notImpl('getFollowStateRaw'),
    updateNotificationPreferences: notImpl('updateNotificationPreferences'),
  };
}
