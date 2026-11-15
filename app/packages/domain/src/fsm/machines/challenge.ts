import { defineMachine } from '../machine';

/**
 * Challenge lifecycle (`challenges.status`): `active` until it ends.
 *
 * SQL copy: `supabase/schemas/74_challenges/010_challenges.sql` (`kc_private.fsm_state` / `fsm_edge` seeds).
 */
export const challengeMachine = defineMachine({
  id: 'challenge',
  states: ['active', 'ended'] as const,
  edges: [
    { from: 'active', to: 'ended', roles: ['manager', 'admin'] },
  ],
});
