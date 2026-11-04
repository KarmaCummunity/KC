// Mapped to spec: docs/spec/08_organizations.md Events (G1 step 5, D31) — what the event section
// of a post page offers: the viewer's register label per policy, the organizer's actions per
// registration, the roster counts, and whether registration has closed.
import type { EventRegistration, EventRegistrationPolicy } from '@kc/domain';

/** Copy key of the viewer's register button: a manual event takes a request, the others a registration. */
export function registerActionLabelKey(policy: EventRegistrationPolicy): string {
  return policy === 'manual' ? 'eventPost.registration.requestToJoin' : 'eventPost.registration.register';
}

/** An organizer action on one registration. */
export type EventRosterAction = 'approve' | 'decline' | 'remove';

/** The organizer's actions for a registration state: decide a waiting one, remove a confirmed one. */
export function rosterActionsFor(status: string): readonly EventRosterAction[] {
  if (status === 'reserved') return ['approve', 'decline'];
  if (status === 'confirmed') return ['remove'];
  return [];
}

/** How many registrations are confirmed and how many wait for the organizer. */
export function summarizeEventRoster(rows: readonly Pick<EventRegistration, 'status'>[]): {
  confirmed: number;
  waiting: number;
} {
  return {
    confirmed: rows.filter((r) => r.status === 'confirmed').length,
    waiting: rows.filter((r) => r.status === 'reserved').length,
  };
}

/** Registration closes once the event starts (the server refuses with `slot_started`). */
export function eventHasStarted(startsAt: string, now: Date = new Date()): boolean {
  return Date.parse(startsAt) <= now.getTime();
}
