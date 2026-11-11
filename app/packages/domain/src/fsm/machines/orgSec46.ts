import { defineMachine } from '../machine';

/**
 * Section 46(a) approval of an organization (`organizations.sec46_status`; spec
 * `docs/spec/requirements/19_org_finance.md` FR-FIN-007).
 *
 * - The organization records the approval it holds: an application (`pending`), the approval
 *   (`active`), its revocation, or nothing.
 * - `expired` is never recorded by hand: the nightly job moves an `active` approval there once
 *   its validity ends (role `system`). A lapsed or revoked approval is renewed (`active`),
 *   applied for again (`pending`) or cleared (`none`).
 *
 * SQL copy: `supabase/migrations/0003_org_sec46_machine.sql` (`kc_private.fsm_state` / `fsm_edge` seeds).
 */
export const orgSec46Machine = defineMachine({
  id: 'org_sec46',
  states: ['none', 'pending', 'active', 'expired', 'revoked'] as const,
  edges: [
    { from: 'none', to: 'pending' },
    { from: 'pending', to: 'none' },
    { from: 'none', to: 'active' },
    { from: 'pending', to: 'active' },
    { from: 'expired', to: 'active' },
    { from: 'revoked', to: 'active' },
    { from: 'active', to: 'expired', roles: ['system'] },
    { from: 'active', to: 'revoked' },
    { from: 'active', to: 'none' },
    { from: 'expired', to: 'pending' },
    { from: 'revoked', to: 'pending' },
    { from: 'expired', to: 'none' },
    { from: 'revoked', to: 'none' },
  ],
});
