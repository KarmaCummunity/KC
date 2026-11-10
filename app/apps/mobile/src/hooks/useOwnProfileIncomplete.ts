// FR-VERIFY-013 — whether the signed-in member's own profile is below level 1.
// Shares the `['user-profile', userId]` query that Edit profile invalidates on save.
import { useQuery } from '@tanstack/react-query';
import { isProfileComplete, type User } from '@kc/domain';
import { getUserRepo } from '../services/userComposition';
import { useAuthStore } from '../store/authStore';

/** Pure rule: level 0 and the owner's fields are not all filled. Unknown profile = not incomplete. */
export function isOwnProfileIncomplete(user: User | null | undefined): boolean {
  if (!user) return false;
  return user.verificationLevel === 0 && !isProfileComplete(user);
}

export function useOwnProfileIncomplete(): boolean {
  const userId = useAuthStore((s) => s.session?.userId);
  const { data } = useQuery({
    queryKey: ['user-profile', userId],
    queryFn: () => getUserRepo().findById(userId!),
    enabled: Boolean(userId),
    staleTime: 5 * 60_000,
  });
  return isOwnProfileIncomplete(data);
}
