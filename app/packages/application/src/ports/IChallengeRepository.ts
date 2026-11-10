import type {
  ChallengeDraft,
  ChallengeEntry,
  ChallengeLeaderboardRow,
  ChallengeListView,
  ChallengeProgressResult,
  ChallengeSummary,
} from '@kc/domain';

/**
 * Port of the challenge engine (docs/spec/10_challenges.md). Every method acts as the signed-in
 * member; the adapter maps server-side failures to `ChallengeError`.
 */
export interface IChallengeRepository {
  /** Opens a challenge and joins its creator; returns the new challenge id. */
  createChallenge(draft: ChallengeDraft): Promise<string>;
  listChallenges(view: ChallengeListView, limit?: number, offset?: number): Promise<ChallengeSummary[]>;
  getChallenge(challengeId: string): Promise<ChallengeSummary | null>;
  joinChallenge(challengeId: string, showOnProfile?: boolean): Promise<void>;
  /** Leaves a challenge; the creator cannot leave and ends it instead. */
  leaveChallenge(challengeId: string): Promise<void>;
  /** Creator only: stops further reports; participants keep their history. */
  endChallenge(challengeId: string): Promise<void>;
  /** Files (or overwrites) the viewer's report for the cycle of `reportDate`. */
  reportProgress(
    challengeId: string,
    value: number,
    note: string | null,
    reportDate: string | null,
  ): Promise<ChallengeProgressResult>;
  listMyEntries(challengeId: string, limit?: number): Promise<ChallengeEntry[]>;
  listLeaderboard(challengeId: string, limit?: number): Promise<ChallengeLeaderboardRow[]>;
}
