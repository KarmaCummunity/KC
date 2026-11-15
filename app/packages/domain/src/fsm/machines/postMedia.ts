import { defineMachine } from '../machine';

/**
 * Media upload lifecycle (`post_media.status`): a file is `pending` until the media worker marks it `ready` or `failed`.
 *
 * SQL copy: `supabase/schemas/30_social/010_post_media.sql` (`kc_private.fsm_state` / `fsm_edge` seeds).
 */
export const postMediaMachine = defineMachine({
  id: 'post_media',
  states: ['pending', 'ready', 'failed'] as const,
  edges: [
    { from: 'pending', to: 'ready', roles: ['system'] },
    { from: 'pending', to: 'failed', roles: ['system'] },
  ],
});
