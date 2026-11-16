// FR-AUTH-015 AC1.b — does the signed-in member still owe a date of birth?
// Read on demand (not on every render) because it only matters when a meaningful action starts.
import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import { getUserRepo } from '../services/userComposition';
import { userProfileKeys } from '../lib/queryKeys';

const FIVE_MINUTES_MS = 5 * 60_000;

export function useDateOfBirthRequirement() {
  const queryClient = useQueryClient();

  /** True when the member has no date of birth yet. A failed read counts as "no", so the action still runs. */
  const isDateOfBirthMissing = useCallback(async (): Promise<boolean> => {
    const userId = useAuthStore.getState().session?.userId;
    if (!userId) return false;
    try {
      // The shared own-profile query (NFR-PERF-005): a profile another screen loaded in the last
      // five minutes answers this without a second five-request profile read.
      const user = await queryClient.fetchQuery({
        queryKey: userProfileKeys.byId(userId),
        queryFn: () => getUserRepo().findById(userId),
        staleTime: FIVE_MINUTES_MS,
      });
      return (user?.dateOfBirth ?? null) === null;
    } catch {
      return false;
    }
  }, [queryClient]);

  /** Mark the cached profile stale after the date is saved, so the next check reads the stored value. */
  const forgetDateOfBirthAnswer = useCallback(() => {
    const userId = useAuthStore.getState().session?.userId;
    if (!userId) return;
    void queryClient.invalidateQueries({ queryKey: userProfileKeys.byId(userId) });
  }, [queryClient]);

  return { isDateOfBirthMissing, forgetDateOfBirthAnswer };
}
