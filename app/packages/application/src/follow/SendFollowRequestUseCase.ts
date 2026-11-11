/** FR-FOLLOW-003 — send a follow request to a Private profile. */
import type { FollowRequest } from '@kc/domain';
import type { IUserRepository } from '../ports/IUserRepository';
import { FollowError } from './errors';

export interface SendFollowRequestInput {
  viewerId: string;
  targetUserId: string;
}

export interface SendFollowRequestOutput {
  request: FollowRequest;
}

export class SendFollowRequestUseCase {
  constructor(private readonly users: IUserRepository) {}

  /** FR-FOLLOW-003 AC1 — idempotent: a second request returns the pending one. */
  async execute(input: SendFollowRequestInput): Promise<SendFollowRequestOutput> {
    if (input.viewerId === input.targetUserId) {
      throw new FollowError('self_follow', 'self_follow');
    }
    const request = await this.users.sendFollowRequest(input.viewerId, input.targetUserId);
    return { request };
  }
}
