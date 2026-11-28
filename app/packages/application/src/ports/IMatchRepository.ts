import type { matchMachine } from '@kc/domain';

export type MatchRole = 'offer' | 'request';
/** The status of a pair: the states of the `match` machine. */
export type MatchStatus = (typeof matchMachine.states)[number];
export type MatchResponse = 'accepted' | 'declined';

export interface MatchSuggestion {
  readonly candidateId: string;
  readonly status: MatchStatus;
  /** 0..1 (LLM-blended when the re-rank flag is on). */
  readonly score: number;
  readonly distanceKm: number | null;
  readonly worldSlug: string;
  readonly myRole: MatchRole;
  readonly myListingId: string;
  readonly myListingTitle: string;
  readonly otherListingId: string;
  readonly otherListingTitle: string;
  readonly otherListingSummary: string | null;
  /** The other member; the ids are empty and the names null while the poster is masked (FR-POST-021). */
  readonly otherOwner: {
    readonly userId: string;
    readonly displayName: string | null;
    readonly avatarUrl: string | null;
    readonly shareHandle: string | null;
  };
  readonly myResponse: MatchResponse | null;
  readonly otherResponse: MatchResponse | null;
  readonly reason: string | null;
  readonly createdAt: string;
}

export interface MatchRespondResult {
  readonly status: string;
  readonly mutual: boolean;
}

/** KC#1122 / FR-ADMIN-029 — one world's match quality over the requested window. */
export interface MatchQualityByWorld {
  readonly worldSlug: string;
  readonly worldLabelHe: string;
  readonly worldLabelEn: string;
  readonly notifiedPairs: number;
  readonly responses: number;
  readonly accepted: number;
  /** accepted / responses; null when nobody answered yet. */
  readonly precisionProxy: number | null;
  readonly chatPairs: number;
  /** chat pairs / notified pairs; null when nothing was notified. */
  readonly chatRate: number | null;
  /** null for worlds that do not hand off through handoffs. */
  readonly completedPairs: number | null;
  readonly completionRate: number | null;
}

/** Match suggestions between an offer and a request, and the admin's quality view (FR-ADMIN-029). */
export interface IMatchRepository {
  /** The caller's suggestions, newest first. */
  listMine(limit?: number): Promise<MatchSuggestion[]>;
  respond(candidateId: string, response: 'accept' | 'decline'): Promise<MatchRespondResult>;
  /** Match quality per giving world over the last `days` days (super admin). */
  qualityByWorld(days?: number): Promise<MatchQualityByWorld[]>;
}
