// FR-SETTINGS-012 / FR-AUTH-016 — the currently authenticated user asks for the account to be
// deleted: it is deactivated at once and purged after the 30-day grace period unless restored.

import type { IUserRepository } from '../ports/IUserRepository';

export type IDeleteAccountUserRepository = Pick<IUserRepository, 'requestAccountDeletion'>;

export class DeleteAccountUseCase {
  constructor(private readonly repo: IDeleteAccountUserRepository) {}

  async execute(): Promise<void> {
    await this.repo.requestAccountDeletion();
  }
}
