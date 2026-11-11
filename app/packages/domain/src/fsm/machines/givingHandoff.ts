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
 *
 * SQL copy: `supabase/schemas/25_handoffs/010_post_handoffs.sql` (`kc_private.fsm_state` / `fsm_edge` seeds).
 */
export const givingHandoffMachine = defineMachine({
  id: 'giving_handoff',
  states: ['reserved', 'confirmed', 'handed_over', 'cancelled', 'no_show'] as const,
  edges: [
    { from: 'reserved', to: 'confirmed', roles: ['owner'] },
    { from: 'reserved', to: 'handed_over', roles: ['owner'] },
    { from: 'reserved', to: 'cancelled', roles: ['owner', 'recipient', 'system'] },
    { from: 'confirmed', to: 'handed_over', roles: ['owner', 'recipient'] },
    { from: 'confirmed', to: 'cancelled', roles: ['owner', 'recipient', 'system'] },
    { from: 'confirmed', to: 'no_show', roles: ['system'] },
    { from: 'handed_over', to: 'cancelled', roles: ['owner', 'recipient'] },
  ],
});
