// Notification preferences (FR-NOTIF-014 / 0256): shared by Settings → notifications and feed settings.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NotificationPreferences } from '@kc/domain';
import { applyNotificationPreferencesPatch, type NotificationPreferencesPatch } from '@kc/application';
import { useAuthStore } from '../store/authStore';
import { container } from '../lib/container';

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
  const queryKey = ['notification-preferences', userId] as const;

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const user = await container.userRepo.findById(userId!);
      return user?.notificationPreferences ?? DEFAULT_NOTIFICATION_PREFS;
    },
    enabled: !!userId,
    staleTime: 5 * 60_000, // PERF-3: mutation invalidates explicitly via onSettled
  });

  const mutation = useMutation({
    mutationFn: (partial: NotificationPreferencesPatch) =>
      container.updateNotificationPreferences.execute({ userId: userId!, ...partial }),
    onMutate: async (partial) => {
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData<NotificationPreferences>(queryKey);
      qc.setQueryData<NotificationPreferences>(queryKey, (old) =>
        applyNotificationPreferencesPatch(old ?? DEFAULT_NOTIFICATION_PREFS, partial),
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
