// Notification preferences (FR-NOTIF-014 / 0256): shared by Settings → notifications and feed settings.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NotificationPreferences, User } from '@kc/domain';
import { applyNotificationPreferencesPatch, type NotificationPreferencesPatch } from '@kc/application';
import { useAuthStore } from '../store/authStore';
import { container } from '../lib/container';
import { userProfileKeys } from '../lib/queryKeys';

export const DEFAULT_QUIET_HOURS = {
  enabled: false,
  start: '22:00',
  end: '07:00',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
};

export const DEFAULT_NOTIFICATION_PREFS: NotificationPreferences = {
  critical: true,
  social: true,
  quietHours: DEFAULT_QUIET_HOURS,
};

export function useNotificationPreferences() {
  const userId = useAuthStore((s) => s.session?.userId);
  const qc = useQueryClient();
  // The preferences are a field of the member's own profile, so they are read from the shared
  // own-profile query instead of a second five-request profile read (NFR-PERF-005).
  const queryKey = userProfileKeys.byId(userId ?? '');

  const query = useQuery({
    queryKey,
    queryFn: () => container.userRepo.findById(userId!),
    select: (user) => user?.notificationPreferences ?? DEFAULT_NOTIFICATION_PREFS,
    enabled: !!userId,
    staleTime: 5 * 60_000, // PERF-3: mutation invalidates explicitly via onSettled
  });

  const mutation = useMutation({
    mutationFn: (partial: NotificationPreferencesPatch) =>
      container.updateNotificationPreferences.execute({ userId: userId!, ...partial }),
    onMutate: async (partial) => {
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData<User | null>(queryKey);
      // Patch only the preferences field of the cached profile; a profile that has not loaded
      // yet has nothing to patch and is filled by the refetch in `onSettled`.
      qc.setQueryData<User | null>(queryKey, (old) =>
        old
          ? {
              ...old,
              notificationPreferences: applyNotificationPreferencesPatch(
                old.notificationPreferences ?? DEFAULT_NOTIFICATION_PREFS,
                partial,
              ),
            }
          : old,
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKey, ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey }),
  });

  return { prefs: query.data ?? DEFAULT_NOTIFICATION_PREFS, update: mutation.mutate };
}
