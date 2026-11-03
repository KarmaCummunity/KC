// match-rerank — matching v2 optional Gemini re-rank. Logic in handler.ts (unit-tested, mocked).
// Off by default: needs matching_settings.llm_rerank_enabled = true AND the GEMINI_API_KEY secret.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { withObservability } from '../_shared/observability/mod.ts';
import { createRerankHandler } from './handler.ts';

const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const supabase = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);

serve(withObservability('match-rerank', createRerankHandler({
  rpc: async (fn, args) => {
    const { data, error } = await supabase.rpc(fn, args);
    return { data, error: error ? { message: error.message } : null };
  },
  fetchFn: fetch,
  geminiKey: Deno.env.get('GEMINI_API_KEY') ?? '',
  model: Deno.env.get('GEMINI_MODEL') ?? 'gemini-2.0-flash',
  serviceKey,
})));
