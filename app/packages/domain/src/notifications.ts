import type { NotificationPreferences } from './value-objects';

export type NotificationCategory = 'critical' | 'social';

export type NotificationKind =
  | 'chat_message'
  | 'support_message'
  | 'system_message'
  | 'post_expiring'
  // D59 / S3 — "still relevant?" reminder to the owner (replaces expiry for items/requests).
  | 'post_relevance_check'
  | 'mark_recipient'
  | 'unmark_recipient'
  | 'auto_removed'
  | 'follow_request'
  | 'follow_started'
  | 'follow_approved'
  | 'task_assigned'
  // FR-RIDE-013, FR-RIDE-019 — ride participant lifecycle + cascade variant.
  | 'ride_request'
  | 'ride_approved'
  | 'ride_rejected'
  | 'ride_participant_cancelled'
  | 'ride_participant_cancelled_by_owner'
  // FR-RIDE-031..033 + FR-RIDE-045 AC4 — active ride transitions.
  | 'ride_started'
  | 'ride_arrived'
  | 'ride_breakdown'
  // FR-RIDE-035 — emergency button.
  | 'ride_emergency'
  // FR-RIDE-037 — ratings prompt.
  | 'ride_rate_prompt'
  // Matching v2 (0420–0423) — automatic offer↔request suggestions + responses.
  | 'match_suggested'
  | 'match_interest'
  | 'match_accepted'
  // KC#1316 — food offer expiring within 24 h / expired unclaimed (spec 05 §5.1, S4).
  | 'listing_expiring'
  | 'listing_expired'
  // D73 / D96 (0511) — rides on the listing flow: every booking change reaches the other side.
  | 'ride_booking_requested'
  | 'ride_booking_confirmed'
  | 'ride_booking_declined'
  | 'ride_booking_expired'
  | 'ride_booking_cancelled'
  // 0734 — the ride expired without leaving, so a confirmed seat was cancelled.
  | 'ride_booking_lapsed'
  // D74 (0516) — a new ride on a route the user follows.
  | 'ride_route_match'
  // D70 (0517) — an emergency raised on a ride of the one rides flow.
  | 'ride_listing_emergency'
  // FR-NOTIF-018 (0528) — item and food handoffs: every change reaches the other side.
  | 'giving_handoff_requested'
  | 'giving_handoff_claimed'
  | 'giving_handoff_confirmed'
  | 'giving_handoff_declined'
  | 'giving_handoff_cancelled'
  // Wave 2c (0716) — a request the giver did not answer within its confirm window lapsed.
  | 'giving_handoff_expired'
  | 'giving_handoff_completed'
  // FR-KNOW-004 AC5 (0704, #2034) — knowledge slot bookings: every change reaches the other side.
  | 'knowledge_booking_requested'
  | 'knowledge_booking_confirmed'
  | 'knowledge_booking_declined'
  | 'knowledge_booking_expired'
  | 'knowledge_booking_cancelled'
  | 'knowledge_session_completed'
  // FR-HOUSING-017 (0602–0603) — housing stay bookings: every change reaches the other side.
  | 'housing_booking_requested'
  | 'housing_booking_confirmed'
  | 'housing_booking_declined'
  | 'housing_booking_expired'
  | 'housing_booking_superseded'
  | 'housing_booking_cancelled'
  | 'housing_booking_completed'
  // D131 — the organizer paused, closed or deleted the event
  // before it started, so the attendee's registration was cancelled (0686).
  | 'event_registration_cancelled'
  // FR-FEED engagement (0252 / 0255) — a reaction, a comment, a mention on the member's post.
  | 'post_reaction'
  | 'post_comment'
  | 'post_mention'
  // FR-MOD (0150, 0136, 0611) — the member's account was suspended; a chat was removed after
  // reports; a report waits past its 12-hour mark (to admins).
  | 'account_suspended'
  | 'chat_auto_removed'
  | 'report_sla_warning'
  // Match v1 (0261) and listing subscriptions (0667) — a listing that fits the member's.
  | 'listing_match_found'
  | 'listing_subscription_hit';

/** Payload attached to every Expo push under `data`. The client reads this on tap. */
export interface PushData {
  category: NotificationCategory;
  kind: NotificationKind;
  notification_id: string;
  /** expo-router pathname, e.g. '/chat/[id]'. */
  route?: string;
  /** route params, e.g. { id: '<chat_id>' }. */
  params?: Record<string, string>;
  /** Convenience field used by the foreground handler to detect chat-active state. */
  chat_id?: string;
  /** The listing a match or listing-subscription notice is about (0261, 0667 write it at top level). */
  listing_id?: string;
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
