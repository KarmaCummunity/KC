// ─────────────────────────────────────────────
// English (en) translation bundle — Karma Community
// Mapped to: FR-SETTINGS-018 (opt-in English UI locale). Machine-translated from
// the Hebrew bundle; pending human polish (see TECH_DEBT TD-176).
// Composed from `modules/*.ts`, `donations.ts`, and `stats.ts`, mirroring the
// Hebrew `../he/index.ts` structure key-for-key.
// Default export: full English resource tree for `react-i18next` (`src/i18n/index.ts`).
// ─────────────────────────────────────────────

import { medicalBodies } from './donations.medicalBodies';
import { donations, marketplace, moneyPayments, search, timeVolunteer } from './donations';
import { supportKc } from './donations.supportKc';
import { challenges } from './challenges';
import { givingHandoff } from './givingHandoff';
import { rideBooking } from './rideBooking';
import { knowledgeBooking } from './knowledgeBooking';
import { housingStay } from './housingStay';
import { eventPost } from './eventPost';
import { organizations } from './organizations';
import { postSeries } from './postSeries';
import { ridePlaces } from './ridePlaces';
import { dateTimeField, rideFeed, rideRoutes, rideSafety, rideSchedule, rideSeries } from './rideSchedule';
import { authEn } from './modules/auth';
import { authVerificationHintEn } from './modules/authVerificationHint';
import { offlineSyncEn } from './modules/offlineSync';
import { onboardingEn } from './modules/onboarding';
import { dateOfBirthEn } from './modules/dateOfBirth';
import { verificationEn } from './modules/verification';
import { errorsEn } from './modules/errors';
import { chatEn } from './modules/chat';
import { chatNewEn } from './modules/chatNew';
import { chatMessagingEn } from './modules/chatMessaging';
import { marketplaceBaselineErrorsEn } from './modules/marketplaceBaselineErrors';
import { challengeBaselineErrorsEn } from './modules/challengeBaselineErrors';
import { notificationsEn } from './modules/notifications';
import { emptyStatesEn, feedSettingsEn } from './modules/feedSettings';
import { moderationEn, auditEn, accountBlockedEn } from './modules/moderation';
import { restoreAccountEn } from './modules/restoreAccount';
import { postEn } from './modules/post';
import { settingsEn } from './modules/settings';
import { stats } from './stats';
import { transparencyEn } from './modules/transparency';
import { aboutContentMerged } from './modules/aboutContentBundle';
import { tabsEn } from './modules/tabs';
import { errorBoundaryEn, devBannerEn, optionsMenuEn } from './modules/ui';
import { feedEn } from './modules/feed';
import { profileEn } from './modules/profile';
import { closureEn } from './modules/closure';
import { filtersEn } from './modules/filters';
import { commonEn } from './modules/common';
import { legalEn } from './modules/legal';
import { surveyDemoEn } from './modules/surveyDemo';
import { surveyEn } from './modules/survey';
import { researchEn } from './modules/research';
import { adminEn } from './modules/admin';
import { adminOrgApprovalsBaselineEn } from './modules/adminOrgApprovalsBaseline';
import { adminStaffToolsEn } from './modules/adminStaffTools';
import { adminCrmBaselineEn, adminTimeBaselineEn } from './modules/adminBackOfficeBaseline';
import { karmaEn } from './modules/karma';
import { karmaEventsEn } from './modules/karmaEvents';
import { cardsEn } from './modules/cards';
import { asideEn } from './modules/aside';
import { configEn } from './modules/config';
import { followEn } from './modules/follow';
import { matchesEn } from './modules/matches';
import { backendAvailabilityEn } from './modules/backendAvailability';

