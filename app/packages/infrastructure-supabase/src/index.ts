export { getSupabaseClient, resetSupabaseClient, setOnForbiddenCallback } from './client';
export type { SupabaseAuthStorage, SupabaseClientOptions } from './client';
export {
  createTimeoutFetch,
  DEFAULT_SUPABASE_TIMEOUT_MS,
  FetchTimeoutError,
  isTimeoutError,
} from './timeoutFetch';
export type { Database } from './database.types';

export { SupabaseAuthService } from './auth/SupabaseAuthService';
export { SupabaseUserRepository } from './users/SupabaseUserRepository';
export { SupabaseCityRepository } from './cities/SupabaseCityRepository';
export { SupabaseStreetRepository } from './streets/SupabaseStreetRepository';
export { SupabasePostRepository } from './posts/SupabasePostRepository';
export {
  SupabasePostEngagementRepository,
  type PostReactionType,
  type PostCommentWithAuthor,
} from './posts/SupabasePostEngagementRepository';
export { SupabaseSavedPostsRepository } from './posts/SupabaseSavedPostsRepository';
export { SupabaseNotificationInboxRepository } from './notifications/SupabaseNotificationInboxRepository';
export { SupabaseChatV2Realtime } from './chat/SupabaseChatV2Realtime';
export {
  SupabaseChatV2Repository,
  type MessageReactionType,
} from './chat/SupabaseChatV2Repository';
export { SupabaseChatRepository } from './chat/SupabaseChatRepository';
export {
  SupabaseSocialFeedRepository,
  type FeedMuteFilterKind,
  type FeedMuteFilterRow,
} from './feed/SupabaseSocialFeedRepository';
export {
  SupabaseFollowSuggestionsRepository,
  type FollowSuggestionRow,
  type ProfileCompleteness,
} from './social/SupabaseFollowSuggestionsRepository';
export { unwrapCall } from './rpc/mapRpcError';
export { SupabaseChatRealtime } from './chat/SupabaseChatRealtime';
export { SupabaseUserRealtime } from './users/SupabaseUserRealtime';
export { SupabaseFeedRealtime } from './feed/SupabaseFeedRealtime';
export { SupabaseOnlinePresence, ONLINE_PRESENCE_TOPIC } from './realtime/SupabaseOnlinePresence';
export { SupabaseActiveStatusRepository } from './users/SupabaseActiveStatusRepository';
export { SupabaseMatchRepository, mapMatchRow } from './matching/SupabaseMatchRepository';
export type {
  MatchSuggestion, MatchRole, MatchStatus, MatchResponse, MatchRespondResult, MatchQualityByWorld,
} from './matching/SupabaseMatchRepository';
export type { OnlineListener } from './realtime/SupabaseOnlinePresence';
export { SupabaseStatsRepository } from './stats/SupabaseStatsRepository';
export { SupabaseAboutRepository } from './about/SupabaseAboutRepository';
export { SupabaseReportRepository } from './reports/SupabaseReportRepository';
export { SupabaseBlockRepository } from './blocks/SupabaseBlockRepository';
export { SupabaseModerationAdminRepository } from './moderation/SupabaseModerationAdminRepository';
export { SupabaseSupportInboxRepository } from './moderation/SupabaseSupportInboxRepository';
export { SupabaseModerationQueueRepository } from './moderation/SupabaseModerationQueueRepository';
export { SupabaseAccountGateRepository } from './auth/SupabaseAccountGateRepository';
export { SupabaseDonationLinksRepository } from './donations/SupabaseDonationLinksRepository';
export { SupabaseWorldContentRepository } from './worlds/SupabaseWorldContentRepository';
export { SupabaseSearchRepository } from './search/SupabaseSearchRepository';
export { SupabaseDeviceRepository } from './notifications/SupabaseDeviceRepository';
export { SupabaseLegalDocumentRepository } from './legal/SupabaseLegalDocumentRepository';
export { LegalDocumentCache, type AsyncKVStorage } from './legal/legalCache';
export * from './admin/SupabaseAdminRoleRepository';
export * from './admin/SupabaseAdminTaskRepository';
export * from './admin/SupabaseAdminContentRepository';
export * from './admin/SupabaseTimesheetsRepository';
export * from './admin/SupabaseFinanceLedgerRepository';
export * from './admin/SupabaseFinanceAccountsRepository';
export * from './admin/SupabaseFinanceDonorsRepository';
export * from './admin/SupabaseOrgTransparencyRepository';
export * from './admin/SupabaseCrmContactsRepository';
export * from './admin/SupabaseOrgApplicationsRepository';
export * from './admin/SupabaseOrgHierarchyRepository';
export * from './reports/SupabaseReportsRepository';
export { SupabaseDriverDeclarationRepository } from './rides/SupabaseDriverDeclarationRepository';
export { SupabaseRidesRealtime } from './rides/SupabaseRidesRealtime';
export { SupabaseRideBookingRepository } from './rides/SupabaseRideBookingRepository';
export { SupabaseHousingRepository } from './housing/SupabaseHousingRepository';
export { SupabaseRidePlaceRepository } from './rides/SupabaseRidePlaceRepository';
export { SupabaseRidesFeedRepository } from './rides/SupabaseRidesFeedRepository';
export { SupabaseRideSavedRoutesRepository } from './rides/SupabaseRideSavedRoutesRepository';
export { SupabaseRideSeriesRepository } from './rides/SupabaseRideSeriesRepository';
export { SupabasePostSeriesRepository } from './series/SupabasePostSeriesRepository';
export { SupabaseRideHouseNumberRepository } from './rides/SupabaseRideHouseNumberRepository';
export { SupabaseRideSafetyRepository } from './rides/SupabaseRideSafetyRepository';
export { SupabaseSurveyRepository } from './survey/SupabaseSurveyRepository';
export { SupabaseSurveyAdminRepository } from './survey/SupabaseSurveyAdminRepository';
export { SupabaseUserActivityRepository } from './survey/SupabaseUserActivityRepository';
export { SupabasePublicResearchRepository } from './research/SupabasePublicResearchRepository';
export { SupabaseTranslationCacheRepository } from './translations/SupabaseTranslationCacheRepository';
export { EdgeFnTranslationService } from './translations/EdgeFnTranslationService';
export { SupabasePostTranslationReader } from './translations/SupabasePostTranslationReader';
export { SupabaseMarketplaceRepository } from './marketplace/SupabaseMarketplaceRepository';
export { SupabasePaymentsRepository } from './payments/SupabasePaymentsRepository';
export { SupabaseKcSupportChannelsRepository } from './payments/SupabaseKcSupportChannelsRepository';
export { SupabaseVolunteerRepository } from './volunteering/SupabaseVolunteerRepository';
export { SupabaseOrganizationsRepository } from './organizations/SupabaseOrganizationsRepository';
export { SupabaseChallengeRepository } from './challenges/SupabaseChallengeRepository';
export * from './admin/SupabaseWhatsAppAdminRepository';
export { SupabaseWhatsAppLinkRepository } from './whatsapp/SupabaseWhatsAppLinkRepository';
export { SupabaseKnowledgeTopicRepository } from './knowledge/SupabaseKnowledgeTopicRepository';
export { SupabaseKnowledgeBookingRepository } from './knowledge/SupabaseKnowledgeBookingRepository';
