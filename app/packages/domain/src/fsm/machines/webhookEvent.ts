import { defineMachine } from '../machine';

/**
 * Inbound payment webhook processing state.
 *
 * SQL copy: `supabase/schemas/85_billing/030_refunds_payouts_kyc_webhooks.sql` (`kc_private.fsm_state` / `fsm_edge` seeds).
 */
export const webhookEventMachine = defineMachine({
  id: 'webhook_event',
  states: ['pending', 'processed', 'failed'] as const,
  edges: [
    { from: 'pending', to: 'processed' },
    { from: 'pending', to: 'failed' },
    { from: 'failed', to: 'processed' },
  ],
});
