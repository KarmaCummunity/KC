import {
  SupabaseAccountGateRepository,
  SupabaseActiveStatusRepository,
  SupabaseBlockRepository,
  SupabaseFollowSuggestionsRepository,
  SupabaseUserRepository,
} from '@kc/infrastructure-supabase';
import type { PortDefinition } from '../../../platform/ports/portDefinition';
import { adapterClient } from '../adapterClient';
import { hostedPort } from '../hostedPort';

const accountGate = hostedPort('accountGate', {
  create: (client) => new SupabaseAccountGateRepository(adapterClient<typeof SupabaseAccountGateRepository>(client)),
  methods: {
    checkAccountGate: 'member',
    restoreAccount: 'member',
  },
});

const block = hostedPort('block', {
  create: (client) => new SupabaseBlockRepository(adapterClient<typeof SupabaseBlockRepository>(client)),
  methods: {
    isBlocking: 'member',
    block: 'member',
    unblock: 'member',
    listMyBlockedUsers: 'member',
  },
});

const user = hostedPort('user', {
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

const activeStatus = hostedPort('activeStatus', {
  create: (client) => new SupabaseActiveStatusRepository(adapterClient<typeof SupabaseActiveStatusRepository>(client)),
  methods: {
    get: 'member',
    set: 'member',
  },
});

const followSuggestions = hostedPort('followSuggestions', {
  create: (client) => new SupabaseFollowSuggestionsRepository(adapterClient<typeof SupabaseFollowSuggestionsRepository>(client)),
  methods: {
    listSuggestions: 'member',
    getProfileCompleteness: 'member',
  },
});

export const PEOPLE_PORTS: readonly PortDefinition[] = [accountGate, activeStatus, block, followSuggestions, user];
