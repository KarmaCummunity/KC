/**
 * FR-AUTH-015 — A member may fill level-1 profile fields via Edit Profile (FR-PROFILE-007)
 * while `onboarding_state` stays `pending_basic_info` (e.g. after skipping step 1).
 * Advance onboarding so the soft gate does not re-prompt for data already on file.
 */
import { isProfileComplete, type OnboardingState } from '@kc/domain';
import type { IUserRepository } from '../ports/IUserRepository';

export interface ReconcileDeferredBasicInfoInput {
  readonly userId: string;
}

export class ReconcileDeferredBasicInfoUseCase {
  constructor(private readonly users: IUserRepository) {}

  /**
   * When basic info is complete on the server but onboarding was never advanced, returns the
   * new onboarding state after persisting it. Otherwise `null` (no change).
   */
  async execute(input: ReconcileDeferredBasicInfoInput): Promise<OnboardingState | null> {
    const { state } = await this.users.getOnboardingBootstrap(input.userId);
    if (state !== 'pending_basic_info') return null;

    const user = await this.users.findById(input.userId);
    if (!user || user.dateOfBirth === null || !isProfileComplete(user)) return null;

    // `isProfileComplete` requires avatar (FR-VERIFY-012), so onboarding can jump to completed.
    await this.users.setOnboardingState(input.userId, 'completed');
    return 'completed';
  }
}
