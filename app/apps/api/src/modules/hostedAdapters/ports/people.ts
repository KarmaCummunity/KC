import type {
  IAccountGateRepository,
  IBlockRepository,
  IUserRepository,
} from '@kc/application';
import {
  SupabaseAccountGateRepository,
  SupabaseBlockRepository,
  SupabaseUserRepository,
} from '@kc/infrastructure-supabase';
import { definePort, type PortDefinition } from '../../../platform/ports/portDefinition';
import { adapterClient } from '../adapterClient';

const accountGate = definePort<IAccountGateRepository>({
  name: 'accountGate',
  create: (client) => new SupabaseAccountGateRepository(adapterClient<typeof SupabaseAccountGateRepository>(client)),
  methods: {
    checkAccountGate: 'member',
    restoreAccount: 'member',
  },
});

const block = definePort<IBlockRepository>({
  name: 'block',
  create: (client) => new SupabaseBlockRepository(adapterClient<typeof SupabaseBlockRepository>(client)),
  methods: {
    isBlocking: 'member',
    block: 'member',
    unblock: 'member',
    listMyBlockedUsers: 'member',
  },
});

const user = definePort<IUserRepository>({
  name: 'user',
  create: (client) => new SupabaseUserRepository(adapterClient<typeof SupabaseUserRepository>(client)),
  methods: {
    findById: 'member',
    findByHandle: 'member',
    getChatCounterpartyContact: 'member',
    create: 'member',
    update: 'member',
    delete: 'member',
    requestAccountDeletion: 'member',
    getOnboardingBootstrap: 'member',
    markBasicInfoSkipped: 'member',
    clearBasicInfoSkipped: 'member',
    setBasicInfo: 'member',
    setOnboardingState: 'member',
    setAvatar: 'member',
    setBiography: 'member',
    setPrivacyMode: 'member',
    getEditableProfile: 'member',
    setProfileAddressLines: 'member',
    setContactPhone: 'member',
    setDateOfBirth: 'member',
    updateEditableProfile: 'member',
    dismissClosureExplainer: 'member',
    dismissFirstPostNudge: 'member',
    searchUsers: 'member',
    follow: 'member',
    unfollow: 'member',
    isFollowing: 'member',
    getFollowers: 'member',
    getFollowing: 'member',
    sendFollowRequest: 'member',
    acceptFollowRequest: 'member',
    rejectFollowRequest: 'member',
    cancelFollowRequest: 'member',
    getPendingFollowRequests: 'member',
    getPendingFollowRequestsWithUsers: 'member',
    getFollowStateRaw: 'member',
    updateNotificationPreferences: 'member',
    findByAuthIdentity: 'member',
    createAuthIdentity: 'member',
  },
});

export const PEOPLE_PORTS: readonly PortDefinition[] = [accountGate, block, user];
