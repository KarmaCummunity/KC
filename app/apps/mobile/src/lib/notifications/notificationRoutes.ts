// Where a notification leads — one typed map from kind to route builder.
//
// `Record<NotificationKind, RouteBuilder>` makes the map exhaustive: the kind list is
// generated from the database registry, so a kind added there fails the type check (and
// the test that walks the list) until it has a route here.
//
// The route is derived from the kind and from ids that are shape-checked, never from a
// path carried in the payload: a push can only open the screens named in this file.
import type { NotificationArgs, NotificationEntity, NotificationKind } from '@kc/domain';
import { isNotificationKind } from '@kc/domain';

/** The screens a notification may open. Each is a route file under `app/`. */
export type NotificationPathname =
  | '/chat/[id]'
  | '/post/[id]'
  | '/notifications/inbox'
  | '/settings/follow-requests'
  | '/settings/audit'
  | '/account-blocked'
  | '/matches';

export type ResolvedRoute = { pathname: NotificationPathname; params: Record<string, string> };

/** What a route is built from: the same fields in a push payload and in a centre row. */
export interface NotificationTarget {
  readonly entity?: NotificationEntity | null;
  readonly args?: NotificationArgs | null;
}

export type RouteBuilder = (target: NotificationTarget) => ResolvedRoute | null;

// RFC 4122 UUID shape, version-agnostic. Sole gatekeeper on id params.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (raw: unknown): string | null => (typeof raw === 'string' && UUID_RE.test(raw) ? raw : null);
const entityId = (target: NotificationTarget, type: string): string | null =>
  target.entity?.type === type ? uuid(target.entity.id) : null;

const screen = (pathname: NotificationPathname): RouteBuilder => () => ({ pathname, params: {} });

/** The conversation the notification is about. */
const chat: RouteBuilder = (target) => {
  const id = entityId(target, 'chat') ?? uuid(target.args?.chat_id);
  return id ? { pathname: '/chat/[id]', params: { id } } : null;
};

/** The post the notification is about — the one detail screen of every giving world. */
const post: RouteBuilder = (target) => {
  const id = uuid(target.args?.post_id) ?? entityId(target, 'post');
  return id ? { pathname: '/post/[id]', params: { id } } : null;
};

const inbox = screen('/notifications/inbox');

export const NOTIFICATION_ROUTES: Record<NotificationKind, RouteBuilder> = {
  // FR-NOTIF-001..004 — conversations.
  chat_message: chat,
  support_message: chat,
  system_message: chat,
  message_undeliverable: chat,
  // FR-NOTIF-005, 009, 010 — the member's side of a post.
  post_expiring: post,
  mark_recipient: post,
  unmark_recipient: post,
  // FR-NOTIF-006..008. A profile route needs the member's handle, which the payload does
  // not carry; the centre shows who it was.
  follow_request: screen('/settings/follow-requests'),
  follow_started: inbox,
  follow_approved: inbox,
  // FR-NOTIF-011 and the suspension notice.
  auto_removed: screen('/settings/audit'),
  account_suspended: screen('/account-blocked'),
  // FR-NOTIF-017.
  match_suggested: screen('/matches'),
  // Answers to a suggested match (MATCHING_V2).
  match_interest: screen('/matches'),
  match_accepted: screen('/matches'),
  // FR-NOTIF-018 — every handoff change opens the post, where both sides act on it.
  giving_handoff_requested: post,
  giving_handoff_claimed: post,
  giving_handoff_confirmed: post,
  giving_handoff_declined: post,
  giving_handoff_cancelled: post,
  giving_handoff_expired: post,
  giving_handoff_completed: post,
  giving_handoff_no_show: post,
  giving_handoff_waitlist_promoted: post,
  giving_handoff_reinstated: post,
  ride_booking_requested: post,
  ride_booking_claimed: post,
  ride_booking_confirmed: post,
  ride_booking_declined: post,
  ride_booking_cancelled: post,
  ride_booking_expired: post,
  ride_booking_completed: post,
  ride_booking_no_show: post,
  ride_booking_waitlist_promoted: post,
  ride_booking_reinstated: post,
  housing_booking_requested: post,
  housing_booking_claimed: post,
  housing_booking_confirmed: post,
  housing_booking_declined: post,
  housing_booking_cancelled: post,
  housing_booking_expired: post,
  housing_booking_completed: post,
  housing_booking_no_show: post,
  housing_booking_waitlist_promoted: post,
  housing_booking_reinstated: post,
  event_registration_requested: post,
  event_registration_claimed: post,
  event_registration_confirmed: post,
  event_registration_declined: post,
  event_registration_cancelled: post,
  event_registration_expired: post,
  event_registration_completed: post,
  event_registration_no_show: post,
  event_registration_waitlist_promoted: post,
  event_registration_reinstated: post,
  // Engagement on a post (spec 07 §7.9).
  post_reaction: post,
  post_comment: post,
  post_comment_reply: post,
  post_mention: post,
  // Moderation notices to the post owner; the review queue notice opens the centre.
  post_hidden_for_review: post,
  post_removed: post,
  post_restored: post,
  moderation_review_needed: inbox,
  // World notices (70_worlds).
  ride_route_match: post,
  post_emergency: post,
  event_organizer_message: post,
  post_expired: post,
  // Organizations and donations: no dedicated screen takes an id yet, so they open the centre.
  org_application_decided: inbox,
  donation_receipt_ready: inbox,
  donation_succeeded: inbox,
  donation_refunded: inbox,
  standing_order_charge_failed: inbox,
};

/**
 * The route of a notification. A known kind whose ids are missing or malformed, and a kind
 * this build does not know yet, open the notification centre — the tap always lands
 * somewhere that shows the notification. Anything that is not a notification gives null.
 */
export function resolveNotificationRoute(
  notification: (NotificationTarget & { readonly kind?: unknown }) | null | undefined,
): ResolvedRoute | null {
  if (!notification || typeof notification !== 'object' || typeof notification.kind !== 'string') return null;
  if (!isNotificationKind(notification.kind)) return inbox(notification);
  return NOTIFICATION_ROUTES[notification.kind](notification) ?? inbox(notification);
}
