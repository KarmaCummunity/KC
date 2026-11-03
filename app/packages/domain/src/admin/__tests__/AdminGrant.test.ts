import { describe, expect, it } from 'vitest';
import {
  fitsGrantScope,
  GRANTABLE_ADMIN_ROLES,
  isAdminGrantActive,
  isGrantableAdminRole,
  type AdminGrant,
} from '../AdminGrant';
import type { AdminRole } from '../AdminRole';

function grant(overrides: Partial<AdminGrant> = {}): AdminGrant {
  return {
    grantId: 'g1',
    userId: 'u1',
    displayName: 'Nave',
    avatarUrl: null,
    role: 'moderator',
    scopeOrgId: null,
    grantedAt: new Date('2026-01-01T00:00:00Z'),
    grantedBy: 'admin',
    grantedByDisplayName: 'Admin',
    revokedAt: null,
    revokedBy: null,
    lastSeenAt: null,
    ...overrides,
  };
}

describe('AdminGrant', () => {
  it('isAdminGrantActive is true when revokedAt is null', () => {
    expect(isAdminGrantActive(grant())).toBe(true);
  });

  it('isAdminGrantActive is false when revokedAt is set', () => {
    expect(isAdminGrantActive(grant({ revokedAt: new Date('2026-02-01T00:00:00Z') }))).toBe(false);
  });

  it('GRANTABLE_ADMIN_ROLES lists every role except super_admin', () => {
    expect(GRANTABLE_ADMIN_ROLES).toHaveLength(9);
    expect(GRANTABLE_ADMIN_ROLES).not.toContain('super_admin');
  });

  it('isGrantableAdminRole rejects only super_admin', () => {
    expect(isGrantableAdminRole('moderator')).toBe(true);
    expect(isGrantableAdminRole('org_volunteer')).toBe(true);
    expect(isGrantableAdminRole('super_admin' as AdminRole)).toBe(false);
  });

  it('fitsGrantScope: platform roles need no org, org roles need one', () => {
    expect(fitsGrantScope('moderator', null)).toBe(true);
    expect(fitsGrantScope('moderator', 'org-a')).toBe(false);
    expect(fitsGrantScope('org_manager', 'org-a')).toBe(true);
    expect(fitsGrantScope('operator', null)).toBe(false);
  });
});
