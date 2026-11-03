// receipts-issuer — Issue #850 section-46 receipt stub (service role)

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { withObservability } from '../_shared/observability/mod.ts';
import { isServiceRoleRequest, serviceRoleRequiredResponse } from '../_shared/serviceRoleGuard.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(withObservability('receipts-issuer', async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  if (!isServiceRoleRequest(req, SERVICE_KEY)) return serviceRoleRequiredResponse();
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const { payment_id: paymentId } = await req.json().catch(() => ({}));
  if (!paymentId) {
    return new Response(JSON.stringify({ ok: false, error: 'payment_id required' }), { status: 400 });
  }

  const { data: payment, error: pErr } = await supabase
    .from('payments')
    .select('payment_id, user_id, org_id, amount_ils, status')
    .eq('payment_id', paymentId)
    .maybeSingle();

  if (pErr || !payment || payment.status !== 'succeeded') {
    return new Response(JSON.stringify({ ok: false, error: pErr?.message ?? 'payment not succeeded' }), {
      status: 400,
    });
  }

  const serial = `S46-${paymentId.slice(0, 8).toUpperCase()}`;
  const { error: insErr } = await supabase.from('donation_receipts').upsert(
    {
      payment_id: payment.payment_id,
      org_id: payment.org_id,
      user_id: payment.user_id,
      section46_serial: serial,
      payload: { amount_ils: payment.amount_ils },
    },
    { onConflict: 'payment_id' },
  );

  if (insErr) {
    return new Response(JSON.stringify({ ok: false, error: insErr.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true, section46_serial: serial }), {
    headers: { 'Content-Type': 'application/json' },
  });
}));
