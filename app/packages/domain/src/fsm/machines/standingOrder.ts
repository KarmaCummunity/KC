import { defineMachine } from '../machine';

/**
 * Standing order (monthly donation mandate): live once the provider confirms it.
 *
 * SQL copy: `supabase/schemas/85_billing/020_donations.sql` (`kc_private.fsm_state` / `fsm_edge` seeds).
 */
export const standingOrderMachine = defineMachine({
  id: 'standing_order',
  states: ['pending', 'active', 'paused', 'cancelled'] as const,
  edges: [
    { from: 'pending', to: 'active', roles: ['provider'] },
    { from: 'pending', to: 'cancelled' },
    { from: 'active', to: 'paused' },
    { from: 'paused', to: 'active' },
    { from: 'active', to: 'cancelled' },
    { from: 'paused', to: 'cancelled' },
  ],
});
