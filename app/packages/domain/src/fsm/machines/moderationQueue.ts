import { defineMachine } from '../machine';

/**
 * Moderation queue entry (`moderation_queue.status`): `open` until an admin resolves it.
 *
 * SQL copy: `supabase/schemas/60_moderation/050_moderation_queue.sql` (`kc_private.fsm_state` / `fsm_edge` seeds).
 */
export const moderationQueueMachine = defineMachine({
  id: 'moderation_queue',
  states: ['open', 'resolved'] as const,
  edges: [
    { from: 'open', to: 'resolved', roles: ['admin'] },
  ],
});
