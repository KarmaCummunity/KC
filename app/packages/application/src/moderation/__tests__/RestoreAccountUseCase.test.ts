import { describe, it, expect } from 'vitest';
import { RestoreAccountUseCase } from '../RestoreAccountUseCase';
import { RestoreAccountError } from '../errors';
import { FakeAccountGateRepository } from './fakeAccountGateRepository';

describe('RestoreAccountUseCase (FR-AUTH-016)', () => {
  it('asks the repository to restore the signed-in account', async () => {
    const repo = new FakeAccountGateRepository();
    await new RestoreAccountUseCase(repo).execute();
    expect(repo.restoreCalls).toBe(1);
  });

  it('lets the typed error through so the UI can show the reason', async () => {
    const repo = new FakeAccountGateRepository();
    repo.restoreError = new RestoreAccountError('grace_expired');
    await expect(new RestoreAccountUseCase(repo).execute()).rejects.toMatchObject({
      name: 'RestoreAccountError',
      code: 'grace_expired',
    });
  });
});
