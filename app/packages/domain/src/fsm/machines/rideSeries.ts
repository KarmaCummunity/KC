import { defineMachine } from '../machine';

/**
 * Recurring ride series (`ride_series.status`).
 *
 * SQL copy: `supabase/schemas/70_worlds/020_ride_series.sql` (`kc_private.fsm_state` / `fsm_edge` seeds).
 */
export const rideSeriesMachine = defineMachine({
  id: 'ride_series',
  states: ['active', 'paused', 'cancelled'] as const,
  edges: [
    { from: 'active', to: 'paused' },
    { from: 'paused', to: 'active' },
    { from: 'active', to: 'cancelled' },
    { from: 'paused', to: 'cancelled' },
  ],
});
