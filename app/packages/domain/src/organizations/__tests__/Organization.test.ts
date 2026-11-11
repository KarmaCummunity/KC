import { describe, expect, it } from 'vitest';
import {
  canAssignOrgRole,
  canManageOrgMembers,
  canRemoveOrgMember,
  isOrgMemberRole,
  OrgError,
  validateOrgApplication,
  type SubmitOrgApplicationInput,
} from '../Organization';

const valid: SubmitOrgApplicationInput = {
  orgName: 'בנק המזון',
  orgDescription: 'We collect and share surplus food.',
  contactEmail: 'team@foodbank.org.il',
  contactPhone: null,
  websiteUrl: 'https://foodbank.org.il',
  declaredNonprofit: true,
};

describe('validateOrgApplication', () => {
  it('accepts a complete application', () => {
    expect(validateOrgApplication(valid)).toBeNull();
    expect(validateOrgApplication({ ...valid, websiteUrl: null })).toBeNull();
  });

  it('names the first failing field with the server code', () => {
    expect(validateOrgApplication({ ...valid, orgName: ' a ' })).toBe('org_name_invalid');
    expect(validateOrgApplication({ ...valid, orgDescription: '  ' })).toBe('org_description_required');
    expect(validateOrgApplication({ ...valid, contactEmail: 'team' })).toBe('org_contact_email_invalid');
    expect(validateOrgApplication({ ...valid, websiteUrl: 'http://foodbank.org.il' })).toBe('org_website_invalid');
    expect(validateOrgApplication({ ...valid, declaredNonprofit: false })).toBe('org_nonprofit_declaration_required');
  });
});

describe('member roles', () => {
  it('lets an admin give any role and a manager only employee and volunteer roles', () => {
    expect(canAssignOrgRole('org_admin', 'org_admin')).toBe(true);
    expect(canAssignOrgRole('org_manager', 'org_volunteer')).toBe(true);
    expect(canAssignOrgRole('org_manager', 'org_manager')).toBe(false);
    expect(canAssignOrgRole('org_volunteer', 'org_volunteer')).toBe(false);
    expect(canAssignOrgRole(null, 'org_volunteer')).toBe(false);
  });

  it('lets anyone leave and only managers remove others', () => {
    expect(canRemoveOrgMember('org_volunteer', 'org_volunteer', true)).toBe(true);
    expect(canRemoveOrgMember('org_volunteer', 'org_volunteer', false)).toBe(false);
    expect(canRemoveOrgMember('org_manager', 'org_admin', false)).toBe(false);
    expect(canRemoveOrgMember('org_admin', 'org_manager', false)).toBe(true);
  });

  it('reads manage rights and stored roles', () => {
    expect(canManageOrgMembers('org_manager')).toBe(true);
    expect(canManageOrgMembers('org_employee')).toBe(false);
    expect(isOrgMemberRole('volunteer')).toBe(false);
    expect(isOrgMemberRole('org_employee')).toBe(true);
  });
});

describe('OrgError', () => {
  it('carries the server code', () => {
    const error = new OrgError('org_last_admin');
    expect(error.code).toBe('org_last_admin');
    expect(error.message).toBe('org_last_admin');
  });
});
