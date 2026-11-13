/**
 * FR-MOD-008 AC2–AC3 — the staff review queue in the admin portal: list the open entries,
 * take one, and close it once the target was restored, removed or left as it is. The server
 * checks the moderator role on every write.
 */
import type {
  IModerationQueueRepository, ModerationQueueCursor, ModerationQueuePage,
} from './IModerationQueueRepository';

/** Entries per page when the caller names none. */
export const MODERATION_QUEUE_PAGE_SIZE = 30;

export class ListModerationQueueUseCase {
  constructor(private readonly repo: IModerationQueueRepository) {}

  execute(cursor: ModerationQueueCursor | null = null, limit = MODERATION_QUEUE_PAGE_SIZE): Promise<ModerationQueuePage> {
    return this.repo.listOpen(cursor, Math.min(Math.max(Math.trunc(limit), 1), 100));
  }
}

export class AssignQueueEntryUseCase {
  constructor(private readonly repo: IModerationQueueRepository) {}

  /** Without an assignee the caller takes the entry. */
  execute(input: { entryId: string; assigneeId?: string }): Promise<void> {
    return this.repo.assign(input.entryId, input.assigneeId);
  }
}

export class ResolveQueueEntryUseCase {
  constructor(private readonly repo: IModerationQueueRepository) {}

  execute(input: { entryId: string }): Promise<void> {
    return this.repo.resolve(input.entryId);
  }
}
