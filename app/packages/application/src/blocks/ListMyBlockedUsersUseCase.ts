import type { BlockedUser, IBlockRepository } from '../ports/IBlockRepository';

/**
 * FR-MOD-004 AC1 — the members the signed-in user has blocked, newest first, for the Blocked
 * Users screen. Identity comes from the session server-side, so the use case takes no user id.
 */
export class ListMyBlockedUsersUseCase {
  constructor(private readonly repo: IBlockRepository) {}

  execute(): Promise<BlockedUser[]> {
    return this.repo.listMyBlockedUsers();
  }
}
