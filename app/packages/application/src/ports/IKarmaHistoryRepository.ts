/** One entry of a member's karma ledger: points gained or taken back, and why. */
export interface KarmaHistoryEntry {
  readonly id: number;
  /** Ledger event type, e.g. `post_published`, `handoff_giver`, `reversal`. */
  readonly eventType: string;
  /** Points of this entry; negative for a reversal. */
  readonly delta: number;
  readonly createdAt: string;
}

/** FR-KARMA-007: a member's own karma history. */
export interface IKarmaHistoryRepository {
  /** The newest entries of `userId`, newest first. A member can read only their own ledger. */
  listHistory(userId: string, limit: number): Promise<KarmaHistoryEntry[]>;
}
