/**
 * FR-CHAT-007, FR-MOD-002, FR-ADMIN-013 AC2 — the staff support inbox: list the members'
 * support threads, join one to answer it, or open a member's thread from a report case.
 * The server checks the staff role on every call.
 */
import type {
  ISupportInboxRepository, SupportThreadCursor, SupportThreadPage,
} from './ISupportInboxRepository';

/** Threads per page when the caller names none. */
export const SUPPORT_INBOX_PAGE_SIZE = 30;

export class ListSupportThreadsUseCase {
  constructor(private readonly repo: ISupportInboxRepository) {}

  execute(cursor: SupportThreadCursor | null = null, limit = SUPPORT_INBOX_PAGE_SIZE): Promise<SupportThreadPage> {
    return this.repo.listThreads(cursor, Math.min(Math.max(Math.trunc(limit), 1), 100));
  }
}

export class JoinSupportThreadUseCase {
  constructor(private readonly repo: ISupportInboxRepository) {}

  execute(chatId: string): Promise<string> {
    return this.repo.joinThread(chatId);
  }
}

export class OpenMemberSupportThreadUseCase {
  constructor(private readonly repo: ISupportInboxRepository) {}

  execute(userId: string): Promise<string> {
    return this.repo.openMemberThread(userId);
  }
}
