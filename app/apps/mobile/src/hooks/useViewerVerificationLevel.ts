// FR-HOUSING-003 AC2 / FR-VERIFY-001 — the signed-in member's badge level for gated worlds (housing).
import { useQuery } from '@tanstack/react-query';
import { effectiveVerificationLevel } from '@kc/domain';
import { useAuthStore } from '../store/authStore';
import { getUserRepo } from '../services/userComposition';

export function useViewerVerificationLevel() {
  const userId = useAuthStore((s) => s.session?.userId);
  return useQuery({
    queryKey: ['viewer-verification', userId],
    queryFn: () => getUserRepo().findById(userId!),
    enabled: Boolean(userId),
    select: (user) => (user ? effectiveVerificationLevel(user) : 0),
    refetchOnMount: 'always',
    staleTime: 60_000,
  });
}
