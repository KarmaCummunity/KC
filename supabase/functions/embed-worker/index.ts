// embed-worker — Issue #827. Drains embedding_jobs (service-role/cron) through the 0634 RPCs.
// Logic in handler.ts (unit-tested, mocked). Placeholder embedder until a provider is wired.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { withObservability } from '../_shared/observability/mod.ts';
import { createEmbedWorkerHandler } from './handler.ts';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

serve(withObservability('embed-worker', createEmbedWorkerHandler({
  rpc: async (fn, args) => {
    const { data, error } = await supabase.rpc(fn, args);
    return { data, error: error ? { message: error.message } : null };
  },
})));
