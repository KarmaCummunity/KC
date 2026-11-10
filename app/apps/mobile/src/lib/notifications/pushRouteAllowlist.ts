// app/apps/mobile/src/lib/notifications/pushRouteAllowlist.ts
//
// TD-102 (audit 2026-05-16, BACKLOG P2.14): the prior tapHandler fed
// data.route straight into router.push. A compromised push-dispatch
// path (or any future external sender) could navigate the app to any
// route with attacker-controlled params. We derive the route from
// data.kind (typed enum) against a closed map and shape-check any
// id-like params. data.route is intentionally ignored.
//
// New kinds: extend KIND_ROUTES below + add a test case in
// __tests__/pushRouteAllowlist.test.ts.

import type { PushData, NotificationKind } from '@kc/domain';

export type ResolvedRoute = { pathname: string; params: Record<string, string> };

// RFC 4122 UUID shape, version-agnostic. Sole gatekeeper on id params.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type KindHandler = (data: Partial<PushData>) => ResolvedRoute | null;

const requireUuid = (raw: string | undefined): string | null =>
  raw && UUID_RE.test(raw) ? raw : null;

const KIND_ROUTES: Record<NotificationKind, KindHandler> = {
  chat_message: (d) => {
    const id = requireUuid(d.chat_id ?? d.params?.id);
    return id ? { pathname: '/chat/[id]', params: { id } } : null;
  },
  support_message: (d) => {
    const id = requireUuid(d.chat_id ?? d.params?.id);
    return id ? { pathname: '/chat/[id]', params: { id } } : null;
  },
  system_message: (d) => {
    const id = requireUuid(d.chat_id ?? d.params?.id);
    return id ? { pathname: '/chat/[id]', params: { id } } : null;
  },
  post_expiring: (d) => {
    const id = requireUuid(d.params?.id);
    return id ? { pathname: '/post/[id]', params: { id } } : null;
  },
  post_relevance_check: (d) => {
    const id = requireUuid(d.params?.id);
    return id ? { pathname: '/post/[id]', params: { id } } : null;
  },
  mark_recipient: (d) => {
    const id = requireUuid(d.params?.id);
    return id ? { pathname: '/post/[id]', params: { id } } : null;
  },
  unmark_recipient: (d) => {
    const id = requireUuid(d.params?.id);
    return id ? { pathname: '/post/[id]', params: { id } } : null;
  },
  auto_removed: () => ({ pathname: '/settings/audit', params: {} }),
  follow_request: () => ({ pathname: '/settings/follow-requests', params: {} }),
  // TD-73 (folded into P2.13) replaces these two handlers once the trigger
  // payload carries handle instead of user_id. Until then they land on the
  // requests screen, which is a safer default than "user not found".
  follow_started: () => ({ pathname: '/settings/follow-requests', params: {} }),
  follow_approved: () => ({ pathname: '/settings/follow-requests', params: {} }),
  // FR-ADMIN-018 AC6 — task_assigned notifications deep-link to the task
  // detail screen. data.params.task_id is the UUID; anything malformed
  // falls back to the tasks list which is a safe default for any active admin.
  task_assigned: (d): ResolvedRoute | null => {
    const id = requireUuid(d.params?.task_id ?? d.params?.id);
    return id
      ? { pathname: '/(admin)/tasks/[taskId]', params: { taskId: id } }
      : { pathname: '/(admin)/tasks', params: {} as Record<string, string> };
  },
  // FR-RIDE-013, FR-RIDE-019 — ride participant lifecycle notifications all
  // deep-link to the ride detail screen. The participant_id is also carried
  // in data.params but the detail screen is the right landing for both owner
  // (sees pending requests) and rider (sees their status).
  ride_request: (d) => {
    const id = requireUuid(d.params?.id);
    return id ? { pathname: '/(tabs)/donations/rides/[id]', params: { id } } : null;
  },
  ride_approved: (d) => {
    const id = requireUuid(d.params?.id);
    return id ? { pathname: '/(tabs)/donations/rides/[id]', params: { id } } : null;
  },
  ride_rejected: (d) => {
    const id = requireUuid(d.params?.id);
    return id ? { pathname: '/(tabs)/donations/rides/[id]', params: { id } } : null;
  },
  ride_participant_cancelled: (d) => {
    const id = requireUuid(d.params?.id);
    return id ? { pathname: '/(tabs)/donations/rides/[id]', params: { id } } : null;
  },
  ride_participant_cancelled_by_owner: (d) => {
    const id = requireUuid(d.params?.id);
    return id ? { pathname: '/(tabs)/donations/rides/[id]', params: { id } } : null;
  },
  ride_started: (d) => {
    const id = requireUuid(d.params?.id);
    return id ? { pathname: '/(tabs)/donations/rides/[id]', params: { id } } : null;
  },
  ride_arrived: (d) => {
    const id = requireUuid(d.params?.id);
    return id ? { pathname: '/(tabs)/donations/rides/[id]', params: { id } } : null;
  },
  ride_breakdown: (d) => {
    const id = requireUuid(d.params?.id);
    return id ? { pathname: '/(tabs)/donations/rides/[id]', params: { id } } : null;
  },
  ride_emergency: (d) => {
    const id = requireUuid(d.params?.id);
    return id ? { pathname: '/(tabs)/donations/rides/[id]', params: { id } } : null;
  },
  ride_rate_prompt: (d) => {
    const id = requireUuid(d.params?.id);
    return id ? { pathname: '/(tabs)/donations/rides/[id]/rate', params: { id } } : null;
  },
  // Matching v2 — every match notification lands on the "Matches for you" list.
  match_suggested: () => ({ pathname: '/matches', params: {} }),
  match_interest: () => ({ pathname: '/matches', params: {} }),
  match_accepted: () => ({ pathname: '/matches', params: {} }),
  // KC#1316 — food expiry notices open the listing (its post, G1 step 4c).
  listing_expiring: (d) => listingRoute(d.params),
  listing_expired: (d) => listingRoute(d.params),
  // D73 — ride booking changes open the ride, where the driver manages bookings.
  ride_booking_requested: (d) => listingRoute(d.params),
  ride_booking_confirmed: (d) => listingRoute(d.params),
  ride_booking_declined: (d) => listingRoute(d.params),
  ride_booking_expired: (d) => listingRoute(d.params),
  ride_booking_cancelled: (d) => listingRoute(d.params),
  // FR-KNOW-004 AC5 (0704, #2034) — knowledge slot bookings open the lesson.
  knowledge_booking_requested: (d) => listingRoute(d.params),
  knowledge_booking_confirmed: (d) => listingRoute(d.params),
  knowledge_booking_declined: (d) => listingRoute(d.params),
  knowledge_booking_expired: (d) => listingRoute(d.params),
  knowledge_booking_cancelled: (d) => listingRoute(d.params),
  knowledge_session_completed: (d) => listingRoute(d.params),
  // D74 — a new ride on a followed route opens the ride.
  ride_route_match: (d) => listingRoute(d.params),
  // D70 — an emergency on a ride opens that ride.
  ride_listing_emergency: (d) => listingRoute(d.params),
  // FR-NOTIF-018 (0528) — item and food handoff changes open the listing (its post, G1 step 4c).
  giving_handoff_requested: (d) => listingRoute(d.params),
  giving_handoff_claimed: (d) => listingRoute(d.params),
  giving_handoff_confirmed: (d) => listingRoute(d.params),
  giving_handoff_declined: (d) => listingRoute(d.params),
  giving_handoff_cancelled: (d) => listingRoute(d.params),
  giving_handoff_expired: (d) => listingRoute(d.params),
  giving_handoff_completed: (d) => listingRoute(d.params),
  // FR-HOUSING-017 — housing booking changes open the stay offer, where both sides act on it.
  // D131 — a cancelled event registration opens the event post.
  event_registration_cancelled: (d) => listingRoute(d.params),
  // FR-FEED engagement — a reaction, comment or mention opens the post.
  post_reaction: (d) => postRoute(d.params?.id),
  post_comment: (d) => postRoute(d.params?.id),
  post_mention: (d) => postRoute(d.params?.id),
  // FR-MOD — a suspension opens the blocked-account screen; a removed chat, the member's audit
  // trail (like auto_removed); a late report, its admin case.
  account_suspended: () => ({ pathname: '/account-blocked', params: {} }),
  chat_auto_removed: () => ({ pathname: '/settings/audit', params: {} }),
  report_sla_warning: (d) => reportCaseRoute(d.route),
  // Match v1 opens the member's listing; a listing subscription opens the new post.
  listing_match_found: (d) => listingRoute({ listingId: d.listing_id ?? '' }),
  listing_subscription_hit: (d) => postRoute(d.listing_id),
  housing_booking_requested: (d) => listingRoute(d.params),
  housing_booking_confirmed: (d) => listingRoute(d.params),
  housing_booking_declined: (d) => listingRoute(d.params),
  housing_booking_expired: (d) => listingRoute(d.params),
  housing_booking_superseded: (d) => listingRoute(d.params),
  housing_booking_cancelled: (d) => listingRoute(d.params),
  housing_booking_completed: (d) => listingRoute(d.params),
};

