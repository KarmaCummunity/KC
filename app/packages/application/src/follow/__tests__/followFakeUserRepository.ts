// followFakeUserRepository.ts — in-memory IUserRepository for follow use-case
// tests. Captures the last call to each follow-related method so tests can
// assert on what the use case forwarded. Methods unrelated to follow are
// stubbed to throw.

import type {
  FollowEdge,
  FollowRequest,
  PrivacyMode,
  User,
} from '@kc/domain';
import type { FollowStateRaw, IUserRepository } from '../../ports/IUserRepository';

const N = (m: string) => () => Promise.reject(new Error(`fake.${m}: not_used_in_test`));

export class FollowFakeUserRepository implements IUserRepository {
  // Captures
  lastFollow: { followerId: string; followedId: string } | null = null;
  lastUnfollow: { followerId: string; followedId: string } | null = null;
  lastSendRequest: { requesterId: string; targetId: string } | null = null;
  lastCancelRequest: { requesterId: string; targetId: string } | null = null;
  lastAcceptRequest: { requesterId: string; targetId: string } | null = null;
  lastRejectRequest: { requesterId: string; targetId: string } | null = null;
  lastSetPrivacyMode: { userId: string; mode: PrivacyMode } | null = null;
  lastGetFollowers: { userId: string; limit: number; cursor?: string } | null = null;
  lastGetFollowing: { userId: string; limit: number; cursor?: string } | null = null;
  lastGetPendingRequests: { userId: string } | null = null;

  // Stubs
  followers: User[] = [];
  following: User[] = [];
  pendingRequests: FollowRequest[] = [];
  isFollowingResult = false;
  user: User | null = null;
  followError: Error | null = null;
  sendRequestError: Error | null = null;
  setPrivacyModeError: Error | null = null;
  setPrivacyModeResult: User | null = null;

  // ── Follow methods ────────────────────────────────────────────────────
  async follow(followerId: string, followedId: string): Promise<FollowEdge> {
    this.lastFollow = { followerId, followedId };
    if (this.followError) throw this.followError;
    return { followerId, followedId, createdAt: new Date().toISOString() };
  }
  async unfollow(followerId: string, followedId: string): Promise<void> {
    this.lastUnfollow = { followerId, followedId };
  }
  async isFollowing(): Promise<boolean> {
    return this.isFollowingResult;
  }
  async getFollowers(userId: string, limit: number, cursor?: string): Promise<User[]> {
    this.lastGetFollowers = { userId, limit, cursor };
    return this.followers;
  }
  async getFollowing(userId: string, limit: number, cursor?: string): Promise<User[]> {
    this.lastGetFollowing = { userId, limit, cursor };
    return this.following;
  }
  async sendFollowRequest(requesterId: string, targetId: string): Promise<FollowRequest> {
    this.lastSendRequest = { requesterId, targetId };
    if (this.sendRequestError) throw this.sendRequestError;
    return {
      requesterId,
      targetId,
      createdAt: new Date().toISOString(),
      status: 'pending',
      cooldownUntil: null,
    };
  }
  async cancelFollowRequest(requesterId: string, targetId: string): Promise<void> {
    this.lastCancelRequest = { requesterId, targetId };
  }
  async acceptFollowRequest(requesterId: string, targetId: string): Promise<void> {
    this.lastAcceptRequest = { requesterId, targetId };
  }
  async rejectFollowRequest(requesterId: string, targetId: string): Promise<void> {
    this.lastRejectRequest = { requesterId, targetId };
  }
  async getPendingFollowRequests(userId: string): Promise<FollowRequest[]> {
    this.lastGetPendingRequests = { userId };
    return this.pendingRequests;
  }

  pendingRequestsWithUsers: import('../types').PaginatedRequests = {
    requests: [],
    nextCursor: null,
  };

  async getPendingFollowRequestsWithUsers(
    userId: string,
    _limit: number,
    _cursor?: string,
  ) {
    this.lastGetPendingRequests = { userId };
    return this.pendingRequestsWithUsers;
  }

