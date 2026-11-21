import {
  SupabaseAboutRepository,
  SupabaseDonationLinksRepository,
  SupabaseKcSupportChannelsRepository,
  SupabaseOrganizationsRepository,
  SupabasePaymentsRepository,
  SupabaseStatsRepository,
} from '@kc/infrastructure-supabase';
import type { PortDefinition } from '../../../platform/ports/portDefinition';
import { adapterClient } from '../adapterClient';
import { hostedPort } from '../hostedPort';

const about = hostedPort('about', {
  create: (client) => new SupabaseAboutRepository(adapterClient<typeof SupabaseAboutRepository>(client)),
  methods: {
    listTeamMembers: 'member',
  },
});

const donationLinks = hostedPort('donationLinks', {
  create: (client) => new SupabaseDonationLinksRepository(adapterClient<typeof SupabaseDonationLinksRepository>(client)),
  methods: {
    listByCategory: 'member',
    addViaEdgeFunction: 'not_served',
    updateViaEdgeFunction: 'not_served',
    deleteById: 'member',
    report: 'member',
    listForReview: 'member',
    review: 'member',
  },
});

const kcSupportChannels = hostedPort('kcSupportChannels', {
  create: (client) => new SupabaseKcSupportChannelsRepository(adapterClient<typeof SupabaseKcSupportChannelsRepository>(client)),
  methods: {
    listActiveChannels: 'public',
  },
  // A short list the super admin edits by hand.
  visitorCacheSeconds: { listActiveChannels: 300 },
});

const organizations = hostedPort('organizations', {
  create: (client) => new SupabaseOrganizationsRepository(adapterClient<typeof SupabaseOrganizationsRepository>(client)),
  methods: {
    submitApplication: 'member',
    getMyLatestApplication: 'member',
    listMyOrganizations: 'member',
    listMembers: 'member',
    addMember: 'member',
    removeMember: 'member',
  },
});

const payments = hostedPort('payments', {
  create: (client) => new SupabasePaymentsRepository(adapterClient<typeof SupabasePaymentsRepository>(client)),
  methods: {
    listVerifiedNonprofits: 'public',
    getNonprofitPublicPage: 'public',
    createDonationIntent: 'member',
    createStandingOrder: 'member',
    listMyStandingOrders: 'member',
    cancelStandingOrder: 'member',
    pauseStandingOrder: 'member',
    resumeStandingOrder: 'member',
    listDonationHistory: 'member',
    getDonationReceipt: 'member',
  },
  // The nonprofit directory and a nonprofit's public page.
  visitorCacheSeconds: { listVerifiedNonprofits: 300, getNonprofitPublicPage: 60 },
});

const stats = hostedPort('stats', {
  create: (client) => new SupabaseStatsRepository(adapterClient<typeof SupabaseStatsRepository>(client)),
  methods: {
    getActivePublicPostsCount: 'public',
    getCommunityStatsSnapshot: 'public',
    listMyActivityTimeline: 'member',
    getWorldFlowFunnel: 'member',
    listMyWorldGivings: 'member',
  },
  // Community totals: a minute-old number is still the number.
  visitorCacheSeconds: { getCommunityStatsSnapshot: 60, getActivePublicPostsCount: 60 },
});

export const ORGANIZATIONS_PORTS: readonly PortDefinition[] = [about, donationLinks, kcSupportChannels, organizations, payments, stats];
