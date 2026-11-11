/** FR-FOLLOW-001 — instant follow on a Public profile (or after request approval). */
import type { FollowEdge } from '@kc/domain';
import type { IUserRepository } from '../ports/IUserRepository';
import { FollowError } from './errors';

export interface FollowUserInput {
  viewerId: string;
  targetUserId: string;
}

export interface FollowUserOutput {
  edge: FollowEdge;
}

export class FollowUserUseCase {
  constructor(private readonly users: IUserRepository) {}

  /** FR-FOLLOW-001 AC1 — idempotent on retry: following twice returns the same edge. */
  async execute(input: FollowUserInput): Promise<FollowUserOutput> {
    if (input.viewerId === input.targetUserId) {
      throw new FollowError('self_follow', 'self_follow');
    }
    const edge = await this.users.follow(input.viewerId, input.targetUserId);
    return { edge };
  }
}
