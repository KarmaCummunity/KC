import { defineMachine } from '../machine';

/**
 * Housing booking: a stay request on a housing post (`post_handoffs.status`, world
 * `housing`; spec `docs/spec/05_giving_worlds.md` housing flow, S52).
 *
 * - The host approves or declines a request (`reserved → confirmed | cancelled`); an
 *   unanswered request lapses (`housing_bookings_sweep`).
 * - Only an approved stay completes or is marked a no-show; there is no direct
 *   `reserved → handed_over`. The check-in time windows are predicates in the RPCs.
 * - `handed_over`, `cancelled` and `no_show` are terminal.
 *
 * SQL copy: `supabase/schemas/25_handoffs/010_post_handoffs.sql` (`kc_private.fsm_state` / `fsm_edge` seeds).
 */
export const housingBookingMachine = defineMachine({
  id: 'housing_booking',
  states: ['reserved', 'confirmed', 'handed_over', 'cancelled', 'no_show'] as const,
  edges: [
    { from: 'reserved', to: 'confirmed', roles: ['owner'] },
    { from: 'reserved', to: 'cancelled', roles: ['owner', 'recipient', 'system'] },
    { from: 'confirmed', to: 'handed_over', roles: ['owner'] },
    { from: 'confirmed', to: 'cancelled', roles: ['owner', 'recipient', 'system'] },
    { from: 'confirmed', to: 'no_show', roles: ['owner'] },
  ],
});
