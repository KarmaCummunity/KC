import { defineMachine } from '../machine';

/**
 * Organization identity check (KYC) driven by the provider.
 *
 * SQL copy: `supabase/schemas/85_billing/030_refunds_payouts_kyc_webhooks.sql` (`kc_private.fsm_state` / `fsm_edge` seeds).
 */
export const kycMachine = defineMachine({
  id: 'kyc',
  states: ['pending', 'approved', 'rejected'] as const,
  edges: [
    { from: 'pending', to: 'approved', roles: ['provider'] },
    { from: 'pending', to: 'rejected', roles: ['provider'] },
    { from: 'rejected', to: 'pending', roles: ['provider'] },
    { from: 'approved', to: 'pending', roles: ['provider'] },
    { from: 'approved', to: 'rejected', roles: ['provider'] },
    { from: 'rejected', to: 'approved', roles: ['provider'] },
  ],
});
