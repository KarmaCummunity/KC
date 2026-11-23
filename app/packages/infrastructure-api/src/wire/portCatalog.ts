import type {
  IAboutRepository,
  IAccountGateRepository,
  IActiveStatusRepository,
  IAdminContentRepository,
  IAdminRoleRepository,
  IAdminTaskRepository,
  IAppFlagsAdminRepository,
  IBlockRepository,
  IChallengeRepository,
  IChatRepository,
  IChatV2Repository,
  ICityRepository,
  ICrmContactsRepository,
  IDemoDataRepository,
  IDeviceRepository,
  IDonationLinksRepository,
  IDriverDeclarationRepository,
  IFeatureFlagsRepository,
  IFinanceAccountsRepository,
  IFinanceDonorsRepository,
  IFinanceLedgerRepository,
  IFollowSuggestionsRepository,
  IGuestPostsRepository,
  IHousingRepository,
  IImportTelemetryRepository,
  IKarmaHistoryRepository,
  IKcSupportChannelsRepository,
  IKnowledgeBookingRepository,
  IKnowledgeSlotSeriesRepository,
  IKnowledgeTopicRepository,
  ILegalDocumentRepository,
  IListingStreetAddressRepository,
  IMarketplaceRepository,
  IMatchRepository,
  IModerationAdminRepository,
  IModerationQueueRepository,
  INotificationInboxRepository,
  IOrgApplicationsRepository,
  IOrgHierarchyRepository,
  IOrgJobPostingAdminRepository,
  IOrgTransparencyRepository,
  IOrganizationsRepository,
  IPaymentsRepository,
  IPostEngagementRepository,
  IPostRepository,
  IPostSeriesRepository,
  IPostTranslationReader,
  IProEntitlementRepository,
  IProdCopyRepository,
  IPublicResearchRepository,
  IReportRepository,
  IReportsRepository,
  IRideBookingRepository,
  IRideHouseNumberRepository,
  IRidePlaceRepository,
  IRideSafetyRepository,
  IRideSavedRoutesRepository,
  IRideSeriesRepository,
  IRidesFeedRepository,
  ISavedPostsRepository,
  ISearchRepository,
  ISocialFeedRepository,
  IStatsRepository,
  IStreetRepository,
  ISupportInboxRepository,
  ISurveyAdminRepository,
  ISurveyRepository,
  ITimesheetsRepository,
  ITranslationCacheRepository,
  ITranslationService,
  ITransparencySettingsRepository,
  IUserActivityRepository,
  IUserRepository,
  IVolunteerRepository,
  IWhatsAppAdminRepository,
  IWhatsAppLinkRepository,
  IWorldContentRepository,
} from '@kc/application';

/**
 * The application ports the API serves, by wire name (ADR-010). One catalog for
 * both sides: the API can only declare a port under a name listed here, with
 * the interface listed here, and the app can only route a port it gives an
 * implementation of that same interface. A name is the interface without its
 * `I` prefix and its `Repository` / `Service` suffix, first letter lower case.
 *
 * Adding a port: add its line here, declare it in the API
 * (`apps/api/src/modules/hostedAdapters/ports`), and wrap it in the app's
 * composition root. Never rename or remove a name an installed app build may call.
 */
export interface PortCatalog {
  about: IAboutRepository;
  accountGate: IAccountGateRepository;
  activeStatus: IActiveStatusRepository;
  adminContent: IAdminContentRepository;
  adminRole: IAdminRoleRepository;
  adminTask: IAdminTaskRepository;
  appFlagsAdmin: IAppFlagsAdminRepository;
  block: IBlockRepository;
  challenge: IChallengeRepository;
  chat: IChatRepository;
  chatV2: IChatV2Repository;
  city: ICityRepository;
  crmContacts: ICrmContactsRepository;
  demoData: IDemoDataRepository;
  device: IDeviceRepository;
  donationLinks: IDonationLinksRepository;
  driverDeclaration: IDriverDeclarationRepository;
  featureFlags: IFeatureFlagsRepository;
  financeAccounts: IFinanceAccountsRepository;
  financeDonors: IFinanceDonorsRepository;
  financeLedger: IFinanceLedgerRepository;
  followSuggestions: IFollowSuggestionsRepository;
  guestPosts: IGuestPostsRepository;
  housing: IHousingRepository;
  importTelemetry: IImportTelemetryRepository;
  karmaHistory: IKarmaHistoryRepository;
  kcSupportChannels: IKcSupportChannelsRepository;
  knowledgeBooking: IKnowledgeBookingRepository;
  knowledgeSlotSeries: IKnowledgeSlotSeriesRepository;
  knowledgeTopic: IKnowledgeTopicRepository;
  legalDocument: ILegalDocumentRepository;
  listingStreetAddress: IListingStreetAddressRepository;
  marketplace: IMarketplaceRepository;
  match: IMatchRepository;
  moderationAdmin: IModerationAdminRepository;
  moderationQueue: IModerationQueueRepository;
  notificationInbox: INotificationInboxRepository;
  orgApplications: IOrgApplicationsRepository;
  orgHierarchy: IOrgHierarchyRepository;
  orgJobPostingAdmin: IOrgJobPostingAdminRepository;
  orgTransparency: IOrgTransparencyRepository;
  organizations: IOrganizationsRepository;
  payments: IPaymentsRepository;
  post: IPostRepository;
  postEngagement: IPostEngagementRepository;
  postSeries: IPostSeriesRepository;
  postTranslationReader: IPostTranslationReader;
  proEntitlement: IProEntitlementRepository;
  prodCopy: IProdCopyRepository;
  publicResearch: IPublicResearchRepository;
  report: IReportRepository;
  reports: IReportsRepository;
  rideBooking: IRideBookingRepository;
  rideHouseNumber: IRideHouseNumberRepository;
  ridePlace: IRidePlaceRepository;
  rideSafety: IRideSafetyRepository;
  rideSavedRoutes: IRideSavedRoutesRepository;
  rideSeries: IRideSeriesRepository;
  ridesFeed: IRidesFeedRepository;
  savedPosts: ISavedPostsRepository;
  search: ISearchRepository;
  socialFeed: ISocialFeedRepository;
  stats: IStatsRepository;
  street: IStreetRepository;
  supportInbox: ISupportInboxRepository;
  survey: ISurveyRepository;
  surveyAdmin: ISurveyAdminRepository;
  timesheets: ITimesheetsRepository;
  translation: ITranslationService;
  translationCache: ITranslationCacheRepository;
  transparencySettings: ITransparencySettingsRepository;
  user: IUserRepository;
  userActivity: IUserActivityRepository;
  volunteer: IVolunteerRepository;
  whatsAppAdmin: IWhatsAppAdminRepository;
  whatsAppLink: IWhatsAppLinkRepository;
  worldContent: IWorldContentRepository;
}

/** Wire name of a served port. */
export type PortName = keyof PortCatalog;
