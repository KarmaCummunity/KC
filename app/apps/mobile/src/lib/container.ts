// Composition root — singleton instances of all chat use cases bound to Supabase adapters.
// Screens import the use cases from here, not from @kc/application directly.
// Mapped to SRS: FR-CHAT-001..013, FR-POST-010, FR-POST-014 AC4, FR-POST-015 AC1, FR-MOD-001, FR-MOD-007, FR-ADMIN-009.
import { createWhatsAppAdminUseCases } from './whatsappAdminContainer';
import { pickAuthStorage } from '../services/authSecureStorage';
import {
  getSupabaseClient,
  SupabaseUserRepository,
  SupabaseChatRepository,
  SupabaseChatRealtime,
  SupabaseReportRepository,
  SupabaseBlockRepository,
  SupabaseDonationLinksRepository,
  SupabasePostRepository,
  SupabasePostEngagementRepository,
  SupabaseNotificationInboxRepository,
  SupabaseChatV2Realtime,
  SupabaseOnlinePresence,
  SupabaseActiveStatusRepository,
  SupabaseChatV2Repository,
  SupabaseSocialFeedRepository,
  SupabaseFollowSuggestionsRepository,
  SupabaseModerationAdminRepository,
  SupabaseAccountGateRepository,
  SupabaseDeviceRepository,
  SupabaseAdminRoleRepository,
  SupabaseAdminTaskRepository,
  SupabaseOrgHierarchyRepository,
  SupabaseOrgApplicationsRepository,
  SupabaseAdminContentRepository,
  SupabaseTimesheetsRepository,
  SupabaseCrmContactsRepository,
  SupabaseReportsRepository,
  SupabaseSurveyRepository,
  SupabaseSurveyAdminRepository,
  SupabaseUserActivityRepository,
  SupabasePublicResearchRepository,
} from '@kc/infrastructure-supabase';
import {
  CheckAccountGateUseCase,
  RestoreAccountUseCase,
  ListChatsUseCase,
  OpenOrCreateChatUseCase,
  ListChatStartCandidatesUseCase,
  HideChatFromInboxUseCase,
  SendMessageUseCase,
  MarkChatReadUseCase,
  GetUnreadTotalUseCase,
  GetSupportThreadUseCase,
  SubmitSupportIssueUseCase,
  ReportChatUseCase,
  ReportPostUseCase,
  SetUserBlockedUseCase,
  ListMyBlockedUsersUseCase,
  ReportListingUseCase,
  DeletePostUseCase,
  AdminRemovePostUseCase,
  ListDonationLinksUseCase,
  AddDonationLinkUseCase,
  RemoveDonationLinkUseCase,
  ReportDonationLinkUseCase,
  ListDonationLinksForReviewUseCase,
  ReviewDonationLinkUseCase,
  UpdateDonationLinkUseCase,
  RestoreTargetUseCase,
  DismissReportUseCase,
  ConfirmReportUseCase,
  BanUserUseCase,
  DeleteMessageUseCase,
  LookupAuditUseCase,
  ReportUserUseCase,
  UpdateNotificationPreferencesUseCase,
  GetMyAdminRolesUseCase,
  GrantAdminRoleUseCase,
  RevokeAdminRoleUseCase,
  ChangeAdminRoleUseCase,
  ListAdminsUseCase,
  GetOrgTreeUseCase,
  GetHierarchySnapshotUseCase,
  SetManagerUseCase,
  SetOrgSlugUseCase,
  ListAdminTasksUseCase,
  CountOpenAdminTasksUseCase,
  GetAdminTaskDetailUseCase,
  CreateAdminTaskUseCase,
  UpdateAdminTaskUseCase,
  SetAdminTaskStatusUseCase,
  AssignAdminTaskUseCase,
  AddAdminTaskCommentUseCase,
  DeleteAdminTaskUseCase,
  ListOrgApplicationsUseCase,
  DecideOrgApplicationUseCase,
  AdminSearchUsersUseCase,
  AdminFindMembersUseCase,
  AdminSearchPostsUseCase,
  AdminSearchAuditUseCase,
  ListTimesheetsUseCase,
  UpsertTimesheetUseCase,
  SubmitTimesheetUseCase,
  ApproveTimesheetUseCase,
  RejectTimesheetUseCase,
  DeleteTimesheetUseCase,
  ListCrmContactsUseCase,
  ListCrmOrgsUseCase,
  UpsertCrmContactUseCase,
  DeleteCrmContactUseCase,
  MarkCrmContactContactedUseCase,
  ListOpenReportsUseCase,
  GetReportCaseDetailUseCase,
  ListActiveSurveysUseCase,
  LoadSurveyBundleUseCase,
  SaveSurveyAnswersUseCase,
  CheckSurveyPromptUseCase,
  SubmitFreeFeedbackUseCase,
  GetAdminSurveyOverviewUseCase,
  GetAdminSurveyResultsUseCase,
  GetPmfSurveyReportUseCase,
  RecordActiveDayUseCase,
  ListUserFeedbackUseCase,
  LoadPublicResearchBundleUseCase,
  SubmitPublicResearchResponseUseCase,
} from '@kc/application';
import { createFinanceUseCases } from './financeContainer';
import { isSupabaseConfigured } from './supabasePublicConfig';
import { bindSupabaseClient } from './bindSupabaseClient';

