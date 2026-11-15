export * from './ports/IUserRepository';
export * from './ports/IPostRepository';
export * from './ports/ISavedPostsRepository';
export * from './ports/postActorIdentity';
export * from './ports/IChatRepository';
export * from './ports/IAuthService';
export * from './ports/ICityRepository';
export * from './ports/IStreetRepository';
export type { ITranslationCacheRepository, CachedTranslation, TranslationCacheKey } from './ports/ITranslationCacheRepository';
export type { BatchTranslationItem, ITranslationService } from './ports/ITranslationService';
export type { IPostTranslationReader, PostTranslationHit } from './ports/IPostTranslationReader';
export type * from './ports/IMarketplaceRepository';
export * from './translations';
export type { IChatRealtime, InboxStreamCallbacks, InboxChange, SubscribeInboxOptions, ChatStreamCallbacks, ChatChange, Unsubscribe } from './ports/IChatRealtime';
export type { IReportRepository } from './ports/IReportRepository';
export type { IFeedRealtime, FeedRealtimeCallbacks, NewPublicPostSignal } from './ports/IFeedRealtime';
export type { AccountChange, IUserRealtime, StatsChange } from './ports/IUserRealtime';
export type { IRidesRealtime, RidesRealtimeCallbacks } from './ports/IRidesRealtime';
export type { CommunityStatsSnapshot, IStatsRepository, MyWorldGivings, WorldFlowFunnelRow } from './ports/IStatsRepository';
export type { IAboutRepository } from './ports/IAboutRepository';
export * from './auth';
export * from './feed/GetFeedUseCase';
export * from './feed/GetActivePostsCountUseCase';
export * from './feed/DismissFirstPostNudgeUseCase';
export * from './stats/GetCommunityStatsSnapshotUseCase';
export * from './stats/StatsByAudienceUseCases';
export * from './stats/ListMyActivityTimelineUseCase';
export * from './about/ListAboutTeamMembersUseCase';
export * from './posts/errors';
// Port contract tests (G39): run against fakes here and against adapters in infrastructure-supabase.
export * from './contracts';
export * from './posts/CreatePostUseCase';
export * from './posts/UpdatePostUseCase';
export * from './posts/GetPostByIdUseCase';
export * from './posts/GetMyPostsUseCase';
export * from './posts/GetProfileClosedPostsUseCase';
export * from './posts/SavePostUseCase';
export * from './posts/UnsavePostUseCase';
export * from './posts/IsPostSavedUseCase';
export * from './posts/ListSavedPostsUseCase';
export * from './posts/DeletePostUseCase';
export * from './posts/MarkAsDeliveredUseCase';
export * from './posts/OwnerCompleteOfferUseCase';
export * from './posts/ReopenPostUseCase';
export * from './posts/RepublishPostUseCase';
export * from './posts/UnmarkRecipientSelfUseCase';
export * from './posts/GetClosureCandidatesUseCase';
export { ListPostActorIdentityUseCase, type ListPostActorIdentityInput } from './posts/ListPostActorIdentityUseCase';
export { UpsertPostActorIdentityUseCase } from './posts/UpsertPostActorIdentityUseCase';
export * from './posts/AdminRemovePostUseCase';
export * from './posts/SearchUsersForClosureUseCase';

// Chat use cases
export { SendMessageUseCase } from './chat/SendMessageUseCase';
export type { SendMessageInput } from './chat/SendMessageUseCase';
export { HideChatFromInboxUseCase } from './chat/HideChatFromInboxUseCase';
export type { HideChatFromInboxInput } from './chat/HideChatFromInboxUseCase';
export { OpenOrCreateChatUseCase } from './chat/OpenOrCreateChatUseCase';
export type { OpenOrCreateChatInput } from './chat/OpenOrCreateChatUseCase';
export { ListChatsUseCase } from './chat/ListChatsUseCase';
export { MarkChatReadUseCase } from './chat/MarkChatReadUseCase';
export { GetUnreadTotalUseCase } from './chat/GetUnreadTotalUseCase';
export { GetSupportThreadUseCase } from './chat/GetSupportThreadUseCase';
export * from './chat/ListChatStartCandidatesUseCase';
export * from './chat/SubmitSupportIssueUseCase';
export { ChatError } from './chat/errors';
export type { ChatErrorCode } from './chat/errors';

// Report use cases
export { ReportChatUseCase } from './reports/ReportChatUseCase';
export type { ReportChatInput } from './reports/ReportChatUseCase';
export { ReportPostUseCase, type ReportPostInput } from './reports/ReportPostUseCase';
export * from './blocks';
export { ReportListingUseCase } from './reports/ReportListingUseCase';
export type { ReportListingInput } from './reports/ReportListingUseCase';
export { ReportError } from './reports/errors';
export type { ReportErrorCode } from './reports/errors';

