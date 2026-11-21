import type {
  IChallengeRepository,
  IGuestPostsRepository,
  IHousingRepository,
  IKnowledgeBookingRepository,
  IKnowledgeSlotSeriesRepository,
  IKnowledgeTopicRepository,
  IListingStreetAddressRepository,
  IMarketplaceRepository,
  IPostRepository,
  IPostSeriesRepository,
  ISavedPostsRepository,
  ISearchRepository,
  IVolunteerRepository,
  IWorldContentRepository,
} from '@kc/application';
import {
  SupabaseChallengeRepository,
  SupabaseGuestPostsRepository,
  SupabaseHousingRepository,
  SupabaseKnowledgeBookingRepository,
  SupabaseKnowledgeSlotSeriesRepository,
  SupabaseKnowledgeTopicRepository,
  SupabaseListingStreetAddressRepository,
  SupabaseMarketplaceRepository,
  SupabasePostRepository,
  SupabasePostSeriesRepository,
  SupabaseSavedPostsRepository,
  SupabaseSearchRepository,
  SupabaseVolunteerRepository,
  SupabaseWorldContentRepository,
} from '@kc/infrastructure-supabase';
import { definePort, type PortDefinition } from '../../../platform/ports/portDefinition';
import { adapterClient } from '../adapterClient';

const challenge = definePort<IChallengeRepository>({
  name: 'challenge',
  create: (client) => new SupabaseChallengeRepository(adapterClient<typeof SupabaseChallengeRepository>(client)),
  methods: {
    createChallenge: 'member',
    listChallenges: 'member',
    getChallenge: 'member',
    joinChallenge: 'member',
    leaveChallenge: 'member',
    endChallenge: 'member',
    reportProgress: 'member',
    listMyEntries: 'member',
    listLeaderboard: 'member',
  },
});

const guestPosts = definePort<IGuestPostsRepository>({
  name: 'guestPosts',
  create: (client) => new SupabaseGuestPostsRepository(adapterClient<typeof SupabaseGuestPostsRepository>(client)),
  methods: {
    list: 'public',
    get: 'public',
  },
});

const housing = definePort<IHousingRepository>({
  name: 'housing',
  create: (client) => new SupabaseHousingRepository(adapterClient<typeof SupabaseHousingRepository>(client)),
  methods: {
    currentConductVersion: 'member',
    hasAcceptedConduct: 'member',
    acceptConduct: 'member',
    requestStay: 'member',
    decide: 'member',
    cancel: 'member',
    complete: 'member',
    markNoShow: 'member',
    listForOffer: 'member',
    listMyStays: 'member',
    getPrivateDetails: 'member',
    setPrivateDetails: 'member',
  },
});

const knowledgeBooking = definePort<IKnowledgeBookingRepository>({
  name: 'knowledgeBooking',
  create: (client) => new SupabaseKnowledgeBookingRepository(adapterClient<typeof SupabaseKnowledgeBookingRepository>(client)),
  methods: {
    listSlots: 'member',
    bookSeat: 'member',
    listBookings: 'member',
    confirm: 'member',
    decline: 'member',
    completeSession: 'member',
  },
});

const knowledgeSlotSeries = definePort<IKnowledgeSlotSeriesRepository>({
  name: 'knowledgeSlotSeries',
  create: (client) => new SupabaseKnowledgeSlotSeriesRepository(adapterClient<typeof SupabaseKnowledgeSlotSeriesRepository>(client)),
  methods: {
    getForPost: 'member',
    setStatus: 'member',
  },
});

const knowledgeTopic = definePort<IKnowledgeTopicRepository>({
  name: 'knowledgeTopic',
  create: () => new SupabaseKnowledgeTopicRepository(),
  methods: {
    listTopics: 'member',
    resolveTopics: 'member',
    proposeTopic: 'member',
    updateMyProposal: 'member',
    reviewTopic: 'member',
    listFollowedTopicIds: 'member',
    setTopicFollowed: 'member',
  },
});

