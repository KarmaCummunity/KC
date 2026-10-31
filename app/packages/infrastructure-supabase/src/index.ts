export { getSupabaseClient, resetSupabaseClient, setOnForbiddenCallback } from './client';
export type { SupabaseAuthStorage } from './client';
export type { Database } from './database.types';

export { SupabaseAuthService } from './auth/SupabaseAuthService';
export { SupabaseUserRepository } from './users/SupabaseUserRepository';
export { SupabaseCityRepository } from './cities/SupabaseCityRepository';
export { SupabaseStreetRepository } from './streets/SupabaseStreetRepository';
export { SupabasePostRepository } from './posts/SupabasePostRepository';
export { SupabasePostEngagementRepository, type PostReactionType } from './posts/SupabasePostEngagementRepository';
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
export { SupabaseChatRealtime } from './chat/SupabaseChatRealtime';
export { SupabaseUserRealtime } from './users/SupabaseUserRealtime';
export { SupabaseFeedRealtime } from './feed/SupabaseFeedRealtime';
export { SupabaseOnlinePresence, ONLINE_PRESENCE_TOPIC } from './realtime/SupabaseOnlinePresence';
export { SupabaseActiveStatusRepository } from './users/SupabaseActiveStatusRepository';
export { SupabaseMatchRepository, mapMatchQualityRow, mapMatchRow } from './matching/SupabaseMatchRepository';
export type {
  MatchSuggestion, MatchRole, MatchStatus, MatchResponse, MatchRespondResult, MatchQualityByWorld,
} from './matching/SupabaseMatchRepository';
export type { OnlineListener } from './realtime/SupabaseOnlinePresence';
export { SupabaseStatsRepository } from './stats/SupabaseStatsRepository';
export { SupabaseAboutRepository } from './about/SupabaseAboutRepository';
export { SupabaseReportRepository } from './reports/SupabaseReportRepository';
export { SupabaseBlockRepository } from './blocks/SupabaseBlockRepository';
export { SupabaseModerationAdminRepository } from './moderation/SupabaseModerationAdminRepository';
export { SupabaseAccountGateRepository } from './auth/SupabaseAccountGateRepository';
export { SupabaseDonationLinksRepository } from './donations/SupabaseDonationLinksRepository';
export { SupabaseSearchRepository } from './search/SupabaseSearchRepository';
export { SupabaseDeviceRepository } from './notifications/SupabaseDeviceRepository';
export { SupabaseLegalDocumentRepository } from './legal/SupabaseLegalDocumentRepository';
export { LegalDocumentCache, type AsyncKVStorage } from './legal/legalCache';
export * from './admin/SupabaseAdminRoleRepository';
export * from './admin/SupabaseAdminTaskRepository';
export * from './admin/SupabaseAdminContentRepository';
export * from './admin/SupabaseTimesheetsRepository';
export * from './admin/SupabaseFinanceLedgerRepository';
export * from './admin/SupabaseCrmContactsRepository';
export * from './admin/SupabaseOrgApplicationsRepository';
export * from './admin/SupabaseOrgHierarchyRepository';
export * from './reports/SupabaseReportsRepository';
export { SupabaseRideListingRepository } from './rides/SupabaseRideListingRepository';
export { SupabaseRideParticipantRepository } from './rides/SupabaseRideParticipantRepository';
export { SupabaseRideTemplateRepository } from './rides/SupabaseRideTemplateRepository';
export { SupabaseRideStopsRepository } from './rides/SupabaseRideStopsRepository';
export { SupabaseRideEmergencyRepository } from './rides/SupabaseRideEmergencyRepository';
export { SupabaseRideRatingRepository } from './rides/SupabaseRideRatingRepository';
export { SupabaseDriverDeclarationRepository } from './rides/SupabaseDriverDeclarationRepository';
export { SupabaseRidesRealtime } from './rides/SupabaseRidesRealtime';
export { SupabaseSurveyRepository } from './survey/SupabaseSurveyRepository';
export { SupabaseSurveyAdminRepository } from './survey/SupabaseSurveyAdminRepository';
export { SupabaseUserActivityRepository } from './survey/SupabaseUserActivityRepository';
export { SupabasePublicResearchRepository } from './research/SupabasePublicResearchRepository';
export { SupabaseTranslationCacheRepository } from './translations/SupabaseTranslationCacheRepository';
export { EdgeFnTranslationService } from './translations/EdgeFnTranslationService';
export { SupabasePostTranslationReader } from './translations/SupabasePostTranslationReader';
export { SupabaseMarketplaceRepository } from './marketplace/SupabaseMarketplaceRepository';
export { SupabasePaymentsRepository } from './payments/SupabasePaymentsRepository';
export { SandboxPaymentProvider } from './payments/SandboxPaymentProvider';
export { SupabaseKcSupportChannelsRepository } from './payments/SupabaseKcSupportChannelsRepository';
export { SupabaseVolunteerRepository } from './volunteering/SupabaseVolunteerRepository';
export * from './admin/SupabaseWhatsAppAdminRepository';
