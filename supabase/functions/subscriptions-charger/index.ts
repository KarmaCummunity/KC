// subscriptions-charger — Issue #850 standing-order dunning stub (service role)

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { withObservability } from '../_shared/observability/mod.ts';
import { isServiceRoleRequest, serviceRoleRequiredResponse } from '../_shared/serviceRoleGuard.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(withObservability('subscriptions-charger', async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  if (!isServiceRoleRequest(req, SERVICE_KEY)) return serviceRoleRequiredResponse();
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const limit = Math.min(Number((await req.json().catch(() => ({}))).limit) || 20, 50);

  const { data: orders, error } = await supabase
    .from('standing_orders')
    .select('order_id, user_id, org_id, amount_ils')
    .eq('status', 'active')
    .lte('next_charge_at', new Date().toISOString())
    .limit(limit);

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true, due: orders?.length ?? 0 }), {
    headers: { 'Content-Type': 'application/json' },
  });
}));
