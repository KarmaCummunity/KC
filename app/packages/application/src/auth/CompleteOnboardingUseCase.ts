/** FR-AUTH-012 AC3: Set onboarding_state to 'completed'. Idempotent. */
import type { IUserRepository } from '../ports/IUserRepository';
import { OnboardingError } from './errors';

export interface CompleteOnboardingInput {
  readonly userId: string;
}

export class CompleteOnboardingUseCase {
  constructor(private readonly users: IUserRepository) {}

  async execute(input: CompleteOnboardingInput): Promise<void> {
    // Audit §17.3 — only pending_avatar (normal flow) or completed (idempotent
    // re-run) are allowed as source states. 'pending_basic_info' would skip
    // the avatar step entirely and is rejected.
    const { state } = await this.users.getOnboardingBootstrap(input.userId);
    if (state === 'pending_basic_info') {
      throw new OnboardingError(
        'illegal_transition',
        `cannot complete onboarding from state '${state}' — basic info step required first`,
      );
    }
    await this.users.setOnboardingState('completed');
  }
}
