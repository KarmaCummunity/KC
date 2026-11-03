// ─────────────────────────────────────────────
// ENTITIES — Karma Community Domain Layer
// Mapped to SRS Part III § 3.2
// ─────────────────────────────────────────────

import type {
  AccountStatus,
  AuthProvider,
  FollowRequestStatus,
  MessageKind,
  MessageStatus,
  NotificationPreferences,
  OnboardingState,
  Platform,
  PrivacyMode,
  QueueReason,
  ReportReason,
  ReportStatus,
  ReportTargetType,
} from './value-objects';

// ── User ──────────────────────────────────────

export interface User {
  readonly userId: string;
  readonly authProvider: AuthProvider;
  readonly shareHandle: string;
  // `displayName`/`city`/`cityName` are nullable to represent the legitimate
  // `pending_basic_info` transient window (migration 0084). Onboarding fills
  // them; UI applies `t('profile.unnamedUser')` / `t('profile.cityNotSet')`
  // fallbacks at render time when null.
  displayName: string | null;
  city: string | null;
  cityName: string | null;
  /** Optional home address line on profile; null = city-only (FR-PROFILE-007). */
  profileStreet: string | null;
  profileStreetNumber: string | null;
  /**
   * Optional contact phone for display in profile + chat banner (FR-PROFILE-007 AC1, FR-CHAT-014 AC7).
   * Free-form, 1–20 chars after trim, non-verified. Distinct from the auth phone (`auth.users.phone`)
   * used for FR-AUTH-005 OTP sign-in. Null = unset.
   */
  contactPhone: string | null;
  biography: string | null;
  avatarUrl: string | null;
  privacyMode: PrivacyMode;
  privacyChangedAt: string | null;
  accountStatus: AccountStatus;
  onboardingState: OnboardingState;
  notificationPreferences: NotificationPreferences;
  isSuperAdmin: boolean;
  closureExplainerDismissed: boolean;
  firstPostNudgeDismissed: boolean;
  // Counters (derived, maintained by domain events)
  itemsGivenCount: number;
  itemsReceivedCount: number;
  activePostsCountInternal: number;
  followersCount: number;
  followingCount: number;
  /** Engagement score (FR-KARMA-001). Server-maintained, floored at 0. */
  karmaPoints: number;
  readonly createdAt: string;
  updatedAt: string;
  /** FR-TRANSLATE — reader's BCP-47 output language; null = resolve from device locale. */
  preferredLanguage: string | null;
}

// ── AuthIdentity ──────────────────────────────

export interface AuthIdentity {
  readonly authIdentityId: string;
  readonly userId: string;
  readonly provider: AuthProvider;
  readonly providerSubject: string;
  readonly createdAt: string;
}

// ── Device ───────────────────────────────────

export interface Device {
  readonly deviceId: string;
  readonly userId: string;
  readonly platform: Platform;
  pushToken: string;
  lastSeenAt: string;
  active: boolean;
}

// Post + MediaAsset + Recipient + ProfileClosedPostsItem live in `./posts`.

// ── Follow ────────────────────────────────────

export interface FollowEdge {
  readonly followerId: string;
  readonly followedId: string;
  readonly createdAt: string;
}

export interface FollowRequest {
  readonly requesterId: string;
  readonly targetId: string;
  readonly createdAt: string;
  status: FollowRequestStatus;
  cooldownUntil: string | null;
}

// ── Chat ──────────────────────────────────────

export interface Chat {
  readonly chatId: string;
  /**
   * Either participant may be null after an account deletion (migration 0028
   * — chats.participant_a/b are ON DELETE SET NULL so chats survive on the
   * counterpart side). Display layer renders null participants as the
   * localized `common.deletedUser` placeholder (FR-CHAT-013).
   */
  readonly participantIds: [string | null, string | null];
  readonly anchorPostId: string | null;
  readonly anchorRideId: string | null;
  /** Listing the chat was last opened from (items/food/…; KC#1297). At most one anchor is set. */
  readonly anchorListingId: string | null;
  readonly isSupportThread: boolean;
  lastMessageAt: string | null;
  readonly createdAt: string;
}

export interface Message {
  readonly messageId: string;
  readonly chatId: string;
  readonly senderId: string | null;  // null = system message
  readonly kind: MessageKind;
  body: string;
  systemPayload: Record<string, unknown> | null;
  mediaPayload: Record<string, unknown> | null;
  status: MessageStatus;
  readonly createdAt: string;
  deliveredAt: string | null;
  readAt: string | null;
}

// ── Report ────────────────────────────────────

export interface Report {
  readonly reportId: string;
  readonly reporterId: string;
  readonly targetType: ReportTargetType;
  readonly targetId: string | null;
  readonly reason: ReportReason;
  note: string | null;
  status: ReportStatus;
  readonly createdAt: string;
  resolvedAt: string | null;
}

// ── Moderation ────────────────────────────────

export interface ModerationQueueEntry {
  readonly entryId: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly reason: QueueReason;
  readonly createdAt: string;
  resolvedAt: string | null;
}

// ── Stats ─────────────────────────────────────

export interface CommunityStats {
  usersTotal: number;
  postsOpenPublic: number;
  postsClosedDeliveredTotal: number;
  asOf: string;
}

// ── City (reference) ──────────────────────────

export interface City {
  readonly cityId: string;
  readonly nameHe: string;
  readonly nameEn: string;
}

// ── Street (reference) ─────────────────────────
// Canonical Israeli streets sourced from data.gov.il package 321.
// (cityId, streetId) is the natural key; streetId is unique per city only.
// Code 9000 represents "the village itself" — the only canonical entry for
// 486 small settlements that have no named streets.

export interface Street {
  readonly cityId: string;
  readonly streetId: number;
  readonly nameHe: string;
}

// ── ReportSubmission (FR-MOD-001 minimal — submission only) ───────────────

export interface ReportSubmission {
  targetType: ReportTargetType;
  targetId: string | null;             // null iff targetType === 'none'
  reason: ReportReason;
  note?: string;                       // ≤ REPORT_NOTE_MAX_LENGTH
}
