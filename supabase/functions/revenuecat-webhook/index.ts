// revenuecat-webhook — grants/revokes Pro (user_entitlements) from RevenueCat events. Logic in handler.ts.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { withObservability } from '../_shared/observability/mod.ts';
import { createRevenueCatHandler } from './handler.ts';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

serve(withObservability('revenuecat-webhook', createRevenueCatHandler({
  rpc: async (fn, args) => {
    const { data, error } = await supabase.rpc(fn, args);
    return { data, error: error ? { message: error.message } : null };
  },
  authSecret: Deno.env.get('REVENUECAT_WEBHOOK_AUTH') ?? '',
  entitlementId: Deno.env.get('REVENUECAT_PRO_ENTITLEMENT_ID') ?? 'pro',
})));
