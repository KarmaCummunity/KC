import { defineMachine } from '../machine';

/**
 * Post lifecycle S1 (spec `docs/spec/07_cross_cutting_systems.md` §7.1, D104).
 * One machine for every post of every world; listings are retired with G1, not ported.
 *
 * - `expired` reopens only by republishing a new post (D127),
 *   so no edge leads from `expired` back to `open`.
 * - Guards that read other rows (expiry on resume, an active handoff on pause / delete)
 *   stay in the `posts_status_fsm` trigger, before the kernel call.
 *
 * SQL copy: `supabase/schemas/20_posts/030_post_status_machine.sql` (`kc_private.fsm_state` / `fsm_edge` seeds).
 */
export const postMachine = defineMachine({
  id: 'post',
  states: ['draft', 'open', 'paused', 'closed_delivered', 'deleted_no_recipient', 'expired', 'hidden_pending_review', 'removed_admin'] as const,
  edges: [
    { from: 'draft', to: 'open', roles: ['owner', 'system'] },
    { from: 'open', to: 'paused', roles: ['owner'] },
    { from: 'paused', to: 'open', roles: ['owner'] },
    { from: 'open', to: 'closed_delivered', roles: ['owner', 'system'] },
    { from: 'open', to: 'deleted_no_recipient', roles: ['owner'] },
    { from: 'paused', to: 'deleted_no_recipient', roles: ['owner'] },
    { from: 'expired', to: 'deleted_no_recipient', roles: ['owner'] },
    { from: 'hidden_pending_review', to: 'deleted_no_recipient', roles: ['owner'] },
    { from: 'closed_delivered', to: 'open', roles: ['owner'] },
    { from: 'deleted_no_recipient', to: 'open', roles: ['owner'] },
    { from: 'hidden_pending_review', to: 'closed_delivered', roles: ['system'] },
    { from: 'closed_delivered', to: 'deleted_no_recipient', roles: ['system', 'owner'] },
    { from: 'open', to: 'expired', roles: ['system'] },
    { from: 'paused', to: 'expired', roles: ['system'] },
    { from: 'open', to: 'hidden_pending_review', roles: ['system'] },
    { from: 'paused', to: 'hidden_pending_review', roles: ['system'] },
    { from: 'closed_delivered', to: 'hidden_pending_review', roles: ['system'] },
    { from: 'expired', to: 'hidden_pending_review', roles: ['system'] },
    { from: 'hidden_pending_review', to: 'open', roles: ['system', 'admin'] },
    { from: 'open', to: 'removed_admin', roles: ['admin'] },
    { from: 'paused', to: 'removed_admin', roles: ['admin'] },
    { from: 'closed_delivered', to: 'removed_admin', roles: ['admin'] },
    { from: 'deleted_no_recipient', to: 'removed_admin', roles: ['admin'] },
    { from: 'expired', to: 'removed_admin', roles: ['admin'] },
    { from: 'hidden_pending_review', to: 'removed_admin', roles: ['admin'] },
    { from: 'removed_admin', to: 'open', roles: ['admin'] },
    { from: 'removed_admin', to: 'paused', roles: ['admin'] },
    { from: 'removed_admin', to: 'closed_delivered', roles: ['admin'] },
    { from: 'removed_admin', to: 'deleted_no_recipient', roles: ['admin'] },
    { from: 'removed_admin', to: 'expired', roles: ['admin'] },
  ],
});
