// app/apps/mobile/src/hooks/useAdminsList.ts
// FR-ADMIN-015 — admins list for the RBAC management screen.
import { useQuery } from '@tanstack/react-query';
import type { AdminGrant } from '@kc/domain';
import { container } from '../lib/container';
import { listOrEmpty } from '../lib/backendAvailability';

const EMPTY: readonly AdminGrant[] = [];

export interface AdminsListState {
  readonly grants: readonly AdminGrant[];
  readonly isLoading: boolean;
  readonly isRefetching: boolean;
  readonly refetch: () => void;
  readonly error: unknown;
}

export function useAdminsList(
  includeRevoked: boolean,
  enabled = true,
): AdminsListState {
  const q = useQuery({
    queryKey: ['admin.admins.list', { includeRevoked }],
    // Degrade rule: without the role tables the roster is simply empty.
    queryFn: () => listOrEmpty(() => container.listAdmins.execute({ includeRevoked })),
    enabled,
    staleTime: 30_000,
  });
  return {
    grants: q.data ?? EMPTY,
    isLoading: q.isLoading,
    isRefetching: q.isRefetching,
    refetch: () => { void q.refetch(); },
    error: q.error,
  };
}
