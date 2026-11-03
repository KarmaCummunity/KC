import { describe, expect, it, vi } from 'vitest';
import { AdminRoleError } from '@kc/domain';
import { RevokeAdminRoleUseCase } from '../RevokeAdminRoleUseCase';
import type { IAdminRoleRepository } from '../IAdminRoleRepository';

function fakeRepo(opts: { revokeRoleError?: Error } = {}): IAdminRoleRepository {
  return {
    getMyRoles: vi.fn(),
    listAdmins: vi.fn(),
    grantRole: vi.fn(),
    revokeRole: vi.fn(async () => {
      if (opts.revokeRoleError) throw opts.revokeRoleError;
    }),
    changeRole: vi.fn(),
  };
}

describe('RevokeAdminRoleUseCase', () => {
  it('calls repo.revokeRole with the grantId', async () => {
    const repo = fakeRepo();
    const uc = new RevokeAdminRoleUseCase(repo);
    await uc.execute({ grantId: 'g1' });
    expect(repo.revokeRole).toHaveBeenCalledWith('g1');
  });

  it('throws invalid_input when grantId is empty', async () => {
    const uc = new RevokeAdminRoleUseCase(fakeRepo());
    await expect(uc.execute({ grantId: '' })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('propagates AdminRoleError from the repo (e.g., cannot_revoke_last_super_admin)', async () => {
    const err = new AdminRoleError('cannot_revoke_last_super_admin');
    const uc = new RevokeAdminRoleUseCase(fakeRepo({ revokeRoleError: err }));
    await expect(uc.execute({ grantId: 'g1' })).rejects.toBe(err);
  });

  it('does not call repo when input fails validation', async () => {
    const repo = fakeRepo();
    const uc = new RevokeAdminRoleUseCase(repo);
    await expect(uc.execute({ grantId: '' })).rejects.toBeInstanceOf(AdminRoleError);
    expect(repo.revokeRole).not.toHaveBeenCalled();
  });
});
