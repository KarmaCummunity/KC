import {
  SupabaseAccountGateRepository,
  SupabaseActiveStatusRepository,
  SupabaseBlockRepository,
  SupabaseFollowSuggestionsRepository,
  SupabaseIdentityVerificationService,
  SupabaseKarmaHistoryRepository,
  SupabaseLegalDocumentSource,
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

// `startSession` is served by the function this server has taken over (`modules/identityVerification`).
const identityVerification = hostedPort('identityVerification', {
  create: (client) => new SupabaseIdentityVerificationService(adapterClient<typeof SupabaseIdentityVerificationService>(client)),
  methods: {
    getStatus: 'member',
    acceptConsent: 'member',
    startSession: 'member',
  },
});

const karmaHistory = hostedPort('karmaHistory', {
  create: (client) => new SupabaseKarmaHistoryRepository(adapterClient<typeof SupabaseKarmaHistoryRepository>(client)),
  methods: {
    listHistory: 'member',
  },
});

const legalDocument = hostedPort('legalDocument', {
  // The database source only: the offline copy of each document lives on the device.
  create: (client) => new SupabaseLegalDocumentSource(adapterClient<typeof SupabaseLegalDocumentSource>(client)),
  methods: {
    // The terms are read before sign-up; the database lets the anon role read both tables.
    getCurrentContent: 'public',
    getPendingForCurrentUser: 'member',
    acceptVersion: 'member',
  },
  // A document changes when a new version is published, a few times a year.
  visitorCacheSeconds: { getCurrentContent: 300 },
});

export const PEOPLE_PORTS: readonly PortDefinition[] = [accountGate, activeStatus, block, followSuggestions, identityVerification, karmaHistory, legalDocument, user];
