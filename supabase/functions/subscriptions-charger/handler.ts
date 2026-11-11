// subscriptions-charger — charges the standing orders that are due
// (FR-DONATE, supabase/schemas/85_billing/080_provider_events.sql). One database call,
// api_standing_orders_charge_due(p_limit), opens the charge of every due order (an intent
// whose idempotency key names the order and the due date, so a period is charged once)
// and moves the order to its next date. The worker then hands each returned charge to the
// payment provider; the outcome arrives later as a provider event on `payments-webhook`.
// Service role only; started hourly by the database job `standing_orders_charge`.
import { isServiceRoleRequest, serviceRoleRequiredResponse } from '../_shared/serviceRoleGuard.ts';

/** One opened charge, as api_standing_orders_charge_due returns it (amounts in agorot). */
export interface DueCharge {
  readonly intent_id: string;
  readonly standing_order_id: string;
  readonly amount_agorot: number;
  readonly mandate_ref: string | null;
}

export interface ChargerDeps {
  /** The project's service-role key; the only credential the worker accepts. */
  readonly serviceRoleKey: string;
  /** Calls `api_standing_orders_charge_due(limit)`. */
  readonly openDueCharges: (limit: number) => Promise<DueCharge[]>;
  /** Sends one charge to the payment provider. Absent until a provider adapter is wired. */
  readonly submit?: (charge: DueCharge) => Promise<void>;
  /** Receives a failure with ids only; never a member's data. */
  readonly report: (error: unknown, tags: { stage: 'open' | 'submit'; intent_id?: string }) => Promise<void>;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Reads the optional `limit` of the body, clamped to 1..MAX_LIMIT; the default when absent or not a number. */
async function readLimit(req: Request): Promise<number> {
  const body = await req.json().catch(() => ({}));
  const asked = Number((body as { limit?: unknown }).limit);
  return Number.isFinite(asked) && asked >= 1 ? Math.min(Math.floor(asked), MAX_LIMIT) : DEFAULT_LIMIT;
}

/** POST { limit? } → 200 { ok, opened, submitted, failed }; 401 for any caller but the service role. */
export function createChargerHandler(deps: ChargerDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
    if (!isServiceRoleRequest(req, deps.serviceRoleKey)) return serviceRoleRequiredResponse();

    let charges: DueCharge[];
    try {
      charges = await deps.openDueCharges(await readLimit(req));
    } catch (error) {
      await deps.report(error, { stage: 'open' });
      return json({ ok: false, error: 'internal' }, 500);
    }

    let submitted = 0;
    let failed = 0;
    for (const charge of deps.submit ? charges : []) {
      try {
        await deps.submit!(charge);
        submitted += 1;
      } catch (error) {
        // The charge stays open; the provider's failure event (or its absence) settles it.
        failed += 1;
        await deps.report(error, { stage: 'submit', intent_id: charge.intent_id });
      }
    }
    return json({ ok: true, opened: charges.length, submitted, failed });
  };
}
