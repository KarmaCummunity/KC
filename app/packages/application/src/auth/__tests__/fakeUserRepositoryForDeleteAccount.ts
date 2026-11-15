// In-memory fake covering only requestAccountDeletion for DeleteAccountUseCase tests.

import type { IDeleteAccountUserRepository } from '../DeleteAccountUseCase';
import { DeleteAccountError } from '../errors';

export class FakeUserRepositoryForDeleteAccount implements IDeleteAccountUserRepository {
  deleteAccountCallCount = 0;
  errorToThrow: DeleteAccountError | null = null;

  requestAccountDeletion = async (): Promise<void> => {
    this.deleteAccountCallCount += 1;
    if (this.errorToThrow) throw this.errorToThrow;
  };
}
