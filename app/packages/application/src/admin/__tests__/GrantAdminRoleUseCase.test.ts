import { describe, expect, it, vi } from 'vitest';
import { AdminRoleError, type AdminRole, type GrantableAdminRole } from '@kc/domain';
import { GrantAdminRoleUseCase } from '../GrantAdminRoleUseCase';
import type { IAdminRoleRepository } from '../IAdminRoleRepository';

function fakeRepo(
  opts: { grantId?: string; grantRoleError?: Error; roles?: readonly AdminRole[] } = {},
): IAdminRoleRepository {
  return {
    getMyRoles: vi.fn(async (): Promise<readonly AdminRole[]> => opts.roles ?? ['super_admin']),
    listAdmins: vi.fn(),
    grantRole: vi.fn(async () => {
      if (opts.grantRoleError) throw opts.grantRoleError;
      return opts.grantId ?? 'g1';
    }),
    revokeRole: vi.fn(),
    changeRole: vi.fn(),
  };
}

describe('GrantAdminRoleUseCase', () => {
  it('returns grant_id from repository for valid moderator grant', async () => {
    const uc = new GrantAdminRoleUseCase(fakeRepo({ grantId: 'grant-abc' }));
    const out = await uc.execute({ targetUserId: 'user-1', role: 'moderator', scopeOrgId: null });
    expect(out).toBe('grant-abc');
  });

  it('passes through for support role', async () => {
    const repo = fakeRepo({ grantId: 'g2' });
    const uc = new GrantAdminRoleUseCase(repo);
    await uc.execute({ targetUserId: 'user-2', role: 'support', scopeOrgId: null });
    expect(repo.grantRole).toHaveBeenCalledWith('user-2', 'support', null);
  });

  it('grants an org role in its org', async () => {
    const repo = fakeRepo({ roles: ['org_admin'] });
    await new GrantAdminRoleUseCase(repo).execute({ targetUserId: 'u', role: 'org_volunteer', scopeOrgId: 'org-a' });
    expect(repo.grantRole).toHaveBeenCalledWith('u', 'org_volunteer', 'org-a');
  });

  it('throws invalid_scope for a role in the wrong scope, without calling the repo', async () => {
    const repo = fakeRepo();
    const uc = new GrantAdminRoleUseCase(repo);
    await expect(uc.execute({ targetUserId: 'u', role: 'org_manager', scopeOrgId: null }))
      .rejects.toMatchObject({ code: 'invalid_scope' });
    await expect(uc.execute({ targetUserId: 'u', role: 'moderator', scopeOrgId: 'org-a' }))
      .rejects.toMatchObject({ code: 'invalid_scope' });
    expect(repo.grantRole).not.toHaveBeenCalled();
  });

  it('throws invalid_input when targetUserId is empty', async () => {
    const uc = new GrantAdminRoleUseCase(fakeRepo());
    await expect(uc.execute({ targetUserId: '', role: 'moderator', scopeOrgId: null })).rejects.toMatchObject({
      code: 'invalid_input',
    });
  });

  it('throws invalid_role when role is not grantable from UI', async () => {
    const uc = new GrantAdminRoleUseCase(fakeRepo());
    await expect(
      uc.execute({ targetUserId: 'u', role: 'super_admin' as unknown as GrantableAdminRole, scopeOrgId: null }),
    ).rejects.toMatchObject({ code: 'invalid_role' });
  });

  it('throws forbidden and does NOT grant when caller lacks super_admin', async () => {
    const repo = fakeRepo({ roles: ['moderator'] });
    const uc = new GrantAdminRoleUseCase(repo);
    await expect(
      uc.execute({ targetUserId: 'user-1', role: 'moderator', scopeOrgId: null }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(repo.grantRole).not.toHaveBeenCalled();
  });

  it('throws forbidden when caller has no admin roles', async () => {
    const repo = fakeRepo({ roles: [] });
    const uc = new GrantAdminRoleUseCase(repo);
    await expect(
      uc.execute({ targetUserId: 'user-1', role: 'support', scopeOrgId: null }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(repo.grantRole).not.toHaveBeenCalled();
  });

  it('propagates repository AdminRoleError unchanged', async () => {
    const err = new AdminRoleError('role_already_active');
    const uc = new GrantAdminRoleUseCase(fakeRepo({ grantRoleError: err }));
    await expect(uc.execute({ targetUserId: 'u', role: 'moderator', scopeOrgId: null })).rejects.toBe(err);
  });

  it('does not call repo when input fails validation', async () => {
    const repo = fakeRepo();
    const uc = new GrantAdminRoleUseCase(repo);
    await expect(uc.execute({ targetUserId: '', role: 'moderator', scopeOrgId: null })).rejects.toBeInstanceOf(AdminRoleError);
    expect(repo.grantRole).not.toHaveBeenCalled();
  });
});

