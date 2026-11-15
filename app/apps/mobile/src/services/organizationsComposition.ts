// Composition root for organizations, first slice (FR-ORG-002, G18): registering an organization,
// the member's organizations and the members screen.
import { getSupabaseClient, SupabaseOrganizationsRepository } from '@kc/infrastructure-supabase';
import {
  AddOrgMemberUseCase,
  GetMyOrgApplicationUseCase,
  ListMyOrganizationsWithRolesUseCase,
  ListOrgMembersUseCase,
  RemoveOrgMemberUseCase,
  SubmitOrgApplicationUseCase,
  type IOrganizationsRepository,
} from '@kc/application';
import { pickAuthStorage } from './authSecureStorage';

let repo: IOrganizationsRepository | null = null;

function organizationsRepository(): IOrganizationsRepository {
  if (!repo) repo = new SupabaseOrganizationsRepository(getSupabaseClient({ storage: pickAuthStorage() }));
  return repo;
}

export const organizationUseCases = {
  submitApplication: () => new SubmitOrgApplicationUseCase(organizationsRepository()),
  getMyApplication: () => new GetMyOrgApplicationUseCase(organizationsRepository()),
  listMine: () => new ListMyOrganizationsWithRolesUseCase(organizationsRepository()),
  listMembers: () => new ListOrgMembersUseCase(organizationsRepository()),
  addMember: () => new AddOrgMemberUseCase(organizationsRepository()),
  removeMember: () => new RemoveOrgMemberUseCase(organizationsRepository()),
};

/** React Query keys. The event form's organization picker shares the membership key's prefix. */
export const MY_ORG_APPLICATION_QUERY_KEY = ['organizations', 'my-application'] as const;
export const MY_ORGANIZATIONS_WITH_ROLES_QUERY_KEY = ['organizations', 'mine'] as const;
export const orgMembersQueryKey = (orgId: string) => ['organizations', 'members', orgId] as const;
