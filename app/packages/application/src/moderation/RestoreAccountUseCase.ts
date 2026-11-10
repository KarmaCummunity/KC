/** FR-AUTH-016 — restore the signed-in user's account within its 30-day grace period. */
import type { IAccountGateRepository } from '../ports/IAccountGateRepository';

export class RestoreAccountUseCase {
  constructor(private readonly repo: IAccountGateRepository) {}

  /** Throws `RestoreAccountError` when the account cannot be restored. */
  async execute(): Promise<void> {
    await this.repo.restoreAccount();
  }
}
