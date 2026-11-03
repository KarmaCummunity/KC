import { describe, expect, it, vi } from 'vitest';
import { type AdminRole, type OrgTreeMember } from '@kc/domain';
import { SetManagerUseCase } from '../SetManagerUseCase';
import type { IOrgHierarchyRepository } from '../IOrgHierarchyRepository';
import type { IAdminRoleRepository } from '../IAdminRoleRepository';

function hierarchyRepo(setManagerError?: Error): IOrgHierarchyRepository {
  return {
    getOrgTree: vi.fn(async (): Promise<readonly OrgTreeMember[]> => []),
    setManager: vi.fn(async () => {
      if (setManagerError) throw setManagerError;
    }),
    getHierarchyCensus: vi.fn(),
  };
}

function roleRepo(roles: readonly AdminRole[]): IAdminRoleRepository {
  return {
    getMyRoles: vi.fn(async (): Promise<readonly AdminRole[]> => roles),
    listAdmins: vi.fn(),
    grantRole: vi.fn(),
    revokeRole: vi.fn(),
    changeRole: vi.fn(),
  };
}

describe('SetManagerUseCase', () => {
  it('delegates to the repository for an authorized caller', async () => {
    const repo = hierarchyRepo();
    const uc = new SetManagerUseCase(repo, roleRepo(['super_admin']));
    await uc.execute({ grantId: 'g1', managerGrantId: 'm1' });
    expect(repo.setManager).toHaveBeenCalledWith('g1', 'm1');
  });

  it('allows clearing the manager (null)', async () => {
    const repo = hierarchyRepo();
    const uc = new SetManagerUseCase(repo, roleRepo(['org_admin']));
    await uc.execute({ grantId: 'g1', managerGrantId: null });
    expect(repo.setManager).toHaveBeenCalledWith('g1', null);
  });

  it('throws invalid_input when grantId is empty', async () => {
    const uc = new SetManagerUseCase(hierarchyRepo(), roleRepo(['super_admin']));
    await expect(uc.execute({ grantId: '', managerGrantId: 'm1' })).rejects.toMatchObject({
      code: 'invalid_input',
    });
  });

  it('throws invalid_manager when a grant is set as its own manager', async () => {
    const uc = new SetManagerUseCase(hierarchyRepo(), roleRepo(['super_admin']));
    await expect(uc.execute({ grantId: 'g1', managerGrantId: 'g1' })).rejects.toMatchObject({
      code: 'invalid_manager',
    });
  });

  it('throws forbidden_manage and does NOT mutate when caller lacks the permission', async () => {
    const repo = hierarchyRepo();
    const uc = new SetManagerUseCase(repo, roleRepo(['support']));
    await expect(uc.execute({ grantId: 'g1', managerGrantId: 'm1' })).rejects.toMatchObject({
      code: 'forbidden_manage',
    });
    expect(repo.setManager).not.toHaveBeenCalled();
  });
});
