import { defineMachine } from '../machine';

/**
 * Follow request to a private profile (`follow_requests.status`; spec
 * `docs/spec/requirements/03_following.md` FR-FOLLOW-004 / 005 / 006).
 *
 * - A pending request is accepted or rejected by its target, or cancelled by its requester;
 *   who may take which move stays in the RLS policies until writer roles reach the kernel
 *   (wave 1c).
 * - The server also resolves pending requests: a block cancels them both ways, and a profile
 *   turning public accepts them.
 * - Every outcome is final; a new request is a new row (after the 14-day cooldown of a
 *   rejection).
 *
 * SQL copy: `supabase/migrations/0700_fsm_reports_follow_requests.sql`.
 */
export const followRequestMachine = defineMachine({
  id: 'follow_request',
  states: ['pending', 'accepted', 'rejected', 'cancelled'] as const,
  edges: [
    { from: 'pending', to: 'accepted' },
    { from: 'pending', to: 'rejected' },
    { from: 'pending', to: 'cancelled' },
  ],
});
