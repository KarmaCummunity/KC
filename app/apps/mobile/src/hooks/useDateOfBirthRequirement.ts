// FR-AUTH-015 AC1.b — does the signed-in member still owe a date of birth?
// Read on demand (not on every render) because it only matters when a meaningful action starts.
import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import { getUserRepo } from '../services/userComposition';

const FIVE_MINUTES_MS = 5 * 60_000;

export function useDateOfBirthRequirement() {
  const queryClient = useQueryClient();

  /** True when the member has no date of birth yet. A failed read counts as "no", so the action still runs. */
  const isDateOfBirthMissing = useCallback(async (): Promise<boolean> => {
    const userId = useAuthStore.getState().session?.userId;
    if (!userId) return false;
    try {
      const dateOfBirth = await queryClient.fetchQuery({
        queryKey: ['my-date-of-birth', userId],
        queryFn: async () => (await getUserRepo().findById(userId))?.dateOfBirth ?? null,
        staleTime: FIVE_MINUTES_MS,
      });
      return dateOfBirth === null;
    } catch {
      return false;
    }
  }, [queryClient]);

  /** Forget the cached answer after the date is saved, so the next check reads the stored value. */
  const forgetDateOfBirthAnswer = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['my-date-of-birth'] });
  }, [queryClient]);

  return { isDateOfBirthMissing, forgetDateOfBirthAnswer };
}
