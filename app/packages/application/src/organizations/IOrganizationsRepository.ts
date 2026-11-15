// Port for organizations, first slice (FR-ORG-002, G18). Implemented by
// `SupabaseOrganizationsRepository` over migration 0730. Failures surface as `OrgError`.
import type {
  MyOrganization,
  MyOrgApplication,
  OrgMember,
  OrgMemberRole,
  SubmitOrgApplicationInput,
} from '@kc/domain';

export interface IOrganizationsRepository {
  /** Sends an application to register an organization; returns its id. */
  submitApplication(input: SubmitOrgApplicationInput): Promise<string>;
  /** The signed-in member's latest application, or null when they never applied. */
  getMyLatestApplication(): Promise<MyOrgApplication | null>;
  /** The organizations the signed-in member belongs to, with their role. */
  listMyOrganizations(): Promise<MyOrganization[]>;
  /** An organization's members (members only). */
  listMembers(orgId: string): Promise<OrgMember[]>;
  /** Adds a member by share handle, or changes their role. */
  addMember(orgId: string, shareHandle: string, role: OrgMemberRole): Promise<void>;
  /** Removes a member; the signed-in member's own id leaves the organization. */
  removeMember(orgId: string, userId: string): Promise<void>;
}
