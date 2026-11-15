/** One member's support thread as the staff support inbox lists it (FR-CHAT-007, FR-MOD-002). */
export interface SupportThreadSummary {
  readonly chatId: string;
  /** The member the thread belongs to; null once their account was removed. */
  readonly memberId: string | null;
  readonly memberDisplayName: string | null;
  readonly memberAvatarUrl: string | null;
  /** ISO time of the newest message. */
  readonly lastMessageAt: string;
  /** Whether the signed-in staff member has joined the thread (and so has it in their inbox). */
  readonly joined: boolean;
}

/** Keyset position after the last thread of a page. */
export interface SupportThreadCursor {
  readonly lastMessageAt: string;
  readonly chatId: string;
}

export interface SupportThreadPage {
  readonly threads: readonly SupportThreadSummary[];
  readonly nextCursor: SupportThreadCursor | null;
}

/** Staff side of the support threads (migration 0015). Every method is platform-staff only. */
export interface ISupportInboxRepository {
  /** Support threads with messages, newest activity first. */
  listThreads(cursor: SupportThreadCursor | null, limit: number): Promise<SupportThreadPage>;
  /** Joins a thread as its support agent; resolves to the chat id to open. */
  joinThread(chatId: string): Promise<string>;
  /** A member's thread (created if needed), joined by the caller; resolves to its chat id. */
  openMemberThread(userId: string): Promise<string>;
}
