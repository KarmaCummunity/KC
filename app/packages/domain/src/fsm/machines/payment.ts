import { defineMachine } from '../machine';

/**
 * Payment (`payments.status`): `succeeded`, `failed` or `refunded`.
 *
 * SQL copy: `supabase/schemas/85_billing/020_donations.sql` (`kc_private.fsm_state` / `fsm_edge` seeds).
 */
export const paymentMachine = defineMachine({
  id: 'payment',
  states: ['succeeded', 'failed', 'refunded'] as const,
  edges: [
    { from: 'succeeded', to: 'refunded', roles: ['provider'] },
  ],
});
