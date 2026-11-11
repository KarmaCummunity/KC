import { defineMachine } from '../machine';

/**
 * Organization application (`org_applications.status`): pending until an admin approves or rejects it.
 *
 * SQL copy: `supabase/schemas/80_organizations/030_org_applications.sql` (`kc_private.fsm_state` / `fsm_edge` seeds).
 */
export const orgApplicationMachine = defineMachine({
  id: 'org_application',
  states: ['pending', 'approved', 'rejected'] as const,
  edges: [
    { from: 'pending', to: 'approved', roles: ['admin'] },
    { from: 'pending', to: 'rejected', roles: ['admin'] },
  ],
});