// Donation link use cases
export type {
  IDonationLinksRepository,
  AddDonationLinkInput,
  UpdateDonationLinkInput,
  DonationLinkReviewItem,
} from './ports/IDonationLinksRepository';
export * from './donations/ReviewDonationLinksUseCases'; // D9 review queue + decision
export { ListDonationLinksUseCase } from './donations/ListDonationLinksUseCase';
export { GetWorldContentUseCase } from './worlds/GetWorldContentUseCase';
export type { IWorldContentRepository } from './ports/IWorldContentRepository';
export { AddDonationLinkUseCase } from './donations/AddDonationLinkUseCase';
export { UpdateDonationLinkUseCase } from './donations/UpdateDonationLinkUseCase';
export { RemoveDonationLinkUseCase } from './donations/RemoveDonationLinkUseCase';
export { ReportDonationLinkUseCase } from './donations/ReportDonationLinkUseCase';
export type { ReportDonationLinkInput } from './donations/ReportDonationLinkUseCase';
export { DonationLinkError, isDonationLinkError } from './donations/errors';
export type { DonationLinkErrorCode } from './donations/errors';

// Follow use cases (P1.1)
export * from './follow/errors';
export * from './follow/types';
export * from './follow/FollowUserUseCase';
export * from './follow/UnfollowUserUseCase';
export * from './follow/SendFollowRequestUseCase';
export * from './follow/CancelFollowRequestUseCase';
export * from './follow/AcceptFollowRequestUseCase';
export * from './follow/RejectFollowRequestUseCase';
export * from './follow/RemoveFollowerUseCase';
export * from './follow/ListFollowersUseCase';
export * from './follow/ListFollowingUseCase';
export * from './follow/ListPendingFollowRequestsUseCase';
export * from './follow/GetFollowStateUseCase';
export * from './follow/UpdatePrivacyModeUseCase';

// Search use cases
export type { ISearchRepository, UniversalSearchResults } from './ports/ISearchRepository';
export { UniversalSearchUseCase } from './search/UniversalSearchUseCase';
export type { UniversalSearchInput } from './search/UniversalSearchUseCase';

export * from './ports/IModerationAdminRepository';
export * from './ports/IAccountGateRepository';
export * from './moderation/errors';

// Moderation admin use cases (FR-MOD-007 + FR-ADMIN-002..007)
export { RestoreTargetUseCase, type RestoreTargetInput } from './moderation/RestoreTargetUseCase';
export { DismissReportUseCase, type DismissReportInput } from './moderation/DismissReportUseCase';
export { ConfirmReportUseCase, type ConfirmReportInput } from './moderation/ConfirmReportUseCase';
export { BanUserUseCase, type BanUserInput } from './moderation/BanUserUseCase';
export { DeleteMessageUseCase } from './moderation/DeleteMessageUseCase';
export type { DeleteMessageInput } from './moderation/DeleteMessageUseCase';
export { LookupAuditUseCase } from './moderation/LookupAuditUseCase';
export type { LookupAuditInput } from './moderation/LookupAuditUseCase';
export { RemoveCommentUseCase, type RemoveCommentInput } from './moderation/RemoveCommentUseCase';
export * from './moderation/ISupportInboxRepository';
export {
  ListSupportThreadsUseCase, JoinSupportThreadUseCase, OpenMemberSupportThreadUseCase, SUPPORT_INBOX_PAGE_SIZE,
} from './moderation/SupportInboxUseCases';
export * from './moderation/IModerationQueueRepository';
export {
  ListModerationQueueUseCase, AssignQueueEntryUseCase, ResolveQueueEntryUseCase, MODERATION_QUEUE_PAGE_SIZE,
} from './moderation/ModerationQueueUseCases';
export { ReportUserUseCase } from './moderation/ReportUserUseCase';
export type { ReportUserInput } from './moderation/ReportUserUseCase';
export { CheckAccountGateUseCase } from './moderation/CheckAccountGateUseCase';
export type { CheckAccountGateInput } from './moderation/CheckAccountGateUseCase';
export { RestoreAccountUseCase } from './moderation/RestoreAccountUseCase';
export type { IDeviceRepository } from './notifications/IDeviceRepository';
export type * from './notifications/INotificationInboxRepository';
export { RegisterDeviceUseCase } from './notifications/RegisterDeviceUseCase';
export { DeactivateDeviceUseCase } from './notifications/DeactivateDeviceUseCase';
export { UpdateNotificationPreferencesUseCase } from './notifications/UpdateNotificationPreferencesUseCase';
export { applyNotificationPreferencesPatch } from './notifications/applyNotificationPreferencesPatch';
export * from './ports/ILegalDocumentRepository';
export * from './legal/LoadLegalDocumentUseCase';
export * from './legal/CheckPendingLegalAcksUseCase';
export * from './legal/AcceptLegalDocumentUseCase';
export * from './admin/IAdminRoleRepository';
export * from './admin/GetMyAdminRolesUseCase';
export * from './admin/GrantAdminRoleUseCase';
export * from './admin/RevokeAdminRoleUseCase';
export * from './admin/ChangeAdminRoleUseCase';
export * from './admin/ListAdminsUseCase';
export * from './admin/IAdminTaskRepository';
export * from './admin/ListAdminTasksUseCase';
export * from './admin/GetAdminTaskDetailUseCase';
export * from './admin/CreateAdminTaskUseCase';
export * from './admin/UpdateAdminTaskUseCase';
export * from './admin/SetAdminTaskStatusUseCase';
export * from './admin/AssignAdminTaskUseCase';
export * from './admin/AddAdminTaskCommentUseCase';
export * from './admin/DeleteAdminTaskUseCase';
export * from './admin/IAdminContentRepository';
export * from './admin/AdminSearchUsersUseCase';
export * from './admin/AdminFindMembersUseCase';
export * from './admin/AdminSearchPostsUseCase';
export * from './admin/AdminSearchAuditUseCase';
export * from './admin/ITimesheetsRepository';
export * from './admin/TimesheetUseCases';
export * from './admin/finance';
export * from './admin/ICrmContactsRepository';
export * from './admin/ListCrmContactsUseCase';
export * from './admin/UpsertCrmContactUseCase';
export * from './admin/DeleteCrmContactUseCase';
export * from './admin/MarkCrmContactContactedUseCase';
export * from './admin/IOrgApplicationsRepository';
export * from './admin/ListOrgApplicationsUseCase';
export * from './admin/DecideOrgApplicationUseCase';
export * from './admin/IOrgHierarchyRepository';
export * from './admin/GetOrgTreeUseCase';
export * from './admin/SetManagerUseCase';
export * from './admin/SetOrgSlugUseCase';
export * from './admin/GetHierarchySnapshotUseCase';

