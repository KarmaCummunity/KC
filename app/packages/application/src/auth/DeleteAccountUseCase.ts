// FR-SETTINGS-012 V1 — self-delete the currently authenticated user.

import type { IUserRepository } from '../ports/IUserRepository';

export type IDeleteAccountUserRepository = Pick<IUserRepository, 'deleteAccountViaEdgeFunction'>;

export class DeleteAccountUseCase {
  constructor(private readonly repo: IDeleteAccountUserRepository) {}

  async execute(): Promise<void> {
    await this.repo.deleteAccountViaEdgeFunction();
  }
}
