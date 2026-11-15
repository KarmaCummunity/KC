// Text of a notification in the app — the same keys and arguments the push worker renders
// (supabase/functions/dispatch-notification/messages.ts), so the centre and the push read
// alike. Pure: the caller passes its translate function.
import type { InboxNotification, NotificationArgs, NotificationTextArg } from '@kc/domain';
import { isNotificationKind, notificationKindSpec } from '@kc/domain';

type Translate = (key: string, args?: Record<string, string | number>) => string;

type TextSource = Pick<InboxNotification, 'kind' | 'titleKey' | 'bodyKey' | 'groupCount' | 'actorDisplayName'> &
  Partial<Pick<InboxNotification, 'args'>>;

/** Separator between the pieces of `details` and before the first one (same as the push worker). */
export const DETAILS_SEPARATOR = ' · ';

const nonBlank = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;

/**
 * D26: `postTitle` and `details` from the arguments the database adds to a notification about a
 * post (migration 0027: post_title, when_label, seats, route_from, route_to). `details` is empty
 * or starts with the separator, so a text writes `({{postTitle}}{{details}})`.
 */
export function richTextArgs(args: NotificationArgs | undefined, t: Translate): { postTitle: string; details: string } {
  const source = args ?? {};
  const pieces: string[] = [];
  const when = nonBlank(source['when_label']);
  if (when) pieces.push(when);
  const seats = Number(source['seats']);
  if (Number.isInteger(seats) && seats > 1) pieces.push(t('notifications.detailsSeats', { seats }));
  const from = nonBlank(source['route_from']);
  const to = nonBlank(source['route_to']);
  if (from && to) pieces.push(t('notifications.detailsRoute', { from, to }));
  return {
    postTitle: nonBlank(source['post_title']) ?? t('notifications.postTitleFallback'),
    details: pieces.map((piece) => DETAILS_SEPARATOR + piece).join(''),
  };
}

/** The arguments every notification text may use, with their fallbacks. */
export function notificationTextArgs(
  notification: Pick<InboxNotification, 'groupCount' | 'actorDisplayName'> & Partial<Pick<InboxNotification, 'args'>>,
  t: Translate,
): Record<NotificationTextArg, string | number> {
  const count = Math.max(1, notification.groupCount);
  const taskTitle = notification.args?.task_title;
  return {
    actorName: notification.actorDisplayName?.trim() || t('notifications.actorNameFallback'),
    count,
    othersCount: count - 1,
    // The centre does not load message text; the conversation shows it.
    messagePreview: t('notifications.messagePreviewFallback'),
    // `data.task_title` of an admin task notification (FR-ADMIN-018).
    taskTitle: typeof taskTitle === 'string' && taskTitle.trim() !== '' ? taskTitle : t('notifications.taskTitleFallback'),
    ...richTextArgs(notification.args, t),
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
