// app/apps/mobile/src/hooks/useHierarchyPyramid.ts
// FR-ADMIN-028 — layered hierarchy view across every visible organisation.
//
// One query loads the snapshot (role-holders + census); focusing an org is a
// pure in-memory re-fold, so switching orgs never waits on the network. The
// key lives under `admin.org.tree` so every mutation that invalidates the tree
// (grant, revoke, set manager) refreshes the pyramid too.
import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { buildHierarchyPyramid, isOrgHierarchyError, type HierarchyPyramid } from '@kc/domain';
import { container } from '../lib/container';
import { useAuthStore } from '../store/authStore';

export interface HierarchyPyramidState {
  readonly pyramid: HierarchyPyramid | null;
  readonly isRefetching: boolean;
  readonly refetch: () => void;
  readonly error: unknown;
}

export function useHierarchyPyramid(focusOrgId: string | null): HierarchyPyramidState {
  const queryClient = useQueryClient();
  // Keyed by viewer, so a session switch never renders another admin's snapshot.
  const userId = useAuthStore((s) => s.session?.userId ?? null);
  const q = useQuery({
    queryKey: ['admin.org.tree', 'snapshot', userId],
    queryFn: () => container.getHierarchySnapshot.execute(),
    enabled: userId !== null,
    staleTime: 30_000,
  });

  // `forbidden` means the viewer no longer holds any grant. The roles query
  // never goes stale on its own, so refresh it and let AdminGate redirect;
  // any other failure keeps the last loaded snapshot on screen.
  useEffect(() => {
    if (isOrgHierarchyError(q.error) && q.error.code === 'forbidden') {
      void queryClient.invalidateQueries({ queryKey: ['admin.roles'] });
    }
  }, [q.error, queryClient]);

  const pyramid = useMemo(
    () => (q.data ? buildHierarchyPyramid(q.data, focusOrgId) : null),
    [q.data, focusOrgId],
  );
  return {
    pyramid,
    isRefetching: q.isRefetching,
    refetch: () => { void q.refetch(); },
    error: q.error,
  };
}
