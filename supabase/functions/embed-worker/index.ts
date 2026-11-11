// embed-worker — service role only; started every two minutes by the database job
// `embed_worker` (supabase/schemas/95_platform/900_job_registry.sql). Wiring only: the
// logic is in handler.ts. Secrets (names): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { withObservability } from '../_shared/observability/mod.ts';
import { createEmbedWorkerHandler } from './handler.ts';

const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const supabase = createClient(Deno.env.get('SUPABASE_URL')!, SERVICE_KEY);

serve(withObservability('embed-worker', createEmbedWorkerHandler({
  serviceRoleKey: SERVICE_KEY,
  rpc: async (fn, args) => {
    const { data, error } = await supabase.rpc(fn, args);
    return { data, error: error ? { message: error.message } : null };
  },
})));
