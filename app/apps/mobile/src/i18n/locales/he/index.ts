// ─────────────────────────────────────────────
// Hebrew (he) translation bundle — Karma Community
// Mapped to: R-MVP-Core-4 (עברית בלבד ב-MVP)
// Composed from `modules/*.ts`, `donations.ts`, and `stats.ts` for the 200-LOC cap.
// Default export: full Hebrew resource tree for `react-i18next` (`src/i18n/index.ts`).
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
import { ridePlaces } from './ridePlaces';
import { dateTimeField, rideFeed, rideRoutes, rideSafety, rideSchedule, rideSeries } from './rideSchedule';
import { authHe } from './modules/auth';
import { authVerificationHintHe } from './modules/authVerificationHint';
import { onboardingHe } from './modules/onboarding';
import { dateOfBirthHe } from './modules/dateOfBirth';
import { verificationHe } from './modules/verification';
import { errorsHe } from './modules/errors';
import { chatHe } from './modules/chat';
import { chatNewHe } from './modules/chatNew';
import { chatMessagingHe } from './modules/chatMessaging';
import { marketplaceBaselineErrorsHe } from './modules/marketplaceBaselineErrors';
import { notificationsHe } from './modules/notifications';
import { emptyStatesHe, feedSettingsHe } from './modules/feedSettings';
import { moderationHe, auditHe, accountBlockedHe } from './modules/moderation';
import { restoreAccountHe } from './modules/restoreAccount';
import { postHe } from './modules/post';
import { settingsHe } from './modules/settings';
import { stats } from './stats';
import { transparencyHe } from './modules/transparency';
import { aboutContentMerged } from './modules/aboutContentBundle';
import { tabsHe } from './modules/tabs';
import { errorBoundaryHe, devBannerHe, optionsMenuHe } from './modules/ui';
import { feedHe } from './modules/feed';
import { profileHe } from './modules/profile';
import { closureHe } from './modules/closure';
import { filtersHe } from './modules/filters';
import { commonHe } from './modules/common';
import { legalHe } from './modules/legal';
import { surveyDemoHe } from './modules/surveyDemo';
import { surveyHe } from './modules/survey';
import { researchHe } from './modules/research';
import { adminHe } from './modules/admin';
import { karmaHe } from './modules/karma';
import { karmaEventsHe } from './modules/karmaEvents';
import { cardsHe } from './modules/cards';
import { asideHe } from './modules/aside';
import { configHe } from './modules/config';
import { followHe } from './modules/follow';
import { matchesHe } from './modules/matches';
import { backendAvailabilityHe } from './modules/backendAvailability';

const he = {
  // App
  appName: 'KC - קהילת קארמה',

  config: configHe,

  // Auth (FR-AUTH-001..014) — see modules/auth.ts
  auth: { ...authHe, ...authVerificationHintHe },

  // Onboarding (FR-AUTH-010..012, FR-AUTH-018) — see modules/onboarding.ts
  onboarding: onboardingHe,
  dateOfBirth: dateOfBirthHe,
  verification: verificationHe,

  // Feed — see modules/feed.ts
  feed: feedHe,

  // Karma points (FR-KARMA-004/007) — see modules/karma.ts and modules/karmaEvents.ts
  karma: { ...karmaHe, reason: { ...karmaHe.reason, ...karmaEventsHe } },
  cards: cardsHe,

  // Post — see modules/post.ts
  post: postHe,

  // Profile — see modules/profile.ts
  profile: profileHe,

  // Closure (FR-CLOSURE-001..005) — see modules/closure.ts
  closure: closureHe,

  // Filters (FR-FEED-004/005/006/018/020) — see modules/filters.ts
  filters: filtersHe,

  // Chat — see modules/chat.ts (FR-CHAT-016)
  chat: { ...chatHe, new: chatNewHe, messaging: chatMessagingHe },

  // Notifications (FR-NOTIF-001..015) — see modules/notifications.ts
  notifications: notificationsHe,
  feedSettings: feedSettingsHe,
  emptyStates: emptyStatesHe,

  // Moderation (FR-MOD-007/010 + FR-ADMIN-002..007) — see modules/moderation.ts
  moderation: moderationHe,
  audit: auditHe,
  accountBlocked: accountBlockedHe,
  restoreAccount: restoreAccountHe,

  // Admin portal (FR-ADMIN-010/011) — see modules/admin.ts
  admin: adminHe,

  // Settings — see modules/settings.ts
  settings: settingsHe,

  // Stats (FR-STATS-001..004) — see stats.ts
  stats,

  // Live public financial transparency (FR-FIN-022) — see modules/transparency.ts
  transparency: transparencyHe,

  // Desktop aside panels (FR-RESP-003) — see modules/aside.ts
  aside: asideHe,

  // Legal (FR-SETTINGS-010) — see modules/legal.ts; bodies are server-driven Markdown.
  legal: legalHe,

  // Survey UX demo (internal preview) — see modules/surveyDemo.ts.
  surveyDemo: surveyDemoHe,

  // Production surveys + free feedback (FR-SETTINGS-015..017) — see modules/survey.ts.
  survey: surveyHe,

  // Public market research — Survey B (FR-RESEARCH-001..003) — see modules/research.ts.
  research: researchHe,

  // About — see modules/aboutContentBundle.ts (FR-SETTINGS About narrative)
  aboutContent: aboutContentMerged,

  // Donations (D-16, FR-DONATE-001..005) — see donations.ts
  donations,

  // Baseline server reasons join the marketplace error copy — see modules/marketplaceBaselineErrors.ts.
  marketplace: { ...marketplace, errors: { ...marketplace.errors, ...marketplaceBaselineErrorsHe } },
  moneyPayments,
  // Direct support for KC (FR-DONATE-011) — see donations.supportKc.ts
  supportKc,
  timeVolunteer,
  // Challenges world (docs/spec/10_challenges.md) — see challenges.ts
  challenges,
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

  follow: followHe,
  // Matching v2 — see modules/matches.ts
  matches: matchesHe,

  // Degrade rule copy — see modules/backendAvailability.ts
  backend: backendAvailabilityHe,

  // Tab labels — see modules/tabs.ts
  tabs: tabsHe,

  // Error messages (auth/post/profile/media/createPost) — see modules/errors.ts
  errors: errorsHe,

  // Misc chrome — see modules/ui.ts
  errorBoundary: errorBoundaryHe,
  devBanner: devBannerHe,
  optionsMenu: optionsMenuHe,

  // Cross-cutting placeholders — see modules/common.ts
  common: commonHe,

  // General
  general: {
    loading: 'טוען...',
    error: 'אירעה שגיאה',
    errorTitle: 'שגיאה',
    retry: 'נסו שוב',
    cancel: 'ביטול',
    confirm: 'אישור',
    save: 'שמירה',
    delete: 'מחיקה',
    yes: 'כן',
    no: 'לא',
    back: 'חזרה',
    close: 'סגור',
    gotIt: 'הבנתי',
    now: 'עכשיו',
    today: 'היום',
    yesterday: 'אתמול',
    minutesAgo: 'לפני {{count}} דקות',
    hoursAgo: 'לפני {{count}} שעות',
    daysAgo: 'לפני {{count}} ימים',
    unknownError: 'שגיאה לא ידועה',
  },
} as const;

export default he;
