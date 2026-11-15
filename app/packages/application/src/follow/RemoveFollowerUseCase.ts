/** FR-FOLLOW-009 — owner removes a current follower. No notification (AC4). */
import type { IUserRepository } from '../ports/IUserRepository';
import { assertSessionUser } from '../auth/assertSessionUser';
import { FollowError } from './errors';

export interface RemoveFollowerInput {
  sessionUserId: string;
  ownerId: string;
  followerId: string;
}

export class RemoveFollowerUseCase {
  constructor(private readonly users: IUserRepository) {}

  async execute(input: RemoveFollowerInput): Promise<void> {
    assertSessionUser(input.sessionUserId, input.ownerId);
    if (input.ownerId === input.followerId) {
      throw new FollowError('self_follow', 'self_follow');
    }
    // Edge orientation: followerId follows ownerId. Either party can DELETE
    // (RLS policy `follows_delete_party`).
    await this.users.unfollow(input.followerId, input.ownerId);
  }
}