  followStateRaw: FollowStateRaw = {
    target: null,
    followingExists: false,
    pendingRequestExists: false,
    cooldownUntil: null,
  };

  async getFollowStateRaw(): Promise<FollowStateRaw> {
    return this.followStateRaw;
  }

  // ── User read methods used by follow use cases ────────────────────────
  async findById(): Promise<User | null> {
    return this.user;
  }
  async getChatCounterpartyContact(): Promise<string | null> {
    return null;
  }

  async findByHandle(): Promise<User | null> {
    return this.user;
  }
  async setPrivacyMode(userId: string, mode: PrivacyMode): Promise<User> {
    this.lastSetPrivacyMode = { userId, mode };
    if (this.setPrivacyModeError) throw this.setPrivacyModeError;
    if (!this.setPrivacyModeResult) throw new Error('fake.setPrivacyMode: stub missing');
    return this.setPrivacyModeResult;
  }

  // ── Unused — throw to keep tests honest ───────────────────────────────
  getOnboardingBootstrap = N('getOnboardingBootstrap') as IUserRepository['getOnboardingBootstrap'];
  markBasicInfoSkipped = N('markBasicInfoSkipped') as IUserRepository['markBasicInfoSkipped'];
  clearBasicInfoSkipped = N('clearBasicInfoSkipped') as IUserRepository['clearBasicInfoSkipped'];
  setBasicInfo = N('setBasicInfo') as IUserRepository['setBasicInfo'];
  setOnboardingState = N('setOnboardingState') as IUserRepository['setOnboardingState'];
  setAvatar = N('setAvatar') as IUserRepository['setAvatar'];
  setBiography = N('setBiography') as IUserRepository['setBiography'];
  setProfileAddressLines = N('setProfileAddressLines') as IUserRepository['setProfileAddressLines'];
  setContactPhone = N('setContactPhone') as IUserRepository['setContactPhone'];
  setDateOfBirth = N('setDateOfBirth') as IUserRepository['setDateOfBirth'];
  updateEditableProfile = N('updateEditableProfile') as IUserRepository['updateEditableProfile'];
  dismissClosureExplainer = N('dismissClosureExplainer') as IUserRepository['dismissClosureExplainer'];
  dismissFirstPostNudge = N('dismissFirstPostNudge') as IUserRepository['dismissFirstPostNudge'];
  getEditableProfile = N('getEditableProfile') as IUserRepository['getEditableProfile'];
  searchUsers = N('searchUsers') as IUserRepository['searchUsers'];
  create = N('create') as IUserRepository['create'];
  update = N('update') as IUserRepository['update'];
  delete = N('delete') as IUserRepository['delete'];
  deleteAccountViaEdgeFunction = N('deleteAccountViaEdgeFunction') as IUserRepository['deleteAccountViaEdgeFunction'];
  findByAuthIdentity = N('findByAuthIdentity') as IUserRepository['findByAuthIdentity'];
  createAuthIdentity = N('createAuthIdentity') as IUserRepository['createAuthIdentity'];
  updateNotificationPreferences = N('updateNotificationPreferences') as IUserRepository['updateNotificationPreferences'];
}

export function makeUser(overrides: Partial<User> = {}): User {
  return {
    userId: 'u_test',
    authProvider: 'email',
    shareHandle: 'tester',
    displayName: 'Tester',
    city: 'tlv',
    cityName: 'תל אביב',
    profileStreet: null,
    profileStreetNumber: null,
    contactPhone: null,
    dateOfBirth: null,
    biography: null,
    avatarUrl: null,
    privacyMode: 'Public',
    privacyChangedAt: null,
    accountStatus: 'active',
    onboardingState: 'completed',
    notificationPreferences: { critical: true, social: true },
    isSuperAdmin: false,
    closureExplainerDismissed: false,
    firstPostNudgeDismissed: false,
    itemsGivenCount: 0,
    itemsReceivedCount: 0,
    activePostsCountInternal: 0,
    followersCount: 0,
    followingCount: 0,
    karmaPoints: 0,
    verificationLevel: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    preferredLanguage: null,
    ...overrides,
  };
}
