import { defineMachine } from '../machine';

/**
 * Post lifecycle S1 (spec `docs/spec/07_cross_cutting_systems.md` §7.1, D104).
 * One machine for every post of every world; listings are retired with G1, not ported.
 *
 * - `expired` reopens only by republishing a new post (D127),
 *   so no edge leads from `expired` back to `open`.
 * - Edges carry no roles yet: who may move a post (owner, recipient, admin, a sweep) is
 *   still checked by each writer RPC before the move.
 * - Guards that read other rows (expiry on resume, an active handoff on pause / delete)
 *   stay in the `posts_status_fsm` trigger, before the kernel call.
 *
 * SQL copy: `supabase/migrations/0681_fsm_post_s1.sql`, restore edges `0682_fsm_post_admin_restore.sql`.
 */
export const postMachine = defineMachine({
  id: 'post',
  states: [
    'open',
    'closed_delivered',
    'deleted_no_recipient',
    'expired',
    'removed_admin',
    'hidden_pending_review',
    'paused',
  ] as const,
  edges: [
    // Owner management, delivery, sweeps and moderation from the live state.
    { from: 'open', to: 'paused' },
    { from: 'open', to: 'closed_delivered' },
    { from: 'open', to: 'deleted_no_recipient' },
    { from: 'open', to: 'expired' },
    { from: 'open', to: 'removed_admin' },
    { from: 'open', to: 'hidden_pending_review' },
    // Paused: hidden from everyone but the owner (D104).
    { from: 'paused', to: 'open' },
    { from: 'paused', to: 'deleted_no_recipient' },
    { from: 'paused', to: 'expired' },
    { from: 'paused', to: 'removed_admin' },
    { from: 'paused', to: 'hidden_pending_review' },
    // Delivered: owner reopen, recipient unmark, moderation.
    { from: 'closed_delivered', to: 'open' },
    { from: 'closed_delivered', to: 'deleted_no_recipient' },
    { from: 'closed_delivered', to: 'removed_admin' },
    { from: 'closed_delivered', to: 'hidden_pending_review' },
    // Expired: delete or moderation only; bringing it back is a new post.
    { from: 'expired', to: 'deleted_no_recipient' },
    { from: 'expired', to: 'removed_admin' },
    { from: 'expired', to: 'hidden_pending_review' },
    // Under review: moderator restores, closes or removes.
    { from: 'hidden_pending_review', to: 'open' },
    { from: 'hidden_pending_review', to: 'closed_delivered' },
    { from: 'hidden_pending_review', to: 'deleted_no_recipient' },
    { from: 'hidden_pending_review', to: 'removed_admin' },
    // Closed without a recipient: owner reopen inside the window, or moderation.
    { from: 'deleted_no_recipient', to: 'open' },
    { from: 'deleted_no_recipient', to: 'removed_admin' },
    // Removed by an admin: only an admin restore leaves it, back to the status saved before
    // the removal (D129).
    { from: 'removed_admin', to: 'open' },
    { from: 'removed_admin', to: 'paused' },
    { from: 'removed_admin', to: 'closed_delivered' },
    { from: 'removed_admin', to: 'deleted_no_recipient' },
    { from: 'removed_admin', to: 'expired' },
  ],
});
