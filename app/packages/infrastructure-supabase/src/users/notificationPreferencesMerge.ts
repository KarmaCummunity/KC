import type { NotificationPreferencesPatch } from '@kc/application';
import type { Json } from '../database.types';

type PreferenceDocument = { [key: string]: Json | undefined };

function isObject(value: Json | undefined): value is PreferenceDocument {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * FR-NOTIF-014 / FR-NOTIF-017 — the stored `user_private.notification_preferences` document with
 * `patch` applied. Top-level keys (`critical`, `social`, `quietHours`) replace the stored value;
 * `kinds` is merged per key, so toggling one notification type keeps the others. Keys the patch
 * does not name are preserved. There is no server-side merge function in the baseline: the
 * adapter reads the document, merges it here and writes it back.
 */
export function mergeNotificationPreferences(
  stored: PreferenceDocument,
  patch: NotificationPreferencesPatch,
): PreferenceDocument {
  const next: PreferenceDocument = { ...stored };
  if (patch.critical !== undefined) next['critical'] = patch.critical;
  if (patch.social !== undefined) next['social'] = patch.social;
  if (patch.quietHours !== undefined) {
    const { enabled, start, end, timezone } = patch.quietHours;
    next['quietHours'] = { enabled, start, end, timezone };
  }
  if (patch.kinds !== undefined) {
    const storedKinds = stored['kinds'];
    next['kinds'] = { ...(isObject(storedKinds) ? storedKinds : {}), ...patch.kinds };
  }
  return next;
}
