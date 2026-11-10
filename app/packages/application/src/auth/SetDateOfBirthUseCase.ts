/** FR-AUTH-010 AC2.d / FR-AUTH-015 AC1.b — validate and store the signed-in member's date of birth. */
import { dateOfBirthIssue } from '@kc/domain';
import type { IUserRepository } from '../ports/IUserRepository';
import { assertSessionUser } from './assertSessionUser';
import { ProfileError } from './errors';

export interface SetDateOfBirthInput {
  readonly sessionUserId: string;
  readonly userId: string;
  /** ISO `YYYY-MM-DD`. */
  readonly dateOfBirth: string;
}

export class SetDateOfBirthUseCase {
  constructor(
    private readonly users: IUserRepository,
    /** Injected so the 18+ check is testable on any date. */
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(input: SetDateOfBirthInput): Promise<void> {
    assertSessionUser(input.sessionUserId, input.userId);
    const issue = dateOfBirthIssue(input.dateOfBirth, this.now());
    if (issue) throw new ProfileError(issue);
    await this.users.setDateOfBirth(input.dateOfBirth);
  }
}
