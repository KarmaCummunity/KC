import { defineMachine } from '../machine';

/**
 * Follow request to a private profile (`follow_requests.status`; spec
 * `docs/spec/requirements/03_following.md` FR-FOLLOW-004 / 005 / 006).
 *
 * - A pending request is accepted or rejected by its target (`target`), or cancelled by its requester
 *   (`requester`) or by the system when a block arrives.
 * - The server also resolves pending requests: a block cancels them both ways, and a profile
 *   turning public accepts them.
 * - Every outcome is final; a new request is a new row (after the 14-day cooldown of a
 *   rejection).
 *
 * SQL copy: `supabase/schemas/15_social_graph/030_follow_requests.sql` (`kc_private.fsm_state` / `fsm_edge` seeds).
 */
export const followRequestMachine = defineMachine({
  id: 'follow_request',
  states: ['pending', 'accepted', 'rejected', 'cancelled'] as const,
  edges: [
    { from: 'pending', to: 'accepted', roles: ['target'] },
    { from: 'pending', to: 'rejected', roles: ['target'] },
    { from: 'pending', to: 'cancelled', roles: ['requester', 'system'] },
  ],
});
