import { defineMachine } from '../machine';

/**
 * Organization (`organizations.status`): `active` or `suspended` by an admin.
 *
 * SQL copy: `supabase/schemas/80_organizations/010_organizations.sql` (`kc_private.fsm_state` / `fsm_edge` seeds).
 */
export const organizationMachine = defineMachine({
  id: 'organization',
  states: ['active', 'suspended'] as const,
  edges: [
    { from: 'active', to: 'suspended', roles: ['admin'] },
    { from: 'suspended', to: 'active', roles: ['admin'] },
  ],
});
