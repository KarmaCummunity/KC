// Organizations, first slice (docs/spec/requirements/20_organizations.md FR-ORG-002, G18): a
// member applies to register an organization, an approval creates it with the applicant as its
// first admin, and its admins and managers manage the members who may publish its events.
// Server copy: supabase/migrations/0730_org_registration.sql.
import type { OrgApplicationStatus } from '../admin/OrgApplication';
import { DomainError } from '../errors';

/** Roles a member can hold, strongest first (`org_memberships.role`). */
export const ORG_MEMBER_ROLES = ['org_admin', 'org_manager', 'org_employee', 'org_volunteer'] as const;
export type OrgMemberRole = (typeof ORG_MEMBER_ROLES)[number];

/** The signed-in member's latest application to register an organization. */
export interface MyOrgApplication {
  readonly applicationId: string;
  readonly orgName: string;
  readonly status: OrgApplicationStatus;
  readonly createdAt: string;
  readonly reviewedAt: string | null;
  readonly reviewNote: string | null;
  /** The organization the approval created. */
  readonly orgId: string | null;
}

export interface SubmitOrgApplicationInput {
  readonly orgName: string;
  readonly orgDescription: string;
  readonly contactEmail: string;
  readonly contactPhone: string | null;
  readonly websiteUrl: string | null;
  readonly declaredNonprofit: boolean;
}

/** An organization the signed-in member belongs to, with their role in it. */
export interface MyOrganization {
  readonly orgId: string;
  readonly name: string;
  readonly slug: string;
  readonly role: OrgMemberRole;
}

export interface OrgMember {
  readonly userId: string;
  readonly displayName: string;
  readonly shareHandle: string;
  readonly avatarUrl: string | null;
  readonly role: OrgMemberRole;
  readonly joinedAt: string;
}

/** Codes equal the server's (0730), so one copy table translates both. */
export type OrgErrorCode =
  | 'org_name_invalid'
  | 'org_description_required'
  | 'org_contact_email_invalid'
  | 'org_website_invalid'
  | 'org_nonprofit_declaration_required'
  | 'org_application_pending_exists'
  | 'org_application_resubmit_too_soon'
  | 'org_not_member'
  | 'org_member_manage_forbidden'
  | 'org_role_invalid'
  | 'org_member_user_not_found'
  | 'org_member_not_found'
  | 'org_last_admin'
  | 'unknown';

export class OrgError extends DomainError {
  readonly code: OrgErrorCode;

  constructor(code: OrgErrorCode, message?: string) {
    super(message ? `${code}: ${message}` : code, { code });
    this.code = code;
  }
}

/** Type guard for a stored role (an older `volunteer` row reads as not a known role). */
export function isOrgMemberRole(value: unknown): value is OrgMemberRole {
  return typeof value === 'string' && (ORG_MEMBER_ROLES as readonly string[]).includes(value);
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const SECURE_URL = /^https:\/\/[^\s@]+$/;

/**
 * Checks an application before it is sent, with the server's rules (0730
 * `submit_org_application`), so the form can point at the field. Returns the first failing code,
 * or null when the input is valid.
 */
export function validateOrgApplication(input: SubmitOrgApplicationInput): OrgErrorCode | null {
  const name = input.orgName.trim();
  if (name.length < 2 || name.length > 120) return 'org_name_invalid';
  const about = input.orgDescription.trim();
  if (about.length === 0 || about.length > 4000) return 'org_description_required';
  if (!EMAIL.test(input.contactEmail.trim())) return 'org_contact_email_invalid';
  const site = input.websiteUrl?.trim() ?? '';
  if (site !== '' && !SECURE_URL.test(site)) return 'org_website_invalid';
  if (!input.declaredNonprofit) return 'org_nonprofit_declaration_required';
  return null;
}

/**
 * Whether a member with `myRole` may give `role` to someone (0730 `org_add_member`): an admin
 * gives any role; a manager gives employee and volunteer roles; others give none.
 */
export function canAssignOrgRole(myRole: OrgMemberRole | null, role: OrgMemberRole): boolean {
  if (myRole === 'org_admin') return true;
  if (myRole === 'org_manager') return role === 'org_employee' || role === 'org_volunteer';
  return false;
}

/**
 * Whether a member with `myRole` may remove a member holding `targetRole` (0730
 * `org_remove_member`). Anyone may leave; the last-admin rule is the server's to check, since it
 * depends on the other members.
 */
export function canRemoveOrgMember(
  myRole: OrgMemberRole | null,
  targetRole: OrgMemberRole,
  isSelf: boolean,
): boolean {
  if (isSelf) return true;
  return canAssignOrgRole(myRole, targetRole);
}

/** Whether the role may manage the member list at all (add, change a role, remove). */
export function canManageOrgMembers(myRole: OrgMemberRole | null): boolean {
  return myRole === 'org_admin' || myRole === 'org_manager';
}
