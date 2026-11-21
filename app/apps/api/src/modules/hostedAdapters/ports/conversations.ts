import type {
  IChatRepository,
  IDeviceRepository,
  IImportTelemetryRepository,
  IModerationAdminRepository,
  IModerationQueueRepository,
  INotificationInboxRepository,
  IPostTranslationReader,
  IPublicResearchRepository,
  IReportRepository,
  IReportsRepository,
  ISupportInboxRepository,
  ISurveyAdminRepository,
  ISurveyRepository,
  ITranslationCacheRepository,
  IUserActivityRepository,
  IWhatsAppLinkRepository,
} from '@kc/application';
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
import { definePort, type PortDefinition } from '../../../platform/ports/portDefinition';
import { adapterClient } from '../adapterClient';

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

const device = definePort<IDeviceRepository>({
  name: 'device',
  create: (client) => new SupabaseDeviceRepository(adapterClient<typeof SupabaseDeviceRepository>(client)),
  methods: {
    upsert: 'member',
    deactivate: 'member',
    listForUser: 'member',
  },
});

const importTelemetry = definePort<IImportTelemetryRepository>({
  name: 'importTelemetry',
  create: (client) => new SupabaseImportTelemetryRepository(adapterClient<typeof SupabaseImportTelemetryRepository>(client)),
  methods: {
    getFunnel: 'member',
    getFieldEditRates: 'member',
  },
});

const moderationAdmin = definePort<IModerationAdminRepository>({
  name: 'moderationAdmin',
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

const moderationQueue = definePort<IModerationQueueRepository>({
  name: 'moderationQueue',
  create: (client) => new SupabaseModerationQueueRepository(adapterClient<typeof SupabaseModerationQueueRepository>(client)),
  methods: {
    listOpen: 'member',
    assign: 'member',
    resolve: 'member',
  },
});

const notificationInbox = definePort<INotificationInboxRepository>({
  name: 'notificationInbox',
  create: (client) => new SupabaseNotificationInboxRepository(adapterClient<typeof SupabaseNotificationInboxRepository>(client)),
  methods: {
    page: 'member',
    unreadCount: 'member',
    markRead: 'member',
    markAllRead: 'member',
  },
});

const postTranslationReader = definePort<IPostTranslationReader>({
  name: 'postTranslationReader',
  create: (client) => new SupabasePostTranslationReader(adapterClient<typeof SupabasePostTranslationReader>(client)),
  methods: {
    getForPosts: 'member',
  },
});

const publicResearch = definePort<IPublicResearchRepository>({
  name: 'publicResearch',
  create: (client) => new SupabasePublicResearchRepository(adapterClient<typeof SupabasePublicResearchRepository>(client)),
  methods: {
    loadBundle: 'public',
    submit: 'not_served',
  },
});

const report = definePort<IReportRepository>({
  name: 'report',
  create: (client) => new SupabaseReportRepository(adapterClient<typeof SupabaseReportRepository>(client)),
  methods: {
    submit: 'member',
  },
});

const reports = definePort<IReportsRepository>({
  name: 'reports',
  create: (client) => new SupabaseReportsRepository(adapterClient<typeof SupabaseReportsRepository>(client)),
  methods: {
    listOpenInbox: 'member',
    getCaseDetail: 'member',
  },
});

const supportInbox = definePort<ISupportInboxRepository>({
  name: 'supportInbox',
  create: (client) => new SupabaseSupportInboxRepository(adapterClient<typeof SupabaseSupportInboxRepository>(client)),
  methods: {
    listThreads: 'member',
    joinThread: 'member',
    openMemberThread: 'member',
  },
});

const survey = definePort<ISurveyRepository>({
  name: 'survey',
  create: (client) => new SupabaseSurveyRepository(adapterClient<typeof SupabaseSurveyRepository>(client)),
  methods: {
    listActive: 'member',
    getBundle: 'member',
    upsertAnswers: 'member',
    checkPromptEligibility: 'member',
    submitFreeFeedback: 'member',
  },
});

const surveyAdmin = definePort<ISurveyAdminRepository>({
  name: 'surveyAdmin',
  create: (client) => new SupabaseSurveyAdminRepository(adapterClient<typeof SupabaseSurveyAdminRepository>(client)),
  methods: {
    listOverview: 'member',
    getResults: 'member',
    getPmfReport: 'member',
    listFeedback: 'member',
  },
});

const translationCache = definePort<ITranslationCacheRepository>({
  name: 'translationCache',
  create: (client) => new SupabaseTranslationCacheRepository(adapterClient<typeof SupabaseTranslationCacheRepository>(client)),
  methods: {
    get: 'member',
    putIfAbsent: 'member',
    deleteForContent: 'member',
  },
});

const userActivity = definePort<IUserActivityRepository>({
  name: 'userActivity',
  create: (client) => new SupabaseUserActivityRepository(adapterClient<typeof SupabaseUserActivityRepository>(client)),
  methods: {
    recordActiveDay: 'member',
  },
});

const whatsAppLink = definePort<IWhatsAppLinkRepository>({
  name: 'whatsAppLink',
  create: (client) => new SupabaseWhatsAppLinkRepository(adapterClient<typeof SupabaseWhatsAppLinkRepository>(client)),
  methods: {
    getMyStatus: 'member',
    createLinkCode: 'member',
    unlink: 'member',
    setMatchConsent: 'member',
  },
});

export const CONVERSATIONS_PORTS: readonly PortDefinition[] = [chat, device, importTelemetry, moderationAdmin, moderationQueue, notificationInbox, postTranslationReader, publicResearch, report, reports, supportInbox, survey, surveyAdmin, translationCache, userActivity, whatsAppLink];
