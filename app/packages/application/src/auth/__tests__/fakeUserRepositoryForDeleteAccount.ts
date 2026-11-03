// In-memory fake covering only deleteAccountViaEdgeFunction for DeleteAccountUseCase tests.

import type { IDeleteAccountUserRepository } from '../DeleteAccountUseCase';
import { DeleteAccountError } from '../errors';

export class FakeUserRepositoryForDeleteAccount implements IDeleteAccountUserRepository {
  deleteAccountCallCount = 0;
  errorToThrow: DeleteAccountError | null = null;

  deleteAccountViaEdgeFunction = async (): Promise<void> => {
    this.deleteAccountCallCount += 1;
    if (this.errorToThrow) throw this.errorToThrow;
  };
}
