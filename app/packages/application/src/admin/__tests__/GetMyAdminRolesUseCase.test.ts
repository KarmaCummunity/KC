import { describe, expect, it, vi } from 'vitest';
import type { AdminRole } from '@kc/domain';
import { GetMyAdminRolesUseCase } from '../GetMyAdminRolesUseCase';
import type { IAdminRoleRepository } from '../IAdminRoleRepository';

function fakeRepo(roles: readonly AdminRole[]): IAdminRoleRepository {
  return {
    getMyRoles: vi.fn().mockResolvedValue(roles),
    listAdmins: vi.fn(),
    grantRole: vi.fn(),
    revokeRole: vi.fn(),
    changeRole: vi.fn(),
  };
}

describe('GetMyAdminRolesUseCase', () => {
  it('returns the repo result', async () => {
    const uc = new GetMyAdminRolesUseCase(fakeRepo(['moderator']));
    expect(await uc.execute()).toEqual(['moderator']);
  });

  it('returns an empty array when the user has no grants', async () => {
    const uc = new GetMyAdminRolesUseCase(fakeRepo([]));
    expect(await uc.execute()).toEqual([]);
  });
});