// The one Supabase connection of the app, typed against the production baseline schema.
export const supabase = bindSupabaseClient(isSupabaseConfigured(), () =>
  getSupabaseClient({ storage: pickAuthStorage() }),
);

const userRepo = new SupabaseUserRepository(supabase);
const chatRepo = new SupabaseChatRepository(supabase);
const chatRealtime = new SupabaseChatRealtime(supabase);
const reportRepo = new SupabaseReportRepository(supabase);
const blockRepo = new SupabaseBlockRepository(supabase);
const donationLinksRepo = new SupabaseDonationLinksRepository(supabase);
const postRepo = new SupabasePostRepository(supabase);
const postEngagementRepo = new SupabasePostEngagementRepository(supabase);
const notificationInboxRepo = new SupabaseNotificationInboxRepository(supabase);
const chatV2Realtime = new SupabaseChatV2Realtime(supabase);
const onlinePresence = new SupabaseOnlinePresence(supabase);
const activeStatus = new SupabaseActiveStatusRepository(supabase);
const chatV2Repo = new SupabaseChatV2Repository(supabase);
const socialFeedRepo = new SupabaseSocialFeedRepository(supabase);
const followSuggestionsRepo = new SupabaseFollowSuggestionsRepository(supabase);
const moderationAdminRepo = new SupabaseModerationAdminRepository(supabase);
const accountGateRepo = new SupabaseAccountGateRepository(supabase);
const deviceRepo = new SupabaseDeviceRepository(supabase);
const adminRoleRepo = new SupabaseAdminRoleRepository(supabase);
const adminTaskRepo = new SupabaseAdminTaskRepository(supabase);
const orgHierarchyRepo = new SupabaseOrgHierarchyRepository(supabase);
const adminContentRepo = new SupabaseAdminContentRepository(supabase);
const timesheetsRepo = new SupabaseTimesheetsRepository(supabase);
const crmContactsRepo = new SupabaseCrmContactsRepository(supabase);
const orgApplicationsRepo = new SupabaseOrgApplicationsRepository(supabase);
const reportsRepo = new SupabaseReportsRepository(supabase);
const surveyRepo = new SupabaseSurveyRepository(supabase);
const surveyAdminRepo = new SupabaseSurveyAdminRepository(supabase);
const userActivityRepo = new SupabaseUserActivityRepository(supabase);
const publicResearchRepo = new SupabasePublicResearchRepository(supabase);

const hideChatFromInbox = new HideChatFromInboxUseCase(chatRepo);
const getMyAdminRoles = new GetMyAdminRolesUseCase(adminRoleRepo);
const listOpenReports = new ListOpenReportsUseCase(reportsRepo);
const getReportCaseDetail = new GetReportCaseDetailUseCase(reportsRepo);

