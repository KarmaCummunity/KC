// whatsapp-sender — Issue #938. Logic lives in handler.ts (unit-tested with a mocked Meta API).

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { withObservability } from '../_shared/observability/mod.ts';
import { createSenderHandler } from './handler.ts';

const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const supabase = createClient(Deno.env.get('SUPABASE_URL')!, SERVICE_KEY);

serve(withObservability('whatsapp-sender', createSenderHandler({
  serviceKey: SERVICE_KEY,
  rpc: async (fn, args) => {
    const { data, error } = await supabase.rpc(fn, args);
    return { data, error: error ? { message: error.message } : null };
  },
  loadChannelConfig: async () => {
    const { data } = await supabase
      .from('whatsapp_channel_config')
      .select('is_enabled, phone_number_id, graph_api_version')
      .limit(1)
      .maybeSingle();
    return data ?? null;
  },
  token: Deno.env.get('WHATSAPP_CLOUD_API_TOKEN') ?? '',
  phoneNumberId: Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') ?? '',
  graphVersion: Deno.env.get('WHATSAPP_GRAPH_API_VERSION') ?? '',
})));
