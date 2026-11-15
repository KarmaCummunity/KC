import type { InboxNotification, NotificationCategory } from '@kc/domain';

/** One page of the notification centre, newest first. */
export interface NotificationInboxPageRequest {
  /** 1–50; the server clamps. Default 30. */
  readonly limit?: number;
  /** Keyset cursor: the last row of the previous page. */
  readonly before?: Pick<InboxNotification, 'id' | 'createdAt'> | null;
  readonly category?: NotificationCategory | null;
}

/** The signed-in member's notification centre (D7, D26). */
export interface INotificationInboxRepository {
  page(request?: NotificationInboxPageRequest): Promise<InboxNotification[]>;
  /** Unread notifications: the bell badge and the app icon badge. */
  unreadCount(): Promise<number>;
  /** Marks the listed notifications read; returns how many changed. */
  markRead(ids: readonly string[]): Promise<number>;
  /** Marks everything read; returns how many changed. */
  markAllRead(): Promise<number>;
}