// A1 — admin reports inbox & case detail
export * from './reports/IReportsRepository';
export * from './reports/ListOpenReportsUseCase';
export * from './reports/GetReportCaseDetailUseCase';

// Driver declaration gate (FR-RIDE-041)
export type {
  DriverDeclaration,
  IDriverDeclarationRepository,
} from './ports/IDriverDeclarationRepository';
export { AcceptDriverDeclarationUseCase } from './rides/AcceptDriverDeclarationUseCase';
export { GetDriverDeclarationUseCase } from './rides/GetDriverDeclarationUseCase';

// Survey use cases (FR-SETTINGS-015..017)
export type { ISurveyRepository } from './ports/ISurveyRepository';
export { LoadSurveyBundleUseCase } from './survey/LoadSurveyBundleUseCase';
export type { LoadSurveyBundleInput } from './survey/LoadSurveyBundleUseCase';
export { SaveSurveyAnswersUseCase } from './survey/SaveSurveyAnswersUseCase';
export type { SaveSurveyAnswersInput } from './survey/SaveSurveyAnswersUseCase';
export { ListActiveSurveysUseCase } from './survey/ListActiveSurveysUseCase';
export { CheckSurveyPromptUseCase } from './survey/CheckSurveyPromptUseCase';
export type { CheckSurveyPromptInput } from './survey/CheckSurveyPromptUseCase';
export { SubmitFreeFeedbackUseCase } from './survey/SubmitFreeFeedbackUseCase';
export type { SubmitFreeFeedbackInput } from './survey/SubmitFreeFeedbackUseCase';
export type { ISurveyAdminRepository } from './ports/ISurveyAdminRepository';
export { GetAdminSurveyOverviewUseCase } from './survey/GetAdminSurveyOverviewUseCase';
export { GetAdminSurveyResultsUseCase } from './survey/GetAdminSurveyResultsUseCase';
export { ListUserFeedbackUseCase } from './survey/ListUserFeedbackUseCase';
export { GetPmfSurveyReportUseCase } from './survey/GetPmfSurveyReportUseCase';
export type { PmfSurveyReportView } from './survey/GetPmfSurveyReportUseCase';
// Server-side activity days (KC#1058)
export type { IUserActivityRepository } from './ports/IUserActivityRepository';
export { RecordActiveDayUseCase } from './activity/RecordActiveDayUseCase';
export type { IPublicResearchRepository } from './ports/IPublicResearchRepository';
export { LoadPublicResearchBundleUseCase } from './research/LoadPublicResearchBundleUseCase';
export { SubmitPublicResearchResponseUseCase } from './research/SubmitPublicResearchResponseUseCase';
export * from './payments';
export * from './volunteering';
export * from './organizations';
export * from './series';
export * from './giving';
export * from './housing';
export * from './admin/whatsapp';
export * from './whatsapp/IWhatsAppLinkRepository';
export * from './whatsapp/WhatsAppLinkUseCases';
export * from './challenges';
export * from './knowledge';
