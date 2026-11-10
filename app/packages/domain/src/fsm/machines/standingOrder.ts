import { STANDING_ORDER_STATUSES } from '../../payments/PaymentTypes';
import { defineMachine } from '../machine';

/**
 * In-app standing order lifecycle (`standing_orders.status`, sandbox provider, `0269` / `0363`;
 * spec `docs/spec/requirements/13_donations.md` FR-DONATE, behind `money_in_app_org_payments`).
 *
 * - The donor pauses and resumes an order (`pause_standing_order`, `resume_standing_order`).
 * - Cancelling, from either state, is final (`cancel_standing_order`): a new order is a new row.
 *
 * Provider-driven states (a failed charge) arrive with the payment provider webhook (G8).
 *
 * SQL copy: `supabase/migrations/0719_fsm_recurring.sql`.
 */
export const standingOrderMachine = defineMachine({
  id: 'standing_order',
  states: STANDING_ORDER_STATUSES,
  edges: [
    { from: 'active', to: 'paused' },
    { from: 'paused', to: 'active' },
    { from: 'active', to: 'cancelled' },
    { from: 'paused', to: 'cancelled' },
  ],
});
