// subscriptions-charger — service role only; started hourly by the database job
// `standing_orders_charge` (supabase/schemas/95_platform/900_job_registry.sql). Wiring only:
// the logic is in handler.ts. No payment provider is integrated yet (sandbox only), so the
// opened charges are not submitted anywhere; a provider adapter plugs into `submit`.
//
// POST { limit? } → 200 { ok: true, opened, submitted, failed }   (401 for any caller but the service role)
// Secrets (names): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { reportError, withObservability } from '../_shared/observability/mod.ts';
import { createChargerHandler, type DueCharge } from './handler.ts';

const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const admin = createClient(Deno.env.get('SUPABASE_URL')!, SERVICE_KEY, { auth: { persistSession: false } });

Deno.serve(withObservability('subscriptions-charger', createChargerHandler({
  serviceRoleKey: SERVICE_KEY,
  async openDueCharges(limit) {
    const { data, error } = await admin.rpc('api_standing_orders_charge_due', { p_limit: limit });
    if (error) throw error;
    return (data ?? []) as DueCharge[];
  },
  report: (error, tags) =>
    reportError(error, {
      fn: 'subscriptions-charger',
      tags: { stage: tags.stage, ...(tags.intent_id ? { intent_id: tags.intent_id } : {}) },
    }),
})));
