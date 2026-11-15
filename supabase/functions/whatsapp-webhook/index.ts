// whatsapp-webhook — Issues #843 / #937 / #938. Logic lives in handler.ts (unit-tested).

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { reportError, withObservability } from '../_shared/observability/mod.ts';
import { createWebhookHandler } from './handler.ts';
import { geminiFromEnv, runAgent } from '../_shared/whatsapp/agent/run.ts';
import { handleProPhoto, POST_PHOTO_BUCKET, type PhotoDeps } from '../_shared/whatsapp/photo.ts';
import { detectLang } from '../_shared/whatsapp/replies.ts';

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
const appBaseUrl = Deno.env.get('KC_APP_BASE_URL') || undefined;

// D158: a photo sent in the chat completes the member's waiting bot draft.
const photoDeps: PhotoDeps = {
  rpc,
  fetch,
  graph: {
    token: Deno.env.get('WHATSAPP_CLOUD_API_TOKEN') ?? '',
    graphVersion: Deno.env.get('WHATSAPP_GRAPH_API_VERSION') || undefined,
  },
  storage: {
    upload: async (path, bytes, contentType) => {
      const { error } = await supabase.storage.from(POST_PHOTO_BUCKET).upload(path, bytes, {
        contentType,
        upsert: false,
        cacheControl: 'public, max-age=31536000, immutable',
      });
      return { error: error ? { message: error.message } : null };
    },
    remove: async (path) => {
      await supabase.storage.from(POST_PHOTO_BUCKET).remove([path]);
    },
  },
  appBaseUrl,
};

// Answer Meta's webhook right away; slow work replies through the outbound queue.
function inBackground(name: string, job: Promise<{ status: string }>) {
  const run = job
    .then((r) => console.log(JSON.stringify({ evt: name, status: r.status })))
    .catch((e) => reportError(e, { fn: 'whatsapp-webhook', tags: { job: name } }));
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(run);
  return Promise.resolve();
}

serve(withObservability('whatsapp-webhook', createWebhookHandler({
  rpc,
  onProMessage: (input) => inBackground('wa_agent', runAgent({ rpc, gemini, appBaseUrl }, input)),
  onProPhoto: (p) =>
    inBackground('wa_photo', handleProPhoto(photoDeps, {
      waId: p.waId,
      userId: p.userId,
      mediaId: p.mediaId,
      mimeType: p.mimeType,
      lang: detectLang(p.caption),
    })),
  verifyToken: Deno.env.get('WHATSAPP_VERIFY_TOKEN') ?? '',
  appSecret: Deno.env.get('WHATSAPP_APP_SECRET') ?? '',
  skipSignatureVerify: Deno.env.get('WHATSAPP_SKIP_SIGNATURE_VERIFY') === 'true',
})));
