import { defineMachine } from '../machine';

/**
 * Giving handoff: a reservation on an items, food, animals or knowledge post
 * (`post_handoffs.status`; spec `docs/spec/07_cross_cutting_systems.md` §7.1 closing flow,
 * D17 / D19). Every world without a booking machine of its own uses it (`handoffMachineFor`).
 *
 * - `reserved → handed_over` is legal: closing the post settles a reservation directly
 *   (`posts_settle_handoffs_on_close`, `owner_complete_offer_with_user`, knowledge sessions).
 * - `confirmed → no_show` is the pickup-window sweep (`giving_handoff_no_show_sweep`).
 * - `handed_over`, `cancelled` and `no_show` are terminal.
 * - Edges carry no roles yet: owner or recipient is checked by each writer RPC (wave 1c).
 *
 * SQL copy: `supabase/migrations/0694_fsm_handoffs.sql`.
 */
export const givingHandoffMachine = defineMachine({
  id: 'giving_handoff',
  states: ['reserved', 'confirmed', 'handed_over', 'cancelled', 'no_show'] as const,
  edges: [
    { from: 'reserved', to: 'confirmed' },
    { from: 'reserved', to: 'handed_over' },
    { from: 'reserved', to: 'cancelled' },
    { from: 'confirmed', to: 'handed_over' },
    { from: 'confirmed', to: 'cancelled' },
    { from: 'confirmed', to: 'no_show' },
  ],
});
