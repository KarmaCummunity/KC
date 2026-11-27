// Charges the standing orders that are due (FR-DONATE). One database call,
// `api_standing_orders_charge_due(p_limit)`, opens the charge of every due
// order (an intent whose idempotency key names the order and the due date, so
// a period is charged once) and moves the order to its next date. Each opened
// charge is then handed to the payment provider; the outcome arrives later as
// a provider event on the payments webhook.
//
// No payment provider is integrated yet (sandbox only), so nothing is
// submitted: a provider adapter plugs into `submit`.
//
// Ported from `supabase/functions/subscriptions-charger/handler.ts`.

import type { JobReport } from '../../platform/jobs/scheduledJob';

/** One opened charge, as `api_standing_orders_charge_due` returns it (amounts in agorot). */
export interface DueCharge {
  readonly intent_id: string;
  readonly standing_order_id: string;
  readonly amount_agorot: number;
  readonly mandate_ref: string | null;
}

export interface ChargeDeps {
  /** Calls `api_standing_orders_charge_due(limit)`; rejects on a database error. */
  readonly openDueCharges: (limit: number) => Promise<DueCharge[]>;
  /** Sends one charge to the payment provider. Absent until a provider adapter is wired. */
  readonly submit?: (charge: DueCharge) => Promise<void>;
  /** Receives a failed submission with the intent id only; never a member's data. */
  readonly report: (error: unknown, intentId: string) => void;
}

export const DEFAULT_CHARGE_LIMIT = 20;
export const MAX_CHARGE_LIMIT = 50;

/**
 * Opens up to `limit` due charges and submits them.
 * @returns `{ opened, submitted, failed }`. Rejects when the charges could not be opened.
 */
export async function chargeDueStandingOrders(limit: number, deps: ChargeDeps): Promise<JobReport> {
  const charges = await deps.openDueCharges(limit);
  let submitted = 0;
  let failed = 0;
  for (const charge of deps.submit ? charges : []) {
    try {
      await deps.submit?.(charge);
      submitted += 1;
    } catch (error) {
      // The charge stays open; the provider's failure event (or its absence) settles it.
      failed += 1;
      deps.report(error, charge.intent_id);
    }
  }
  return { opened: charges.length, submitted, failed };
}
