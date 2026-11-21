import type { IChatRepository, IPostRepository, IReportRepository, ISavedPostsRepository, IUserRepository } from '@kc/application';
import {
  SupabaseChatRepository,
  SupabasePostRepository,
  SupabaseReportRepository,
  SupabaseSavedPostsRepository,
  SupabaseUserRepository,
} from '@kc/infrastructure-supabase';
import { definePort, type PortDefinition } from '../../platform/ports/portDefinition';
import type { SqlBackedClient } from '../../platform/postgrest/sqlBackedClient';

/**
 * Ports served by running the existing Supabase data adapters on the server
 * (ADR-010). An adapter is listed here once its shared contract suite passes
 * through the gateway; a port leaves this file when a native implementation
 * replaces its adapter.
 *
 * Every method is `member` for now: the app's signed-out surface is wired in
 * a later step, port by port, and each method opened to visitors is a
 * decision of its own.
 */

/** The adapters type their client as the Supabase client; the SQL-backed one serves the slice they use. */
function adapterClient<Adapter extends abstract new (client: never) => unknown>(client: SqlBackedClient): ConstructorParameters<Adapter>[0] {
  return client as unknown as ConstructorParameters<Adapter>[0];
}

const users = definePort<IUserRepository>({
  name: 'users',
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

const posts = definePort<IPostRepository>({
  name: 'posts',
  create: (client) => new SupabasePostRepository(adapterClient<typeof SupabasePostRepository>(client)),
  methods: {
    getFeed: 'member',
    findById: 'member',
    create: 'member',
    update: 'member',
    delete: 'member',
    adminRemove: 'member',
    close: 'member',
    ownerCompleteOffer: 'member',
    reopen: 'member',
    republish: 'member',
    unmrkRecipientSelf: 'member',
    getClosureCandidates: 'member',
    getMyPosts: 'member',
    getProfileClosedPosts: 'member',
    listPostActorIdentities: 'member',
    upsertPostActorIdentity: 'member',
    countOpenByUser: 'member',
    countProfilePostsForViewer: 'member',
    countProfileOpenPosts: 'member',
    countProfileClosedPosts: 'member',
  },
});

const savedPosts = definePort<ISavedPostsRepository>({
  name: 'savedPosts',
  create: (client) => new SupabaseSavedPostsRepository(adapterClient<typeof SupabaseSavedPostsRepository>(client)),
  methods: { savePost: 'member', unsavePost: 'member', isPostSaved: 'member', listSavedPosts: 'member' },
});

const chat = definePort<IChatRepository>({
  name: 'chat',
  create: (client) => new SupabaseChatRepository(adapterClient<typeof SupabaseChatRepository>(client)),
  methods: {
    getMyChats: 'member',
    findOrCreateChat: 'member',
    hideChatFromInbox: 'member',
    findById: 'member',
    getMessages: 'member',
    sendMessage: 'member',
    markRead: 'member',
    getUnreadTotal: 'member',
    getCounterpart: 'member',
    getOrCreateSupportThread: 'member',
    submitSupportIssue: 'member',
    hasSentAnyMessage: 'member',
  },
});

const reports = definePort<IReportRepository>({
  name: 'reports',
  create: (client) => new SupabaseReportRepository(adapterClient<typeof SupabaseReportRepository>(client)),
  methods: { submit: 'member' },
});

/** Every hosted port, in the order they were moved behind the gateway. */
export const HOSTED_PORTS: readonly PortDefinition[] = [users, posts, savedPosts, chat, reports];
