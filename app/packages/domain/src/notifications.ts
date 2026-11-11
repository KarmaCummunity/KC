import { NOTIFICATION_KINDS, NOTIFICATION_TEXT_ARGS } from './notificationKinds.generated';
import type { NotificationPreferences } from './value-objects';

export { NOTIFICATION_KINDS, NOTIFICATION_TEXT_ARGS };

export type NotificationCategory = 'critical' | 'social';

/**
 * A notification kind. Generated from the registry in the database
 * (`kc_private.notification_kinds`, see `scripts/generate-notification-kinds.mjs`), so a
 * kind added in SQL appears here and every `Record<NotificationKind, …>` must cover it.
 */
export type NotificationKind = keyof typeof NOTIFICATION_KINDS;

/** Argument a notification text may interpolate (`{{actorName}}`, …). */
export type NotificationTextArg = (typeof NOTIFICATION_TEXT_ARGS)[number];

/** The rules of one kind, as registered in the database. */
export interface NotificationKindSpec {
  readonly category: NotificationCategory;
  readonly defaultEnabled: boolean;
  /** Account and safety notices: delivered whatever the member switched off. */
  readonly bypassPreferences: boolean;
  /** Time-critical: pushed during quiet hours as well. */
  readonly bypassQuietHours: boolean;
  /** False = shown in the notification centre only. */
  readonly sendsPush: boolean;
  /** Events about one entity merge within this time; null = never. */
  readonly groupWindowSeconds: number | null;
  readonly titleKey: string;
  readonly bodyKey: string;
  /** Body of a merged notification ("X and 3 others"); null when the kind never merges. */
  readonly groupedBodyKey: string | null;
  readonly textArgs: readonly NotificationTextArg[];
}

export const NOTIFICATION_KIND_LIST = Object.keys(NOTIFICATION_KINDS) as readonly NotificationKind[];
export const NOTIFICATION_CATEGORIES: readonly NotificationCategory[] = ['critical', 'social'];

export function isNotificationKind(value: unknown): value is NotificationKind {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(NOTIFICATION_KINDS, value);
}

export function notificationKindSpec(kind: NotificationKind): NotificationKindSpec {
  return NOTIFICATION_KINDS[kind];
}

/** What a notification is about; a tap leads there. */
export interface NotificationEntity {
  readonly type: string;
  readonly id: string;
}

/** Ids and statuses sent by the module that emitted the notification. Never text. */
export type NotificationArgs = Readonly<Record<string, string | number | boolean>>;

/** Payload attached to every push under `data`. The client reads this on tap. */
export interface PushData {
  notification_id: string;
  kind: NotificationKind;
  category: NotificationCategory;
  entity: NotificationEntity | null;
  group_count: number;
  args: NotificationArgs;
}

/** One row of the in-app notification centre. */
export interface InboxNotification {
  readonly id: string;
  /** Kept as text: a newer server may send a kind this build does not know. */
  readonly kind: string;
  readonly category: NotificationCategory;
  readonly worldSlug: string | null;
  readonly entity: NotificationEntity | null;
  readonly titleKey: string;
  readonly bodyKey: string;
  readonly args: NotificationArgs;
  readonly groupCount: number;
  readonly actorDisplayName: string | null;
  readonly actorAvatarUrl: string | null;
  readonly readAt: string | null;
  readonly createdAt: string;
}

export interface DeviceRegistration {
  readonly userId: string;
  readonly pushToken: string;
  readonly platform: 'ios' | 'android' | 'web';
}

/**
 * Whether the user still wants notifications of `kind` (spec §7.11, FR-NOTIF-017).
 * Opt-out model: only an explicit `false` under `prefs.kinds` disables a kind, so
 * rows written before per-kind preferences existed keep receiving everything.
 */
export function isNotificationKindEnabled(
  prefs: Pick<NotificationPreferences, 'kinds'> | null | undefined,
  kind: NotificationKind,
): boolean {
  return prefs?.kinds?.[kind] !== false;
}
