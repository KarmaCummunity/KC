import { describe, expect, it } from 'vitest';
import { KNOWN_ADMIN_ROLES, parseAdminRole, type AdminRole } from '../AdminRole';

describe('AdminRole', () => {
  it('KNOWN_ADMIN_ROLES exposes the three A0 platform roles', () => {
    for (const r of ['super_admin', 'moderator', 'support'] as const) {
      expect(KNOWN_ADMIN_ROLES).toContain(r);
    }
  });

  it('knows every role of the database vocabulary (kc_private.admin_roles)', () => {
    for (const r of ['admin', 'org_treasurer', 'org_accountant', 'volunteer'] as const) {
      expect(parseAdminRole(r)).toBe<AdminRole>(r);
    }
    expect(KNOWN_ADMIN_ROLES).toHaveLength(14);
  });

  it('parseAdminRole returns the role for a known string', () => {
    expect(parseAdminRole('moderator')).toBe<AdminRole>('moderator');
  });

  it('parseAdminRole returns null for an unknown string', () => {
    expect(parseAdminRole('emperor')).toBeNull();
    expect(parseAdminRole(null)).toBeNull();
    expect(parseAdminRole(undefined)).toBeNull();
  });
});
