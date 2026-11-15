import { defineMachine } from '../machine';

/**
 * Organization finance ledger entry (`org_finance_entries.status`).
 *
 * SQL copy: `supabase/schemas/85_billing/060_org_finance.sql` (`kc_private.fsm_state` / `fsm_edge` seeds).
 */
export const orgFinanceEntryMachine = defineMachine({
  id: 'org_finance_entry',
  states: ['pending', 'cleared', 'cancelled'] as const,
  edges: [
    { from: 'pending', to: 'cleared' },
    { from: 'cleared', to: 'pending' },
    { from: 'pending', to: 'cancelled' },
    { from: 'cleared', to: 'cancelled' },
  ],
});
