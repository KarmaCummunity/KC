// FR-HOUSING-003 AC2 / FR-VERIFY-001 — the signed-in member's badge level for gated worlds (housing).
import { useQuery } from '@tanstack/react-query';
import { effectiveVerificationLevel } from '@kc/domain';
import { useAuthStore } from '../store/authStore';
import { getUserRepo } from '../services/userComposition';
import { userProfileKeys } from '../lib/queryKeys';

export function useViewerVerificationLevel() {
  const userId = useAuthStore((s) => s.session?.userId);
  return useQuery({
    // The shared own-profile query (NFR-PERF-005): the level is one field of the profile, so it
    // must not cost a second five-request profile read under a key of its own.
    queryKey: userProfileKeys.byId(userId ?? ''),
    queryFn: () => getUserRepo().findById(userId!),
    enabled: Boolean(userId),
    select: (user) => (user ? effectiveVerificationLevel(user) : 0),
    // A gated world must not open on a stale badge: re-read when the gate mounts. The refetch
    // also refreshes every other reader of the shared profile.
    refetchOnMount: 'always',
    staleTime: 60_000,
  });
}
