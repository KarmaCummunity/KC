// Android channels and iOS categories, one per notification category of the registry.
//
// The push worker addresses a push by the category of its kind (`channelId` on Android,
// `categoryId` on iOS), so the ids here ARE the categories: no second list to keep in step.
// Pure data — the calls into expo-notifications live in channels.ts.
import type { NotificationCategory, NotificationKind } from '@kc/domain';
import { notificationKindSpec } from '@kc/domain';

export interface NotificationChannelSpec {
  /** Locale key of the name the member sees in the system settings. */
  readonly nameKey: string;
  readonly descriptionKey: string;
  /** `high` shows a heads-up banner; `default` only makes a sound. */
  readonly importance: 'high' | 'default';
  readonly sound: boolean;
  readonly vibrate: boolean;
}

export const NOTIFICATION_CHANNELS: Record<NotificationCategory, NotificationChannelSpec> = {
  critical: {
    nameKey: 'notifications.criticalLabel',
    descriptionKey: 'notifications.criticalCaption',
    importance: 'high',
    sound: true,
    vibrate: true,
  },
  social: {
    nameKey: 'notifications.socialLabel',
    descriptionKey: 'notifications.socialCaption',
    importance: 'default',
    sound: false,
    vibrate: false,
  },
};

/** The single channel of builds before the per-category channels; removed on upgrade. */
export const LEGACY_CHANNEL_ID = 'kc-default';

/** The channel (Android) and category (iOS) a kind is delivered on. */
export function channelIdForKind(kind: NotificationKind): NotificationCategory {
  return notificationKindSpec(kind).category;
}
