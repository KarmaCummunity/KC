// An organization's event (G1 step 5, D31, S13): a time-world listing of kind `event` whose
// post carries a date window, an optional capacity and a registration policy. Registrations are
// post handoffs, one seat each; a full event waitlists, and attendance is marked by the organizer
// (supabase/migrations/0563_event_posts.sql, 0564_event_attendance_waitlist.sql).

/** The time world's listing kind slug of an organization's event (`listing_kinds.slug`). */
export const ORG_EVENT_KIND_SLUG = 'event';

/**
 * How a registration is accepted: `automatic` confirms at once, `manual` waits for the organizer,
 * `verified_only` confirms a verified member and refuses everyone else.
 */
export const EVENT_REGISTRATION_POLICIES = ['automatic', 'manual', 'verified_only'] as const;
export type EventRegistrationPolicy = (typeof EVENT_REGISTRATION_POLICIES)[number];

/**
 * Every state of an event registration: `reserved` waits for the organizer (manual policy),
 * `confirmed` holds a place, `waitlisted` waits for a place in a full event, `handed_over` is
 * attendance the organizer marked (it earns karma, S13), `no_show` an absence the organizer
 * marked, and `cancelled` a registration withdrawn, declined or removed.
 */
export const EVENT_REGISTRATION_STATUSES = [
  'reserved',
  'confirmed',
  'waitlisted',
  'handed_over',
  'no_show',
  'cancelled',
] as const;
export type EventRegistrationStatus = (typeof EVENT_REGISTRATION_STATUSES)[number];

/** States in which the member is still registered: waiting for the organizer, confirmed, or waitlisted. */
export const ACTIVE_EVENT_REGISTRATION_STATUSES = ['reserved', 'confirmed', 'waitlisted'] as const;
export type ActiveEventRegistrationStatus = (typeof ACTIVE_EVENT_REGISTRATION_STATUSES)[number];

/** The capacity range the event schema accepts (`details.capacity`). */
export const EVENT_CAPACITY_MIN = 1;
export const EVENT_CAPACITY_MAX = 5000;

/** One row of the organizer's roster (`list_event_registrations`). */
export interface EventRegistration {
  readonly handoffId: string;
  readonly recipientId: string;
  readonly displayName: string | null;
  readonly status: EventRegistrationStatus;
  readonly reservedAt: string;
  readonly confirmedAt: string | null;
}

/** The signed-in member's own active registration to one event. */
export interface MyEventRegistration {
  readonly handoffId: string;
  readonly status: ActiveEventRegistrationStatus;
  readonly reservedAt: string;
  readonly confirmedAt: string | null;
}

/** An organization the signed-in member belongs to (any role), as the event form offers it. */
export interface OrganizationMembershipOption {
  readonly orgId: string;
  readonly name: string;
}

/** The event fields of an `event` listing's details, parsed for display. */
export interface EventPostDetails {
  readonly orgId: string | null;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly capacity: number | null;
  readonly registrationPolicy: EventRegistrationPolicy;
  readonly address: string | null;
}

/** Type guard: is `value` one of the three registration policies? */
export function isEventRegistrationPolicy(value: unknown): value is EventRegistrationPolicy {
  return typeof value === 'string' && (EVENT_REGISTRATION_POLICIES as readonly string[]).includes(value);
}

/** Type guard: is `status` one of the event registration states? */
export function isEventRegistrationStatus(status: unknown): status is EventRegistrationStatus {
  return typeof status === 'string' && (EVENT_REGISTRATION_STATUSES as readonly string[]).includes(status);
}

/** Type guard: is the member still registered (reserved, confirmed or waitlisted)? */
export function isActiveEventRegistrationStatus(status: unknown): status is ActiveEventRegistrationStatus {
  return typeof status === 'string' && (ACTIVE_EVENT_REGISTRATION_STATUSES as readonly string[]).includes(status);
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

/**
 * Reads the event fields of an `event` listing's details; null when the window or the policy
 * is missing or malformed (the server guarantees both, so null means "not an event").
 */
export function parseEventPostDetails(details: Readonly<Record<string, unknown>>): EventPostDetails | null {
  const { starts_at: startsAt, ends_at: endsAt, registration_policy: policy, capacity } = details;
  if (!isTimestamp(startsAt) || !isTimestamp(endsAt) || !isEventRegistrationPolicy(policy)) return null;
  return {
    orgId: optionalText(details.org_id),
    startsAt,
    endsAt,
    capacity: typeof capacity === 'number' && Number.isInteger(capacity) ? capacity : null,
    registrationPolicy: policy,
    address: optionalText(details.address),
  };
}
