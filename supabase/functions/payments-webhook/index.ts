// payments-webhook — payment-provider callbacks. Not behind a Supabase JWT (the provider
// cannot send one); the handler verifies the provider's signature and fails closed. Wiring
// only: the logic is in handler.ts.
//
// Secrets (names): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and one signing secret per
// provider, PAYMENTS_WEBHOOK_SECRET_<PROVIDER_SLUG_UPPERCASE> (for example
// PAYMENTS_WEBHOOK_SECRET_SANDBOX).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { reportError, withObservability } from '../_shared/observability/mod.ts';
import { createPaymentsWebhookHandler } from './handler.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
  auth: { persistSession: false },
});

Deno.serve(withObservability('payments-webhook', createPaymentsWebhookHandler({
  secretFor: (slug) => {
    // Only a plain slug maps to a variable name; anything else has no secret.
    if (!/^[a-z][a-z0-9_]{0,40}$/.test(slug)) return null;
    return Deno.env.get(`PAYMENTS_WEBHOOK_SECRET_${slug.toUpperCase()}`) || null;
  },
  async apply(providerSlug, eventId, payload) {
    const { data, error } = await admin.rpc('provider_webhook_apply', {
      p_provider_slug: providerSlug,
      p_event_id: eventId,
      p_payload: payload,
    });
    if (error) throw new Error(error.message);
    return String(data);
  },
  report: (error) => reportError(error, { fn: 'payments-webhook' }),
})));
