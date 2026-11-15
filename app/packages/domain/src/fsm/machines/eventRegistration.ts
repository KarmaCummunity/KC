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
 * SQL copy: `supabase/schemas/25_handoffs/010_post_handoffs.sql` (`kc_private.fsm_state` / `fsm_edge` seeds).
 */
export const eventRegistrationMachine = defineMachine({
  id: 'event_registration',
  states: ['waitlisted', 'reserved', 'confirmed', 'handed_over', 'cancelled', 'no_show'] as const,
  edges: [
    { from: 'waitlisted', to: 'reserved', roles: ['system'] },
    { from: 'waitlisted', to: 'confirmed', roles: ['system'] },
    { from: 'waitlisted', to: 'cancelled', roles: ['owner', 'recipient', 'system'] },
    { from: 'reserved', to: 'confirmed', roles: ['owner', 'system'] },
    { from: 'reserved', to: 'cancelled', roles: ['owner', 'recipient', 'system'] },
    { from: 'confirmed', to: 'handed_over', roles: ['owner'] },
    { from: 'confirmed', to: 'cancelled', roles: ['owner', 'recipient', 'system'] },
    { from: 'confirmed', to: 'no_show', roles: ['owner'] },
    { from: 'no_show', to: 'handed_over', roles: ['owner'] },
  ],
});
