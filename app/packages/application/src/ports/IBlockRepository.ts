/** One member the caller has blocked, as the Blocked Users screen shows it (FR-MOD-004 AC1). */
export interface BlockedUser {
  readonly userId: string;
  readonly displayName: string | null;
  readonly avatarUrl: string | null;
  /** ISO timestamp of the block. */
  readonly blockedAt: string;
}

/** Apple 1.2 / FR-MOD — a user blocks another user (mutual invisibility enforced server-side). */
export interface IBlockRepository {
  isBlocking(blockerId: string, blockedId: string): Promise<boolean>;
  block(blockerId: string, blockedId: string): Promise<void>;
  unblock(blockerId: string, blockedId: string): Promise<void>;
  /** FR-MOD-004 AC1 — the caller's own blocks, newest first. */
  listMyBlockedUsers(): Promise<BlockedUser[]>;
}