/**
 * A notification about a listing opens the listing's post — the one detail screen (G1 step 4c,
 * 0562 adds `params.postId`). A payload written before that carries only the listing id and opens
 * the listing route, which forwards to the post. Only well-formed ids are followed.
 */
/** The post detail screen, for a well-formed post id only. */
function postRoute(raw: string | undefined): ResolvedRoute | null {
  const id = requireUuid(raw);
  return id ? { pathname: '/post/[id]', params: { id } } : null;
}

/** Report case ids are `<target_type>:<uuid>`; the SLA alert (0611) writes them URL-encoded. */
const REPORT_CASE_ROUTE_RE = /^\/\(admin\)\/reports\/(post|user|chat|listing)%3A([0-9a-f-]{36})$/i;

/** The admin report case the SLA alert names, shape-checked like every other id. */
function reportCaseRoute(route: string | undefined): ResolvedRoute | null {
  const match = route ? REPORT_CASE_ROUTE_RE.exec(route) : null;
  const id = match ? requireUuid(match[2]) : null;
  return match && id ? { pathname: '/(admin)/reports/[caseId]', params: { caseId: `${match[1]}:${id}` } } : null;
}

function listingRoute(params: PushData['params']): ResolvedRoute | null {
  const postId = requireUuid(params?.postId);
  if (postId) return { pathname: '/post/[id]', params: { id: postId } };
  const listingId = requireUuid(params?.listingId);
  return listingId ? { pathname: '/listing/[listingId]', params: { listingId } } : null;
}

export function resolvePushRoute(data: Partial<PushData>): ResolvedRoute | null {
  const kind = data.kind;
  if (!kind || !(kind in KIND_ROUTES)) return null;
  return KIND_ROUTES[kind](data);
}
