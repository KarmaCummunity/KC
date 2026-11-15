// Use cases for organizations, first slice (FR-ORG-002, G18). Each one is thin: the server
// (0730) holds every rule; the domain checks an application before it is sent, so the form can
// name the failing field without a round trip.
import {
  OrgError,
  validateOrgApplication,
  type MyOrganization,
  type MyOrgApplication,
  type OrgMember,
  type OrgMemberRole,
  type SubmitOrgApplicationInput,
} from '@kc/domain';
import type { IOrganizationsRepository } from './IOrganizationsRepository';

export class SubmitOrgApplicationUseCase {
  constructor(private readonly repo: IOrganizationsRepository) {}

  /** Throws `OrgError` with the first failing field's code before calling the server. */
  async execute(input: SubmitOrgApplicationInput): Promise<string> {
    const invalid = validateOrgApplication(input);
    if (invalid) throw new OrgError(invalid);
    return this.repo.submitApplication({
      orgName: input.orgName.trim(),
      orgDescription: input.orgDescription.trim(),
      contactEmail: input.contactEmail.trim(),
      contactPhone: input.contactPhone?.trim() || null,
      websiteUrl: input.websiteUrl?.trim() || null,
      declaredNonprofit: input.declaredNonprofit,
    });
  }
}

export class GetMyOrgApplicationUseCase {
  constructor(private readonly repo: IOrganizationsRepository) {}
  execute(): Promise<MyOrgApplication | null> {
    return this.repo.getMyLatestApplication();
  }
}

export class ListMyOrganizationsWithRolesUseCase {
  constructor(private readonly repo: IOrganizationsRepository) {}
  execute(): Promise<MyOrganization[]> {
    return this.repo.listMyOrganizations();
  }
}

export class ListOrgMembersUseCase {
  constructor(private readonly repo: IOrganizationsRepository) {}
  execute(orgId: string): Promise<OrgMember[]> {
    return this.repo.listMembers(orgId);
  }
}

export class AddOrgMemberUseCase {
  constructor(private readonly repo: IOrganizationsRepository) {}

  /** An empty handle never reaches the server (`org_member_user_not_found`). */
  async execute(input: { orgId: string; shareHandle: string; role: OrgMemberRole }): Promise<void> {
    const handle = input.shareHandle.trim().replace(/^@/, '');
    if (handle === '') throw new OrgError('org_member_user_not_found');
    await this.repo.addMember(input.orgId, handle, input.role);
  }
}

export class RemoveOrgMemberUseCase {
  constructor(private readonly repo: IOrganizationsRepository) {}
  async execute(input: { orgId: string; userId: string }): Promise<void> {
    await this.repo.removeMember(input.orgId, input.userId);
  }
}
