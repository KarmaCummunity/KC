import { describe, expect, it, vi } from 'vitest';
import { AdminRoleError, type AdminRole, type GrantableAdminRole } from '@kc/domain';
import { ChangeAdminRoleUseCase } from '../ChangeAdminRoleUseCase';
import type { IAdminRoleRepository } from '../IAdminRoleRepository';

function fakeRepo(
  opts: { roles?: readonly AdminRole[]; changeError?: Error } = {},
): IAdminRoleRepository {
  return {
    getMyRoles: vi.fn(async (): Promise<readonly AdminRole[]> => opts.roles ?? ['org_admin']),
    listAdmins: vi.fn(),
    grantRole: vi.fn(),
    revokeRole: vi.fn(),
    changeRole: vi.fn(async () => {
      if (opts.changeError) throw opts.changeError;
      return 'new-grant';
    }),
  };
}

describe('ChangeAdminRoleUseCase', () => {
  it('returns the new grant id from the repository', async () => {
    const repo = fakeRepo();
    const out = await new ChangeAdminRoleUseCase(repo).execute({ grantId: 'g1', newRole: 'org_manager' });
    expect(out).toBe('new-grant');
    expect(repo.changeRole).toHaveBeenCalledWith('g1', 'org_manager');
  });

  it('rejects an empty grant id and super_admin without calling the repo', async () => {
    const repo = fakeRepo();
    const uc = new ChangeAdminRoleUseCase(repo);
    await expect(uc.execute({ grantId: '', newRole: 'org_manager' }))
      .rejects.toMatchObject({ code: 'invalid_input' });
    await expect(uc.execute({ grantId: 'g1', newRole: 'super_admin' as unknown as GrantableAdminRole }))
      .rejects.toMatchObject({ code: 'invalid_role' });
    expect(repo.changeRole).not.toHaveBeenCalled();
  });

  it('throws forbidden for a caller without team-management permissions', async () => {
    const repo = fakeRepo({ roles: ['moderator', 'org_volunteer'] });
    await expect(new ChangeAdminRoleUseCase(repo).execute({ grantId: 'g1', newRole: 'org_manager' }))
      .rejects.toMatchObject({ code: 'forbidden' });
    expect(repo.changeRole).not.toHaveBeenCalled();
  });

  it('propagates a repository AdminRoleError unchanged', async () => {
    const err = new AdminRoleError('role_already_active');
    await expect(new ChangeAdminRoleUseCase(fakeRepo({ changeError: err }))
      .execute({ grantId: 'g1', newRole: 'org_employee' })).rejects.toBe(err);
  });
});
