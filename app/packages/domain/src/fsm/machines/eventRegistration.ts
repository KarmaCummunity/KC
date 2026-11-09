import { defineMachine } from '../machine';

/**
 * Event registration: a place at an event (`post_handoffs.status`, world `time`; spec
 * `docs/spec/05_giving_worlds.md` events, D31, D128).
 *
 * - A full event puts a registrant on the waitlist; a freed place promotes the next one to
 *   `reserved` (manual approval) or `confirmed` (`event_promote_waitlist`).
 * - The organizer approves or declines a `reserved` registration; anyone still waiting or
 *   registered may leave, and a host move on the event cancels them all.
 * - Attendance is marked once the event starts: `confirmed → handed_over | no_show`, and an
 *   absence may be corrected to attended (`no_show → handed_over`, `mark_event_attendance`).
 * - `handed_over` and `cancelled` are terminal.
 *
 * SQL copy: `supabase/migrations/0694_fsm_handoffs.sql`.
 */
export const eventRegistrationMachine = defineMachine({
  id: 'event_registration',
  states: ['waitlisted', 'reserved', 'confirmed', 'handed_over', 'cancelled', 'no_show'] as const,
  edges: [
    { from: 'waitlisted', to: 'reserved' },
    { from: 'waitlisted', to: 'confirmed' },
    { from: 'waitlisted', to: 'cancelled' },
    { from: 'reserved', to: 'confirmed' },
    { from: 'reserved', to: 'cancelled' },
    { from: 'confirmed', to: 'handed_over' },
    { from: 'confirmed', to: 'cancelled' },
    { from: 'confirmed', to: 'no_show' },
    { from: 'no_show', to: 'handed_over' },
  ],
});
