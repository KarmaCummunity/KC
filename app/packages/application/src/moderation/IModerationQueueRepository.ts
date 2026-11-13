/** Why a target waits in the review queue (FR-MOD-008 AC1; `moderation_queue.reason`). */
export type ModerationQueueReason =
  | 'report_threshold' | 'excessive_reopens' | 'forbidden_keyword' | 'manual_flag' | 'operator_case';

/** The kinds of target a queue entry points at. */
export type ModerationQueueTargetType = 'post' | 'user' | 'comment' | 'chat';

/** One open entry of the staff review queue. */
export interface ModerationQueueEntry {
  readonly entryId: string;
  readonly targetType: ModerationQueueTargetType;
  readonly targetId: string;
  readonly reason: ModerationQueueReason;
  /** The staff member working on it, if any. */
  readonly assigneeId: string | null;
  /** Ids and counters that explain the entry (for example the reopen count). */
  readonly metadata: Readonly<Record<string, unknown>>;
  /** ISO time the entry was opened. */
  readonly createdAt: string;
}

export interface ModerationQueueCursor {
  readonly createdAt: string;
  readonly entryId: string;
}

export interface ModerationQueuePage {
  readonly entries: readonly ModerationQueueEntry[];
  readonly nextCursor: ModerationQueueCursor | null;
}

/** FR-MOD-008 — the open review entries, oldest first, and the staff actions on them. */
export interface IModerationQueueRepository {
  listOpen(cursor: ModerationQueueCursor | null, limit: number): Promise<ModerationQueuePage>;
  /** Assigns an open entry to the caller, or to another staff member. */
  assign(entryId: string, assigneeId?: string): Promise<void>;
  /** Closes an open entry; what was done to the target is its own action. */
  resolve(entryId: string): Promise<void>;
}
