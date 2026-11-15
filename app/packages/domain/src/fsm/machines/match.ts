import { defineMachine } from '../machine';

/**
 * Matching suggestion (`match_candidates.status`): suggested to a member, who accepts or declines; the system expires and re-suggests.
 *
 * SQL copy: `supabase/schemas/76_matching/030_match_candidates.sql` (`kc_private.fsm_state` / `fsm_edge` seeds).
 */
export const matchMachine = defineMachine({
  id: 'match',
  states: ['suggested', 'accepted', 'declined', 'expired'] as const,
  edges: [
    { from: 'suggested', to: 'accepted', roles: ['member'] },
    { from: 'suggested', to: 'declined', roles: ['member'] },
    { from: 'suggested', to: 'expired', roles: ['system'] },
    { from: 'expired', to: 'suggested', roles: ['system'] },
  ],
});
