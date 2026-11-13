import { describe, expect, it } from 'vitest';
import {
  PERMISSION_MATRIX, ADMIN_PERMISSIONS, hasPermission, permissionsOfRole,
  type AdminPermission,
} from '../AdminPermission';
import { KNOWN_ADMIN_ROLES } from '../AdminRole';

describe('AdminPermission matrix', () => {
  it('every permission lists at least one role', () => {
    for (const perm of ADMIN_PERMISSIONS) {
      expect(PERMISSION_MATRIX[perm].length).toBeGreaterThan(0);
    }
  });

  it('super_admin appears in every permission', () => {
    for (const perm of ADMIN_PERMISSIONS) {
      expect(PERMISSION_MATRIX[perm]).toContain('super_admin');
    }
  });

  it('every role in the matrix is a KNOWN_ADMIN_ROLE', () => {
    for (const perm of ADMIN_PERMISSIONS) {
      for (const role of PERMISSION_MATRIX[perm]) {
        expect(KNOWN_ADMIN_ROLES).toContain(role);
      }
    }
  });

  it('hasPermission returns true when any of the user roles is allowed', () => {
    const perm: AdminPermission = 'reports.view';
    expect(hasPermission(['support'], perm)).toBe(true);
    expect(hasPermission(['moderator'], perm)).toBe(true);
    expect(hasPermission([], perm)).toBe(false);
  });

  it('match quality is visible to super_admin and moderator only (FR-ADMIN-029)', () => {
    expect(hasPermission(['super_admin'], 'matching.view_quality')).toBe(true);
    expect(hasPermission(['moderator'], 'matching.view_quality')).toBe(true);
    expect(hasPermission(['support'], 'matching.view_quality')).toBe(false);
  });

  it('moderator cannot grant_role; super_admin can', () => {
    expect(hasPermission(['moderator'], 'admins.grant_role')).toBe(false);
    expect(hasPermission(['super_admin'], 'admins.grant_role')).toBe(true);
  });

  it('org admins and managers run their org team (D86); org members do not', () => {
    for (const role of ['org_admin', 'org_manager', 'volunteer_manager', 'operators_manager'] as const) {
      expect(hasPermission([role], 'admins.view')).toBe(true);
      expect(hasPermission([role], 'admins.grant_role')).toBe(true);
      expect(hasPermission([role], 'reports.view')).toBe(false);
    }
    expect(hasPermission(['org_volunteer'], 'admins.view')).toBe(false);
    expect(hasPermission(['org_employee'], 'admins.grant_role')).toBe(false);
  });

  it('gives the platform admin the portal and every moderator power, not the super admin ones', () => {
    expect(hasPermission(['admin'], 'portal.access')).toBe(true);
    expect(hasPermission(['admin'], 'reports.confirm_or_dismiss')).toBe(true);
    expect(hasPermission(['admin'], 'admins.grant_role')).toBe(true);
    expect(hasPermission(['admin'], 'reports.permanent_ban')).toBe(false);
    expect(hasPermission(['admin'], 'audit.view_any')).toBe(false);
  });

  it('mirrors the finance gates: moderators read, admins and treasurers keep, accountants read (FR-FIN-002)', () => {
    expect(hasPermission(['moderator'], 'money.view')).toBe(true);
    expect(hasPermission(['moderator'], 'money.manage')).toBe(false);
    expect(hasPermission(['org_treasurer'], 'money.manage')).toBe(true);
    expect(hasPermission(['org_accountant'], 'money.view')).toBe(true);
    expect(hasPermission(['org_accountant'], 'money.manage')).toBe(false);
    expect(hasPermission(['org_treasurer'], 'money.transparency')).toBe(false);
    expect(hasPermission(['admin'], 'money.transparency')).toBe(true);
    expect(hasPermission(['support'], 'money.view')).toBe(false);
  });

  it('opens organization applications to admins and up only (20_organizations)', () => {
    expect(hasPermission(['moderator'], 'org.review_applications')).toBe(false);
    expect(hasPermission(['admin'], 'org.review_applications')).toBe(true);
    expect(hasPermission(['super_admin'], 'org.review_applications')).toBe(true);
  });

  it('permissionsOfRole lists exactly the matrix rows that include the role', () => {
    expect(permissionsOfRole('org_volunteer')).toEqual([]);
    expect(permissionsOfRole('org_manager')).toEqual([
      'admins.view', 'admins.grant_role', 'admins.revoke_role', 'admins.set_manager', 'crm.manage',
    ]);
    expect(permissionsOfRole('super_admin')).toEqual([...ADMIN_PERMISSIONS]);
  });

  it('crm.manage reaches the organization managers but not their employees (FR-ADMIN-032)', () => {
    expect(hasPermission(['org_admin'], 'crm.manage')).toBe(true);
    expect(hasPermission(['org_manager'], 'crm.manage')).toBe(true);
    expect(hasPermission(['org_employee'], 'crm.manage')).toBe(false);
    expect(hasPermission(['support'], 'crm.manage')).toBe(false);
  });

  it('chat.delete_message is granted to super_admin and moderator only', () => {
    expect(hasPermission(['super_admin'], 'chat.delete_message')).toBe(true);
    expect(hasPermission(['moderator'], 'chat.delete_message')).toBe(true);
    expect(hasPermission(['support'], 'chat.delete_message')).toBe(false);
    expect(hasPermission([], 'chat.delete_message')).toBe(false);
  });
});

  it('whatsapp.manage is moderator+; support cannot', () => {
    expect(hasPermission(['moderator'], 'whatsapp.manage')).toBe(true);
    expect(hasPermission(['super_admin'], 'whatsapp.manage')).toBe(true);
    expect(hasPermission(['support'], 'whatsapp.manage')).toBe(false);
  });
