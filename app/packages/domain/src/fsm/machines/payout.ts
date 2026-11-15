import { defineMachine } from '../machine';

/**
 * Payout to an organization, driven by the payment provider.
 *
 * SQL copy: `supabase/schemas/85_billing/030_refunds_payouts_kyc_webhooks.sql` (`kc_private.fsm_state` / `fsm_edge` seeds).
 */
export const payoutMachine = defineMachine({
  id: 'payout',
  states: ['pending', 'succeeded', 'failed'] as const,
  edges: [
    { from: 'pending', to: 'succeeded', roles: ['provider'] },
    { from: 'pending', to: 'failed', roles: ['provider'] },
  ],
});
