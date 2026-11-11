// Text of a notification in the app — the same keys and arguments the push worker renders
// (supabase/functions/dispatch-notification/messages.ts), so the centre and the push read
// alike. Pure: the caller passes its translate function.
import type { InboxNotification, NotificationTextArg } from '@kc/domain';
import { isNotificationKind, notificationKindSpec } from '@kc/domain';

type Translate = (key: string, args?: Record<string, string | number>) => string;

type TextSource = Pick<InboxNotification, 'kind' | 'titleKey' | 'bodyKey' | 'groupCount' | 'actorDisplayName'>;

/** The arguments every notification text may use, with their fallbacks. */
export function notificationTextArgs(
  notification: Pick<InboxNotification, 'groupCount' | 'actorDisplayName'>,
  t: Translate,
): Record<NotificationTextArg, string | number> {
  const count = Math.max(1, notification.groupCount);
  return {
    actorName: notification.actorDisplayName?.trim() || t('notifications.actorNameFallback'),
    count,
    othersCount: count - 1,
    // The centre does not load message text; the conversation shows it.
    messagePreview: t('notifications.messagePreviewFallback'),
  };
}

/** The body key: the kind's grouped body once the notification merged several events. */
export function notificationBodyKey(notification: TextSource): string {
  if (notification.groupCount <= 1 || !isNotificationKind(notification.kind)) return notification.bodyKey;
  const spec = notificationKindSpec(notification.kind);
  return spec.groupedBodyKey !== null && notification.bodyKey === spec.bodyKey ? spec.groupedBodyKey : notification.bodyKey;
}

export function notificationText(notification: TextSource, t: Translate): { title: string; body: string } {
  const args = notificationTextArgs(notification, t);
  return { title: t(notification.titleKey, args), body: t(notificationBodyKey(notification), args) };
}
