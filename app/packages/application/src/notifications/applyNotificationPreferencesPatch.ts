// FR-NOTIF-014 / FR-NOTIF-017 — merge rule for a notification preferences patch.
// Mirrors `users_merge_notification_preferences` (0460) so the client can apply the same
// result optimistically: top-level keys replace, `kinds` merges per key.

import type { NotificationPreferences } from '@kc/domain';
import type { NotificationPreferencesPatch } from '../ports/IUserRepository';

export function applyNotificationPreferencesPatch(
  current: NotificationPreferences,
  patch: NotificationPreferencesPatch,
): NotificationPreferences {
  const next: NotificationPreferences = { ...current, ...patch };
  if (patch.kinds) next.kinds = { ...current.kinds, ...patch.kinds };
  return next;
}
