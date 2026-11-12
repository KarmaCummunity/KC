/** FR-PROFILE-005 / FR-PROFILE-006 — toggle privacy mode.
 *  Side-effects on Private→Public (auto-approve every pending follow request
 *  → fan-out to follows + counters) run transactionally inside the database's
 *  `set_privacy_mode` function. */
import type { PrivacyMode, User } from '@kc/domain';
import type { IUserRepository } from '../ports/IUserRepository';
import { FollowError } from './errors';

export interface UpdatePrivacyModeInput {
  userId: string;
  mode: PrivacyMode;
}

export interface UpdatePrivacyModeOutput {
  user: User;
}

export class UpdatePrivacyModeUseCase {
  constructor(private readonly users: IUserRepository) {}

  async execute(input: UpdatePrivacyModeInput): Promise<UpdatePrivacyModeOutput> {
    const current = await this.users.findById(input.userId);
    if (!current) throw new FollowError('user_not_found', 'user_not_found');
    if (current.privacyMode === input.mode) return { user: current };
    const updated = await this.users.setPrivacyMode(input.userId, input.mode);
    return { user: updated };
  }
}
