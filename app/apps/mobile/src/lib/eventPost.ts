// Mapped to spec: docs/spec/08_organizations.md Events (G1 step 5, D31, S13) — what the event
// section of a post page offers: the viewer's register label per policy, the organizer's actions
// per registration (deciding, the waitlist, attendance after the start), the roster's groups and
// counts, and whether registration has closed.
import {
  allowsMove, eventRegistrationMachine,
  type EventRegistration, type EventRegistrationPolicy, type EventRegistrationStatus,
} from '@kc/domain';

/** Copy key of the viewer's register button: a manual event takes a request, the others a registration. */
export function registerActionLabelKey(policy: EventRegistrationPolicy): string {
  return policy === 'manual' ? 'eventPost.registration.requestToJoin' : 'eventPost.registration.register';
}

/** An organizer action on one registration; `attended` / `noshow` mark attendance (0564). */
export type EventRosterAction = 'approve' | 'decline' | 'remove' | 'attended' | 'noshow';

/**
 * The organizer's actions for a registration state. Before the start: decide a waiting request,
 * remove a confirmed or waitlisted registration. From the start: mark a confirmed registrant as
 * attended or absent, and correct an absence to attended. Attendance never shows before the start.
 */
export function rosterActionsFor(status: EventRegistrationStatus, started: boolean): readonly EventRosterAction[] {
  // The moves the registration graph gives the organizer from this status; the start of the
  // event then decides between removing a registration and marking attendance.
  const may = (to: EventRegistrationStatus): boolean => allowsMove(eventRegistrationMachine, status, to, 'owner');
  // A request waits for an answer while the organizer can still confirm it.
  if (may('confirmed')) return ['approve', 'decline'];
  const actions: EventRosterAction[] = [];
  if (started && may('handed_over')) actions.push('attended');
  if (started && may('no_show')) actions.push('noshow');
  // Before the start a registration is removed; one that can never attend (the waiting list) at any time.
  if (may('cancelled') && (!started || !may('handed_over'))) actions.push('remove');
  return actions;
}

/** How many registrations are confirmed, wait for the organizer, and wait for a place. */
export function summarizeEventRoster(rows: readonly Pick<EventRegistration, 'status'>[]): {
  confirmed: number;
  waiting: number;
  waitlisted: number;
} {
  const count = (status: EventRegistrationStatus) => rows.filter((r) => r.status === status).length;
  return { confirmed: count('confirmed'), waiting: count('reserved'), waitlisted: count('waitlisted') };
}

/** The roster split for display: registrations as listed, and the waitlist in its promotion order. */
export interface EventRosterGroups {
  readonly registrations: readonly EventRegistration[];
  /** Earliest first — the order the server promotes in (`event_promote_waitlist`). */
  readonly waitlist: readonly EventRegistration[];
}

/** Splits the roster into the registrations and the waitlist, earliest waitlisted first. */
export function groupEventRoster(rows: readonly EventRegistration[]): EventRosterGroups {
  return {
    registrations: rows.filter((r) => r.status !== 'waitlisted'),
    waitlist: rows
      .filter((r) => r.status === 'waitlisted')
      .sort((a, b) => Date.parse(a.reservedAt) - Date.parse(b.reservedAt)),
  };
}

/** Registration closes once the event starts (the server refuses with `slot_started`). */
export function eventHasStarted(startsAt: string, now: Date = new Date()): boolean {
  return Date.parse(startsAt) <= now.getTime();
}
