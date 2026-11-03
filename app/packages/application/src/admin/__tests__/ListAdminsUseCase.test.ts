import { describe, expect, it, vi } from 'vitest';
import type { AdminGrant } from '@kc/domain';
import { ListAdminsUseCase } from '../ListAdminsUseCase';
import type { IAdminRoleRepository } from '../IAdminRoleRepository';

function makeGrant(overrides: Partial<AdminGrant> = {}): AdminGrant {
  return {
    grantId: 'g1',
    userId: 'u1',
    displayName: 'Alice',
    avatarUrl: null,
    role: 'moderator',
    scopeOrgId: null,
    grantedAt: new Date('2026-01-01T00:00:00Z'),
    grantedBy: 'admin-1',
    grantedByDisplayName: 'Root',
    revokedAt: null,
    revokedBy: null,
    lastSeenAt: new Date('2026-01-02T00:00:00Z'),
    ...overrides,
  };
}

function fakeRepo(grants: readonly AdminGrant[]): IAdminRoleRepository {
  return {
    getMyRoles: vi.fn(),
    listAdmins: vi.fn(async (_includeRevoked: boolean) => grants),
    grantRole: vi.fn(),
    revokeRole: vi.fn(),
    changeRole: vi.fn(),
  };
}

describe('ListAdminsUseCase', () => {
  it('returns the repo result for active-only', async () => {
    const grants = [makeGrant()];
    const uc = new ListAdminsUseCase(fakeRepo(grants));
    expect(await uc.execute({ includeRevoked: false })).toBe(grants);
  });

  it('passes the includeRevoked flag through to the repo', async () => {
    const repo = fakeRepo([]);
    const uc = new ListAdminsUseCase(repo);
    await uc.execute({ includeRevoked: true });
    expect(repo.listAdmins).toHaveBeenCalledWith(true);
  });

  it('returns empty for empty repo result', async () => {
    const uc = new ListAdminsUseCase(fakeRepo([]));
    expect(await uc.execute({ includeRevoked: false })).toEqual([]);
  });
});
