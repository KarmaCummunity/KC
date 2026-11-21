import {
  SupabaseChatRepository,
  SupabaseDeviceRepository,
  SupabaseImportTelemetryRepository,
  SupabaseModerationAdminRepository,
  SupabaseModerationQueueRepository,
  SupabaseNotificationInboxRepository,
  SupabasePostTranslationReader,
  SupabasePublicResearchRepository,
  SupabaseReportRepository,
  SupabaseReportsRepository,
  SupabaseSupportInboxRepository,
  SupabaseSurveyAdminRepository,
  SupabaseSurveyRepository,
  SupabaseTranslationCacheRepository,
  SupabaseUserActivityRepository,
  SupabaseWhatsAppLinkRepository,
} from '@kc/infrastructure-supabase';
import type { PortDefinition } from '../../../platform/ports/portDefinition';
import { adapterClient } from '../adapterClient';
import { hostedPort } from '../hostedPort';

const chat = hostedPort('chat', {
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

const device = hostedPort('device', {
  create: (client) => new SupabaseDeviceRepository(adapterClient<typeof SupabaseDeviceRepository>(client)),
  methods: {
    upsert: 'member',
    deactivate: 'member',
    listForUser: 'member',
  },
});

const importTelemetry = hostedPort('importTelemetry', {
  create: (client) => new SupabaseImportTelemetryRepository(adapterClient<typeof SupabaseImportTelemetryRepository>(client)),
  methods: {
    getFunnel: 'member',
    getFieldEditRates: 'member',
  },
});

const moderationAdmin = hostedPort('moderationAdmin', {
  create: (client) => new SupabaseModerationAdminRepository(adapterClient<typeof SupabaseModerationAdminRepository>(client)),
  methods: {
    getMyRoles: 'member',
    restoreTarget: 'member',
    dismissReport: 'member',
    confirmReport: 'member',
    banUser: 'member',
    deleteMessage: 'member',
    removeComment: 'member',
    auditLookup: 'member',
    isPlatformStaff: 'member',
  },
});

const moderationQueue = hostedPort('moderationQueue', {
  create: (client) => new SupabaseModerationQueueRepository(adapterClient<typeof SupabaseModerationQueueRepository>(client)),
  methods: {
    listOpen: 'member',
    assign: 'member',
    resolve: 'member',
  },
});

const notificationInbox = hostedPort('notificationInbox', {
  create: (client) => new SupabaseNotificationInboxRepository(adapterClient<typeof SupabaseNotificationInboxRepository>(client)),
  methods: {
    page: 'member',
    unreadCount: 'member',
    markRead: 'member',
    markAllRead: 'member',
  },
});

const postTranslationReader = hostedPort('postTranslationReader', {
  create: (client) => new SupabasePostTranslationReader(adapterClient<typeof SupabasePostTranslationReader>(client)),
  methods: {
    getForPosts: 'member',
  },
});

const publicResearch = hostedPort('publicResearch', {
  create: (client) => new SupabasePublicResearchRepository(adapterClient<typeof SupabasePublicResearchRepository>(client)),
  methods: {
    loadBundle: 'public',
    submit: 'not_served',
  },
});

const report = hostedPort('report', {
  create: (client) => new SupabaseReportRepository(adapterClient<typeof SupabaseReportRepository>(client)),
  methods: {
    submit: 'member',
  },
});

const reports = hostedPort('reports', {
  create: (client) => new SupabaseReportsRepository(adapterClient<typeof SupabaseReportsRepository>(client)),
  methods: {
    listOpenInbox: 'member',
    getCaseDetail: 'member',
  },
});

const supportInbox = hostedPort('supportInbox', {
  create: (client) => new SupabaseSupportInboxRepository(adapterClient<typeof SupabaseSupportInboxRepository>(client)),
  methods: {
    listThreads: 'member',
    joinThread: 'member',
    openMemberThread: 'member',
  },
});

const survey = hostedPort('survey', {
  create: (client) => new SupabaseSurveyRepository(adapterClient<typeof SupabaseSurveyRepository>(client)),
  methods: {
    listActive: 'member',
    getBundle: 'member',
    upsertAnswers: 'member',
    checkPromptEligibility: 'member',
    submitFreeFeedback: 'member',
  },
});

const surveyAdmin = hostedPort('surveyAdmin', {
  create: (client) => new SupabaseSurveyAdminRepository(adapterClient<typeof SupabaseSurveyAdminRepository>(client)),
  methods: {
    listOverview: 'member',
    getResults: 'member',
    getPmfReport: 'member',
    listFeedback: 'member',
  },
});

const translationCache = hostedPort('translationCache', {
  create: (client) => new SupabaseTranslationCacheRepository(adapterClient<typeof SupabaseTranslationCacheRepository>(client)),
  methods: {
    get: 'member',
    putIfAbsent: 'member',
    deleteForContent: 'member',
  },
});

const userActivity = hostedPort('userActivity', {
  create: (client) => new SupabaseUserActivityRepository(adapterClient<typeof SupabaseUserActivityRepository>(client)),
  methods: {
    recordActiveDay: 'member',
  },
});

const whatsAppLink = hostedPort('whatsAppLink', {
  create: (client) => new SupabaseWhatsAppLinkRepository(adapterClient<typeof SupabaseWhatsAppLinkRepository>(client)),
  methods: {
    getMyStatus: 'member',
    createLinkCode: 'member',
    unlink: 'member',
    setMatchConsent: 'member',
  },
});

export const CONVERSATIONS_PORTS: readonly PortDefinition[] = [chat, device, importTelemetry, moderationAdmin, moderationQueue, notificationInbox, postTranslationReader, publicResearch, report, reports, supportInbox, survey, surveyAdmin, translationCache, userActivity, whatsAppLink];
