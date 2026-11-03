import { describe, it, expect } from 'vitest';
import { DeleteAccountUseCase } from '../DeleteAccountUseCase';
import { DeleteAccountError } from '../errors';
import { FakeUserRepositoryForDeleteAccount } from './fakeUserRepositoryForDeleteAccount';

describe('DeleteAccountUseCase', () => {
  it('invokes the repo once on success', async () => {
    const repo = new FakeUserRepositoryForDeleteAccount();
    const uc = new DeleteAccountUseCase(repo);
    await uc.execute();
    expect(repo.deleteAccountCallCount).toBe(1);
  });

  it('propagates DeleteAccountError unchanged', async () => {
    const repo = new FakeUserRepositoryForDeleteAccount();
    repo.errorToThrow = new DeleteAccountError('suspended', 'blocked');
    const uc = new DeleteAccountUseCase(repo);
    await expect(uc.execute()).rejects.toBeInstanceOf(DeleteAccountError);
    await expect(uc.execute()).rejects.toMatchObject({ code: 'suspended' });
  });

  it('does not retry or swallow auth_delete_failed', async () => {
    const repo = new FakeUserRepositoryForDeleteAccount();
    repo.errorToThrow = new DeleteAccountError('auth_delete_failed', 'half-deleted');
    const uc = new DeleteAccountUseCase(repo);
    await expect(uc.execute()).rejects.toMatchObject({ code: 'auth_delete_failed' });
    expect(repo.deleteAccountCallCount).toBe(1);
  });
});