const listingStreetAddress = definePort<IListingStreetAddressRepository>({
  name: 'listingStreetAddress',
  create: (client) => new SupabaseListingStreetAddressRepository(adapterClient<typeof SupabaseListingStreetAddressRepository>(client)),
  methods: {
    save: 'member',
    getOwn: 'member',
  },
});

const marketplace = definePort<IMarketplaceRepository>({
  name: 'marketplace',
  create: (client) => new SupabaseMarketplaceRepository(adapterClient<typeof SupabaseMarketplaceRepository>(client)),
  methods: {
    getListingDetail: 'member',
    similarListings: 'member',
    listKindsForWorld: 'member',
    listWorldSubcategories: 'member',
    searchExternalBodies: 'member',
    createListing: 'member',
    startChat: 'member',
    listMyListingsPage: 'member',
    listProfileListings: 'member',
    updateMyListing: 'member',
    pauseMyListing: 'member',
    resumeMyListing: 'member',
    fulfillMyListing: 'member',
    deleteMyListing: 'member',
    addMyListingMedia: 'member',
    getListingHandoff: 'member',
    listMyGivingHandoffs: 'member',
    reserveItemGiving: 'member',
    confirmItemHandoff: 'member',
    claimFoodGiving: 'member',
    cancelGivingHandoff: 'member',
    markGivingHandedOver: 'member',
    rateGivingHandoff: 'member',
    registerForEvent: 'member',
    decideEventRegistration: 'member',
    cancelEventRegistration: 'member',
    listEventRegistrations: 'member',
    markEventAttendance: 'member',
    getMyEventRegistration: 'member',
    listMyOrganizations: 'member',
    messageEventRegistrants: 'member',
  },
});

const post = definePort<IPostRepository>({
  name: 'post',
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
    republish: 'not_served',
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

const postSeries = definePort<IPostSeriesRepository>({
  name: 'postSeries',
  create: (client) => new SupabasePostSeriesRepository(adapterClient<typeof SupabasePostSeriesRepository>(client)),
  methods: {
    listMine: 'member',
    create: 'member',
    update: 'member',
    setStatus: 'member',
    cancelOccurrence: 'member',
    listOccurrences: 'member',
  },
});

const savedPosts = definePort<ISavedPostsRepository>({
  name: 'savedPosts',
  create: (client) => new SupabaseSavedPostsRepository(adapterClient<typeof SupabaseSavedPostsRepository>(client)),
  methods: {
    savePost: 'member',
    unsavePost: 'member',
    isPostSaved: 'member',
    listSavedPosts: 'member',
  },
});

const search = definePort<ISearchRepository>({
  name: 'search',
  create: (client) => new SupabaseSearchRepository(adapterClient<typeof SupabaseSearchRepository>(client)),
  methods: {
    search: 'member',
  },
});

const volunteer = definePort<IVolunteerRepository>({
  name: 'volunteer',
  create: (client) => new SupabaseVolunteerRepository(adapterClient<typeof SupabaseVolunteerRepository>(client)),
  methods: {
    listOpportunities: 'member',
    getOpportunityDetail: 'member',
    signUpForShift: 'member',
    cancelSignup: 'member',
    listMySignups: 'member',
    closeOpportunity: 'member',
    listMyOrganizerOpportunities: 'member',
    listShiftVolunteers: 'member',
    messageShiftVolunteers: 'member',
  },
});

const worldContent = definePort<IWorldContentRepository>({
  name: 'worldContent',
  create: (client) => new SupabaseWorldContentRepository(adapterClient<typeof SupabaseWorldContentRepository>(client)),
  methods: {
    getWorldContent: 'public',
  },
});

export const POSTS_PORTS: readonly PortDefinition[] = [challenge, guestPosts, housing, knowledgeBooking, knowledgeSlotSeries, knowledgeTopic, listingStreetAddress, marketplace, post, postSeries, savedPosts, search, volunteer, worldContent];
