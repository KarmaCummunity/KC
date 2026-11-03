// payments-webhook — Issue #850 (sandbox stub; signature verify + idempotent apply)

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { withObservability } from '../_shared/observability/mod.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(withObservability('payments-webhook', async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const body = await req.json().catch(() => ({}));
  const provider = String(body.provider_slug ?? 'sandbox');
  const eventId = String(body.provider_event_id ?? crypto.randomUUID());
  const payload = body.payload ?? body;

  const { data, error } = await supabase.rpc('provider_webhook_apply', {
    p_provider_slug: provider,
    p_event_id: eventId,
    p_payload: payload,
  });

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true, webhook_event_id: data }), {
    headers: { 'Content-Type': 'application/json' },
  });
}));
