// whatsapp-webhook — Issues #843 / #937 / #938. Logic lives in handler.ts (unit-tested).

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { reportError, withObservability } from '../_shared/observability/mod.ts';
import { createWebhookHandler } from './handler.ts';
import { geminiFromEnv, runAgent } from '../_shared/whatsapp/agent/run.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const rpc = async (fn: string, args: Record<string, unknown>) => {
  const { data, error } = await supabase.rpc(fn, args);
  return { data, error: error ? { message: error.message } : null };
};

// #1091: Gemini agent for linked Pro users. No GOOGLE_GENERATIVE_AI_API_KEY → disabled.
const gemini = geminiFromEnv((k) => Deno.env.get(k), fetch);

serve(withObservability('whatsapp-webhook', createWebhookHandler({
  rpc,
  onProMessage: (input) => {
    // Answer Meta's webhook right away; the agent replies through the outbound queue.
    const job = runAgent({ rpc, gemini }, input)
      .then((r) => console.log(JSON.stringify({ evt: 'wa_agent', status: r.status })))
      .catch((e) => reportError(e, { fn: 'whatsapp-webhook', tags: { job: 'wa_agent' } }));
    if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(job);
    return Promise.resolve();
  },
  verifyToken: Deno.env.get('WHATSAPP_VERIFY_TOKEN') ?? '',
  appSecret: Deno.env.get('WHATSAPP_APP_SECRET') ?? '',
  skipSignatureVerify: Deno.env.get('WHATSAPP_SKIP_SIGNATURE_VERIFY') === 'true',
})));
