// whatsapp-sender — Issue #938. Logic lives in handler.ts (unit-tested with a mocked Meta API).

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { withObservability } from '../_shared/observability/mod.ts';
import { createSenderHandler, loadChannelConfigViaRpc } from './handler.ts';

const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const supabase = createClient(Deno.env.get('SUPABASE_URL')!, SERVICE_KEY);

const rpc = async (fn: string, args: Record<string, unknown>) => {
  const { data, error } = await supabase.rpc(fn, args);
  return { data, error: error ? { message: error.message } : null };
};

serve(withObservability('whatsapp-sender', createSenderHandler({
  serviceKey: SERVICE_KEY,
  rpc,
  loadChannelConfig: () => loadChannelConfigViaRpc(rpc),
  token: Deno.env.get('WHATSAPP_CLOUD_API_TOKEN') ?? '',
  phoneNumberId: Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') ?? '',
  graphVersion: Deno.env.get('WHATSAPP_GRAPH_API_VERSION') ?? '',
})));
