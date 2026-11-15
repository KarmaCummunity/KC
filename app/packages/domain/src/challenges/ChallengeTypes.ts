// Challenges (docs/spec/10_challenges.md, 05 §5.12): value objects and read models of the one
// challenge engine. Naming follows docs/spec/94_glossary_and_naming.md (Challenge,
// ChallengeScope, ChallengeParticipation) — never a bare "category" or "type".

/** Who can see and join a challenge. `group` (invite-only) is specified but not built yet. */
export const CHALLENGE_SCOPES = ['personal', 'community'] as const;
export type ChallengeScope = (typeof CHALLENGE_SCOPES)[number];

/** What one progress report holds: a yes/no tick, a count, or minutes. */
export const CHALLENGE_MEASUREMENTS = ['yes_no', 'count', 'duration_minutes'] as const;
export type ChallengeMeasurement = (typeof CHALLENGE_MEASUREMENTS)[number];

/** How often a report is expected; it defines the "cycle" a streak is counted in. */
export const CHALLENGE_CADENCES = ['daily', 'weekly', 'flexible'] as const;
export type ChallengeCadence = (typeof CHALLENGE_CADENCES)[number];

/** `at_least`: reaching the goal is success; `at_most`: staying within the goal is success. */
export const CHALLENGE_GOAL_DIRECTIONS = ['at_least', 'at_most'] as const;
export type ChallengeGoalDirection = (typeof CHALLENGE_GOAL_DIRECTIONS)[number];

export const CHALLENGE_DIFFICULTIES = ['easy', 'medium', 'hard', 'expert'] as const;
export type ChallengeDifficulty = (typeof CHALLENGE_DIFFICULTIES)[number];

/** Lists the challenges screen offers: open community ones, the ones I joined, the ones I opened. */
export const CHALLENGE_LIST_VIEWS = ['discover', 'joined', 'created'] as const;
export type ChallengeListView = (typeof CHALLENGE_LIST_VIEWS)[number];

export const CHALLENGE_TITLE_MIN_LENGTH = 3;
/** A challenge is a post: its title obeys the posts title limit of 1–80 characters. */
export const CHALLENGE_TITLE_MAX_LENGTH = 80;
export const CHALLENGE_DESCRIPTION_MAX_LENGTH = 2000;
export const CHALLENGE_TOPIC_MAX_LENGTH = 50;
export const CHALLENGE_NOTE_MAX_LENGTH = 500;
/** Matches the `numeric(10,2)` columns: values stay below 10^8. */
export const CHALLENGE_VALUE_MAX = 99_999_999.99;
export const CHALLENGE_TARGET_CYCLES_MAX = 366;
/** A report may be filed for today or up to this many days back (late logging), never ahead. */
export const CHALLENGE_REPORT_GRACE_DAYS = 2;
/** From this many participants a community challenge earns the "large" karma tier (07 §7.6). */
export const CHALLENGE_LARGE_COMMUNITY_MIN_PARTICIPANTS = 50;

/** What the creator fills in to open a challenge. */
export interface ChallengeDraft {
  readonly title: string;
  readonly description: string | null;
  readonly scope: ChallengeScope;
  readonly measurement: ChallengeMeasurement;
  readonly cadence: ChallengeCadence;
  /** Numeric target; always null for `yes_no`. */
  readonly goalValue: number | null;
  /** Required exactly when `goalValue` is set. */
  readonly goalDirection: ChallengeGoalDirection | null;
  readonly difficulty: ChallengeDifficulty | null;
  /** Free-text subject such as "health" or "learning" (what the legacy app called a category). */
  readonly topicLabel: string | null;
  /** ISO timestamp after which no more reports are accepted. */
  readonly endsAt: string | null;
  /** Successful cycles a participant needs to complete the challenge. */
  readonly targetCycles: number | null;
}

/** A challenge as listed, plus the viewer's own participation (null fields when not joined). */
export interface ChallengeSummary extends Omit<ChallengeDraft, 'endsAt'> {
  readonly challengeId: string;
  /** The challenge's feed post (title, audience, comments and reactions live on it). */
  readonly postId: string;
  readonly creatorId: string;
  readonly creatorDisplayName: string;
  readonly status: 'active' | 'ended';
  readonly endsAt: string | null;
  readonly participantsCount: number;
  readonly createdAt: string;
  readonly joined: boolean;
  /** Live streak: already 0 when the viewer skipped a full cycle. */
  readonly myCurrentStreak: number;
  readonly myBestStreak: number;
  readonly mySuccessfulCycles: number;
  readonly myCompleted: boolean;
}

/** Opaque keyset cursor of a challenge list; pass back the `nextCursor` of the previous page. */
export type ChallengeListCursor = string;

/** One keyset page of a challenge list; `nextCursor` is null on the last page. */
export interface ChallengePage {
  readonly challenges: readonly ChallengeSummary[];
  readonly nextCursor: ChallengeListCursor | null;
}

/** What a participant reports for one cycle. */
export interface ChallengeProgressInput {
  readonly challengeId: string;
  readonly measurement: ChallengeMeasurement;
  readonly value: number;
  readonly note: string | null;
  /** `YYYY-MM-DD`; null means today (Israel date, decided by the server). */
  readonly reportDate: string | null;
}

/** One stored report (one per participant per cycle). */
export interface ChallengeEntry {
  readonly cycleStart: string;
  readonly value: number;
  readonly note: string | null;
  readonly goalMet: boolean;
  readonly reportedAt: string;
}

/** Outcome of a report; `karmaPoints` is private to the reporter (07 §7.6). */
export interface ChallengeProgressResult {
  readonly cycleStart: string;
  readonly goalMet: boolean;
  readonly currentStreak: number;
  readonly bestStreak: number;
  readonly successfulCycles: number;
  readonly completed: boolean;
  readonly karmaPoints: number;
}

/** Group standing; deliberately carries no karma (10: leaderboard without exposing karma). */
export interface ChallengeLeaderboardRow {
  readonly userId: string;
  readonly displayName: string;
  readonly currentStreak: number;
  readonly bestStreak: number;
  readonly successfulCycles: number;
  readonly completed: boolean;
  readonly isMe: boolean;
}
