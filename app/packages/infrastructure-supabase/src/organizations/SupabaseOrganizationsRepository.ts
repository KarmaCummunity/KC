// Supabase adapter for organizations, first slice (FR-ORG-002, G18), over migration 0730.
// Server error messages are the domain's `OrgErrorCode`s; anything else maps to `unknown`.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { IOrganizationsRepository } from '@kc/application';
import {
  isOrgMemberRole,
  OrgError,
  parseOrgApplicationStatus,
  type MyOrganization,
  type MyOrgApplication,
  type OrgErrorCode,
  type OrgMember,
  type OrgMemberRole,
  type SubmitOrgApplicationInput,
} from '@kc/domain';
import type { Database } from '../database.types';

type Client = SupabaseClient<Database>;
type MemberRow = Database['public']['Functions']['list_org_members']['Returns'][number];

const SERVER_CODES: ReadonlySet<OrgErrorCode> = new Set<OrgErrorCode>([
  'org_name_invalid', 'org_description_required', 'org_contact_email_invalid', 'org_website_invalid',
  'org_nonprofit_declaration_required', 'org_application_pending_exists',
  'org_application_resubmit_too_soon', 'org_not_member', 'org_member_manage_forbidden',
  'org_role_invalid', 'org_member_user_not_found', 'org_member_not_found', 'org_last_admin',
]);

/** Maps a PostgREST error to `OrgError`, keeping the server's code when it is one of ours. */
export function toOrgError(error: { message?: string } | null): OrgError {
  const message = error?.message ?? '';
  const code = [...SERVER_CODES].find((known) => message === known || message.startsWith(`${known}:`));
  return code ? new OrgError(code) : new OrgError('unknown', message);
}

/** Strongest role first, so a member with an older second row shows once. */
const ROLE_RANK: Record<OrgMemberRole, number> = {
  org_admin: 0, org_manager: 1, org_employee: 2, org_volunteer: 3,
};

export class SupabaseOrganizationsRepository implements IOrganizationsRepository {
  constructor(private readonly client: Client) {}

  async submitApplication(input: SubmitOrgApplicationInput): Promise<string> {
    const { data, error } = await this.client.rpc('submit_org_application', {
      p_org_name: input.orgName,
      p_org_description: input.orgDescription,
      p_contact_email: input.contactEmail,
      p_contact_phone: input.contactPhone ?? undefined,
      p_website_url: input.websiteUrl ?? undefined,
      p_declared_nonprofit: input.declaredNonprofit,
    });
    if (error) throw toOrgError(error);
    return data;
  }

  async getMyLatestApplication(): Promise<MyOrgApplication | null> {
    // RLS returns only the caller's own applications (0168 `org_applications_select_self`).
    const { data, error } = await this.client
      .from('org_applications')
      .select('application_id, org_name, status, created_at, reviewed_at, review_note, org_id')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw toOrgError(error);
    const status = parseOrgApplicationStatus(data?.status);
    if (!data || status === null) return null;
    return {
      applicationId: data.application_id,
      orgName: data.org_name,
      status,
      createdAt: data.created_at,
      reviewedAt: data.reviewed_at,
      reviewNote: data.review_note,
      orgId: data.org_id,
    };
  }

  async listMyOrganizations(): Promise<MyOrganization[]> {
    const { data: auth } = await this.client.auth.getUser();
    const userId = auth.user?.id;
    if (!userId) return [];
    const { data, error } = await this.client
      .from('org_memberships')
      .select('org_id, role, organizations(name, slug)')
      .eq('user_id', userId);
    if (error) throw toOrgError(error);
    const byOrg = new Map<string, MyOrganization>();
    for (const row of data ?? []) {
      if (!isOrgMemberRole(row.role) || !row.organizations) continue;
      const current = byOrg.get(row.org_id);
      if (current && ROLE_RANK[current.role] <= ROLE_RANK[row.role]) continue;
      byOrg.set(row.org_id, {
        orgId: row.org_id,
        name: row.organizations.name,
        slug: row.organizations.slug,
        role: row.role,
      });
    }
    return [...byOrg.values()].sort((a, b) => a.name.localeCompare(b.name, 'he'));
  }

  async listMembers(orgId: string): Promise<OrgMember[]> {
    const { data, error } = await this.client.rpc('list_org_members', { p_org_id: orgId });
    if (error) throw toOrgError(error);
    return (data ?? [])
      .flatMap((row: MemberRow) => (isOrgMemberRole(row.role) ? [mapMember(row, row.role)] : []))
      .sort((a, b) => ROLE_RANK[a.role] - ROLE_RANK[b.role] || a.displayName.localeCompare(b.displayName, 'he'));
  }

  async addMember(orgId: string, shareHandle: string, role: OrgMemberRole): Promise<void> {
    const { error } = await this.client.rpc('org_add_member', {
      p_org_id: orgId, p_share_handle: shareHandle, p_role: role,
    });
    if (error) throw toOrgError(error);
  }

  async removeMember(orgId: string, userId: string): Promise<void> {
    const { error } = await this.client.rpc('org_remove_member', { p_org_id: orgId, p_user_id: userId });
    if (error) throw toOrgError(error);
  }
}

function mapMember(row: MemberRow, role: OrgMemberRole): OrgMember {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    shareHandle: row.share_handle,
    avatarUrl: row.avatar_url,
    role,
    joinedAt: row.joined_at,
  };
}
