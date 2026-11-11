import { defineMachine } from '../machine';

/**
 * Donation intent (`donation_intents.status`): a checkout that the provider settles as `succeeded` or `failed`.
 *
 * SQL copy: `supabase/schemas/85_billing/020_donations.sql` (`kc_private.fsm_state` / `fsm_edge` seeds).
 */
export const donationIntentMachine = defineMachine({
  id: 'donation_intent',
  states: ['created', 'checkout', 'succeeded', 'failed', 'cancelled'] as const,
  edges: [
    { from: 'created', to: 'checkout' },
    { from: 'created', to: 'cancelled' },
    { from: 'checkout', to: 'cancelled' },
    { from: 'checkout', to: 'succeeded', roles: ['provider'] },
    { from: 'checkout', to: 'failed', roles: ['provider'] },
    { from: 'failed', to: 'succeeded', roles: ['provider'] },
  ],
});