const en = {
  // App
  appName: 'KC - Karma Community',

  config: configEn,

  // Auth (FR-AUTH-001..014) — see modules/auth.ts
  auth: { ...authEn, ...authVerificationHintEn },
  offlineSync: offlineSyncEn,

  // Onboarding (FR-AUTH-010..012, FR-AUTH-018) — see modules/onboarding.ts
  onboarding: onboardingEn,
  dateOfBirth: dateOfBirthEn,
  verification: verificationEn,

  // Feed — see modules/feed.ts
  feed: feedEn,

  // Karma points (FR-KARMA-004/007) — see modules/karma.ts and modules/karmaEvents.ts
  karma: { ...karmaEn, reason: { ...karmaEn.reason, ...karmaEventsEn } },
  cards: cardsEn,

  // Post — see modules/post.ts
  post: postEn,

  // Profile — see modules/profile.ts
  profile: profileEn,

  // Closure (FR-CLOSURE-001..005) — see modules/closure.ts
  closure: closureEn,

  // Filters (FR-FEED-004/005/006/018/020) — see modules/filters.ts
  filters: filtersEn,

  // Chat — see modules/chat.ts (FR-CHAT-016)
  chat: { ...chatEn, new: chatNewEn, messaging: chatMessagingEn },

  // Notifications (FR-NOTIF-001..015) — see modules/notifications.ts
  notifications: notificationsEn,
  feedSettings: feedSettingsEn,
  emptyStates: emptyStatesEn,

  // Moderation (FR-MOD-007/010 + FR-ADMIN-002..007) — see modules/moderation.ts
  moderation: moderationEn,
  audit: auditEn,
  accountBlocked: accountBlockedEn,
  restoreAccount: restoreAccountEn,

  // Admin portal (FR-ADMIN-010/011) — see modules/admin.ts
  // The baseline approval copy joins admin.orgApprovals — see modules/adminOrgApprovalsBaseline.ts;
  // the back-office copy joins admin.crm and admin.time — see modules/adminBackOfficeBaseline.ts.
  // The support inbox and review queue copy — see modules/adminStaffTools.ts.
  admin: {
    ...adminEn,
    nav: { ...adminEn.nav, ...adminStaffToolsEn.nav },
    supportInbox: adminStaffToolsEn.supportInbox,
    reviewQueue: adminStaffToolsEn.reviewQueue,
    orgApprovals: {
      ...adminEn.orgApprovals,
      row: { ...adminEn.orgApprovals.row, ...adminOrgApprovalsBaselineEn.row },
      errors: { ...adminEn.orgApprovals.errors, ...adminOrgApprovalsBaselineEn.errors },
    },
    crm: {
      ...adminEn.crm,
      noOrgsTitle: adminCrmBaselineEn.noOrgsTitle,
      errors: { ...adminEn.crm.errors, ...adminCrmBaselineEn.errors },
    },
    time: { ...adminEn.time, errors: { ...adminEn.time.errors, ...adminTimeBaselineEn.errors } },
  },

  // Settings — see modules/settings.ts
  settings: settingsEn,

  // Stats (FR-STATS-001..004) — see stats.ts
  stats,

  // Live public financial transparency (FR-FIN-022) — see modules/transparency.ts
  transparency: transparencyEn,

  // Desktop aside panels (FR-RESP-003) — see modules/aside.ts
  aside: asideEn,

  // Legal (FR-SETTINGS-010) — see modules/legal.ts; bodies are server-driven Markdown.
  legal: legalEn,

  // Survey UX demo (internal preview) — see modules/surveyDemo.ts.
  surveyDemo: surveyDemoEn,

  // Production surveys + free feedback (FR-SETTINGS-015..017) — see modules/survey.ts.
  survey: surveyEn,

  // Public market research — Survey B (FR-RESEARCH-001..003) — see modules/research.ts.
  research: researchEn,

  // About — see modules/aboutContentBundle.ts (FR-SETTINGS About narrative)
  aboutContent: aboutContentMerged,

  // Donations (D-16, FR-DONATE-001..005) — see donations.ts
  donations,

  // Baseline server reasons join the marketplace error copy — see modules/marketplaceBaselineErrors.ts.
  marketplace: { ...marketplace, errors: { ...marketplace.errors, ...marketplaceBaselineErrorsEn } },
  moneyPayments,
  // Direct support for KC (FR-DONATE-011) — see donations.supportKc.ts
  supportKc,
  timeVolunteer,
  // Challenges world (docs/spec/10_challenges.md) — see challenges.ts; baseline refusals in
  // modules/challengeBaselineErrors.ts.
  challenges: { ...challenges, errors: { ...challenges.errors, ...challengeBaselineErrorsEn } },
  medicalBodies,
  givingHandoff,
  // Ride seat bookings (D73) — see rideBooking.ts
  rideBooking,
  knowledgeBooking,
  // Housing stays (FR-HOUSING-003, 012, 015–021) — see housingStay.ts
  housingStay,
  // Organization events (G1 step 5) — see eventPost.ts
  eventPost,
  // Organizations (FR-ORG-002, G18) — see organizations.ts
  organizations,
  // Recurring time posts (FR-POST-024) — see postSeries.ts
  postSeries,
  // Ride places (D71) — see ridePlaces.ts
  ridePlaces,
  // Ride quick publish (D75) and the shared date-time field — see rideSchedule.ts
  rideSchedule,
  dateTimeField,
  rideFeed,
  rideRoutes,
  rideSafety,
  // Recurring rides (FR-RIDE-046) — see rideSchedule.ts
  rideSeries,

  // Search (D-16, FR-FEED-016) — see donations.ts
  search,

  follow: followEn,
  // Matching v2 — see modules/matches.ts
  matches: matchesEn,

  // Degrade rule copy — see modules/backendAvailability.ts
  backend: backendAvailabilityEn,

  // Tab labels — see modules/tabs.ts
  tabs: tabsEn,

  // Error messages (auth/post/profile/media/createPost) — see modules/errors.ts
  errors: errorsEn,

  // Misc chrome — see modules/ui.ts
  errorBoundary: errorBoundaryEn,
  devBanner: devBannerEn,
  optionsMenu: optionsMenuEn,

  // Cross-cutting placeholders — see modules/common.ts
  common: commonEn,

  // General
  general: {
    loading: 'Loading…',
    error: 'Something went wrong',
    errorTitle: 'Error',
    retry: 'Try again',
    cancel: 'Cancel',
    confirm: 'Confirm',
    save: 'Save',
    delete: 'Delete',
    yes: 'Yes',
    no: 'No',
    back: 'Back',
    close: 'Close',
    gotIt: 'Got it',
    now: 'Now',
    today: 'Today',
    yesterday: 'Yesterday',
    minutesAgo: '{{count}} minutes ago',
    hoursAgo: '{{count}} hours ago',
    daysAgo: '{{count}} days ago',
    unknownError: 'Unknown error',
  },
} as const;

export default en;