export const container = {
  // Repos / realtime — exposed for chatStore subscription wiring.
  userRepo,
  chatRepo,
  chatRealtime,
  chatV2Realtime,
  onlinePresence,
  activeStatus,
  chatV2Repo,
  socialFeed: socialFeedRepo,
  followSuggestions: followSuggestionsRepo,
  postEngagement: postEngagementRepo,
  notificationInbox: notificationInboxRepo,
  moderationAdminRepo,
  deviceRepo,
  adminRoleRepo,
  reportsRepo,

  // Admin portal (FR-ADMIN-011..018)
  getMyAdminRoles,
  listOpenReports,
  getReportCaseDetail,
  listAdmins: new ListAdminsUseCase(adminRoleRepo),
  grantAdminRole: new GrantAdminRoleUseCase(adminRoleRepo),
  revokeAdminRole: new RevokeAdminRoleUseCase(adminRoleRepo),
  changeAdminRole: new ChangeAdminRoleUseCase(adminRoleRepo),
  getOrgTree: new GetOrgTreeUseCase(orgHierarchyRepo),
  getHierarchySnapshot: new GetHierarchySnapshotUseCase(orgHierarchyRepo),
  setManager: new SetManagerUseCase(orgHierarchyRepo, adminRoleRepo),
  setOrgSlug: new SetOrgSlugUseCase(orgHierarchyRepo),
  listAdminTasks: new ListAdminTasksUseCase(adminTaskRepo),
  countOpenAdminTasks: new CountOpenAdminTasksUseCase(adminTaskRepo),
  getAdminTaskDetail: new GetAdminTaskDetailUseCase(adminTaskRepo),
  createAdminTask: new CreateAdminTaskUseCase(adminTaskRepo),
  updateAdminTask: new UpdateAdminTaskUseCase(adminTaskRepo),
  setAdminTaskStatus: new SetAdminTaskStatusUseCase(adminTaskRepo),
  assignAdminTask: new AssignAdminTaskUseCase(adminTaskRepo),
  addAdminTaskComment: new AddAdminTaskCommentUseCase(adminTaskRepo),
  deleteAdminTask: new DeleteAdminTaskUseCase(adminTaskRepo),
  adminSearchUsers: new AdminSearchUsersUseCase(adminContentRepo),
  adminFindMembers: new AdminFindMembersUseCase(adminContentRepo),
  adminSearchPosts: new AdminSearchPostsUseCase(adminContentRepo),
  adminSearchAudit: new AdminSearchAuditUseCase(adminContentRepo),
  // FR-ADMIN-033
  listTimesheets:   new ListTimesheetsUseCase(timesheetsRepo),
  upsertTimesheet:  new UpsertTimesheetUseCase(timesheetsRepo),
  submitTimesheet:  new SubmitTimesheetUseCase(timesheetsRepo),
  approveTimesheet: new ApproveTimesheetUseCase(timesheetsRepo),
  rejectTimesheet:  new RejectTimesheetUseCase(timesheetsRepo),
  deleteTimesheet:  new DeleteTimesheetUseCase(timesheetsRepo),
  // V2-ADMIN-MONEY-9 (+ accounts, donors, public display: FR-FIN-003/022/023)
  ...createFinanceUseCases(supabase),
  ...createWhatsAppAdminUseCases(),
  // FR-ADMIN-032
  listCrmOrgs: new ListCrmOrgsUseCase(crmContactsRepo),
  listCrmContacts: new ListCrmContactsUseCase(crmContactsRepo),
  upsertCrmContact: new UpsertCrmContactUseCase(crmContactsRepo),
  deleteCrmContact: new DeleteCrmContactUseCase(crmContactsRepo),
  markCrmContactContacted: new MarkCrmContactContactedUseCase(crmContactsRepo),
  // V2-ADMIN-ORG-7
  listOrgApplications: new ListOrgApplicationsUseCase(orgApplicationsRepo),
  decideOrgApplication: new DecideOrgApplicationUseCase(orgApplicationsRepo),

  // Notification preferences
  updateNotificationPreferences: new UpdateNotificationPreferencesUseCase(userRepo),

  // Chat use cases
  listChats: new ListChatsUseCase(chatRepo),
  openOrCreateChat: new OpenOrCreateChatUseCase(chatRepo),
  listChatStartCandidates: new ListChatStartCandidatesUseCase(userRepo, blockRepo),
  hideChatFromInbox,
  sendMessage: new SendMessageUseCase(chatRepo),
  markChatRead: new MarkChatReadUseCase(chatRepo),
  getUnreadTotal: new GetUnreadTotalUseCase(chatRepo),
  getSupportThread: new GetSupportThreadUseCase(chatRepo),
  submitSupportIssue: new SubmitSupportIssueUseCase(chatRepo),

  // Reports
  reportChat: new ReportChatUseCase(reportRepo),
  reportPost: new ReportPostUseCase(reportRepo),
  blockRepo,
  setUserBlocked: new SetUserBlockedUseCase(blockRepo),
  listMyBlockedUsers: new ListMyBlockedUsersUseCase(blockRepo),
  reportListing: new ReportListingUseCase(reportRepo),

  // Post moderation
  deletePost: new DeletePostUseCase(postRepo),
  adminRemovePost: new AdminRemovePostUseCase(postRepo),

  // Moderation admin actions (FR-MOD-007 + FR-ADMIN-002..007)
  restoreTarget: new RestoreTargetUseCase(moderationAdminRepo),
  dismissReport: new DismissReportUseCase(moderationAdminRepo),
  confirmReport: new ConfirmReportUseCase(moderationAdminRepo),
  banUser: new BanUserUseCase(moderationAdminRepo),
  deleteMessage: new DeleteMessageUseCase(moderationAdminRepo),
  lookupAudit: new LookupAuditUseCase(moderationAdminRepo),
  reportUser: new ReportUserUseCase(reportRepo),

  // FR-MOD-010 — sign-in + mid-session account gate.
  checkAccountGate: new CheckAccountGateUseCase(accountGateRepo),
  // FR-AUTH-016 — restore a deleted account within its 30-day grace period.
  restoreAccount: new RestoreAccountUseCase(accountGateRepo),

  // Donation links
  listDonationLinks: new ListDonationLinksUseCase(donationLinksRepo),
  addDonationLink: new AddDonationLinkUseCase(donationLinksRepo),
  updateDonationLink: new UpdateDonationLinkUseCase(donationLinksRepo),
  removeDonationLink: new RemoveDonationLinkUseCase(donationLinksRepo),
  reportDonationLink: new ReportDonationLinkUseCase(donationLinksRepo),
  listDonationLinksForReview: new ListDonationLinksForReviewUseCase(donationLinksRepo),
  reviewDonationLink: new ReviewDonationLinkUseCase(donationLinksRepo),

  // Surveys + free feedback (FR-SETTINGS-015..017)
  surveyRepo,
  listActiveSurveys: new ListActiveSurveysUseCase(surveyRepo),
  loadSurveyBundle: new LoadSurveyBundleUseCase(surveyRepo),
  saveSurveyAnswers: new SaveSurveyAnswersUseCase(surveyRepo),
  checkSurveyPrompt: new CheckSurveyPromptUseCase(surveyRepo),
  submitFreeFeedback: new SubmitFreeFeedbackUseCase(surveyRepo),
  // Server-side active days for survey eligibility + PMF retention (KC#1058)
  recordActiveDay: new RecordActiveDayUseCase(userActivityRepo),

  // Admin survey dashboard (FR-ADMIN-021)
  getAdminSurveyOverview: new GetAdminSurveyOverviewUseCase(surveyAdminRepo),
  getAdminSurveyResults: new GetAdminSurveyResultsUseCase(surveyAdminRepo),
  getPmfSurveyReport: new GetPmfSurveyReportUseCase(surveyAdminRepo),
  listUserFeedback: new ListUserFeedbackUseCase(surveyAdminRepo),

  // Public research — Survey B (FR-RESEARCH-001..003)
  publicResearchRepo,
  loadPublicResearchBundle: new LoadPublicResearchBundleUseCase(publicResearchRepo),
  submitPublicResearchResponse: new SubmitPublicResearchResponseUseCase(publicResearchRepo),
} as const;
