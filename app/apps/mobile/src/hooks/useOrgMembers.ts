// FR-ORG (G18) — one organization's members screen: the member list, the viewer's own role, and
// the add / remove mutations. Every change refreshes the member list, the viewer's
// organizations and the event form's organization picker.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MyOrganization, OrgMember, OrgMemberRole } from '@kc/domain';
import { MY_ORGANIZATIONS_QUERY_KEY } from '../services/eventRegistrationComposition';
import {
  MY_ORGANIZATIONS_WITH_ROLES_QUERY_KEY,
  organizationUseCases,
  orgMembersQueryKey,
} from '../services/organizationsComposition';
import { useAuthStore } from '../store/authStore';

export interface OrgMembersState {
  readonly organization: MyOrganization | null;
  readonly members: readonly OrgMember[];
  readonly myUserId: string | null;
  readonly isLoading: boolean;
  readonly add: (shareHandle: string, role: OrgMemberRole) => Promise<void>;
  readonly remove: (userId: string) => Promise<void>;
  readonly busy: boolean;
}

export function useOrgMembers(orgId: string): OrgMembersState {
  const queryClient = useQueryClient();
  const myUserId = useAuthStore((s) => s.session?.userId ?? null);
  const mine = useQuery({
    queryKey: MY_ORGANIZATIONS_WITH_ROLES_QUERY_KEY,
    queryFn: () => organizationUseCases.listMine().execute(),
  });
  const members = useQuery({
    queryKey: orgMembersQueryKey(orgId),
    queryFn: () => organizationUseCases.listMembers().execute(orgId),
  });

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: orgMembersQueryKey(orgId) }),
      queryClient.invalidateQueries({ queryKey: MY_ORGANIZATIONS_WITH_ROLES_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: MY_ORGANIZATIONS_QUERY_KEY }),
    ]);
  };
  const addMutation = useMutation({
    mutationFn: (input: { shareHandle: string; role: OrgMemberRole }) =>
      organizationUseCases.addMember().execute({ orgId, ...input }),
    onSuccess: refresh,
  });
  const removeMutation = useMutation({
    mutationFn: (userId: string) => organizationUseCases.removeMember().execute({ orgId, userId }),
    onSuccess: refresh,
  });

  return {
    organization: mine.data?.find((org) => org.orgId === orgId) ?? null,
    members: members.data ?? [],
    myUserId,
    isLoading: mine.isLoading || members.isLoading,
    add: async (shareHandle, role) => { await addMutation.mutateAsync({ shareHandle, role }); },
    remove: async (userId) => { await removeMutation.mutateAsync(userId); },
    busy: addMutation.isPending || removeMutation.isPending,
  };
}
