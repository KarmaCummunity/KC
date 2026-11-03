// app/apps/mobile/src/hooks/useUserBasics.ts
// FR-ADMIN-030 — name and avatar of any user, so the admin person screen can
// open people who hold no role yet (e.g. from the users search).
import { useQuery } from '@tanstack/react-query';
import { getUserRepo } from '../services/userComposition';

export interface UserBasics {
  readonly userId: string;
  readonly displayName: string | null;
  readonly avatarUrl: string | null;
}

export function useUserBasics(userId: string | undefined, enabled = true) {
  return useQuery({
    // Own root so the record is never persisted with the profile caches.
    queryKey: ['admin.user.basics', userId],
    queryFn: async (): Promise<UserBasics | null> => {
      const user = await getUserRepo().findById(userId!);
      return user ? { userId: user.userId, displayName: user.displayName, avatarUrl: user.avatarUrl } : null;
    },
    enabled: enabled && Boolean(userId),
    staleTime: 5 * 60_000,
  });
}
