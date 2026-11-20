// process-post-media — service role only. Wiring only: the logic is in handler.ts.
// NOT started by any database job yet: scheduling it is a separate, gated activation step
// (docs/SSOT/OPERATOR_RUNBOOK.md → "Post photo derivatives"). Secrets (names): SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEYS).

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { withObservability } from '../_shared/observability/mod.ts';
import { currentServiceRoleKeys, primaryServiceRoleKey } from '../_shared/serviceRoleGuard.ts';
import { createProcessPostMediaHandler, type MediaStorage } from './handler.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const BUCKET = 'post-images';
const DOWNLOAD_TIMEOUT_MS = 20_000;
const IMMUTABLE_MAX_AGE_SECONDS = '31536000';

const admin = createClient(SUPABASE_URL, primaryServiceRoleKey(), { auth: { persistSession: false } });

/** Reads a response body, aborting as soon as it would pass `maxBytes`. */
async function readCapped(response: Response, maxBytes: number, abort: () => void): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    abort();
    throw new Error(`object larger than recorded (${declared} > ${maxBytes})`);
  }
  if (!response.body) throw new Error('empty body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > maxBytes) {
      abort();
      throw new Error(`object larger than recorded (> ${maxBytes})`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

const storage: MediaStorage = {
  async download(key, maxBytes) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
      const path = key.split('/').map(encodeURIComponent).join('/');
      const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
        headers: { authorization: `Bearer ${primaryServiceRoleKey()}`, apikey: primaryServiceRoleKey() },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`download HTTP ${response.status}`);
      return await readCapped(response, maxBytes, () => controller.abort());
    } finally {
      clearTimeout(timer);
    }
  },
  async upload(key, bytes) {
    const { error } = await admin.storage.from(BUCKET).upload(key, bytes, {
      contentType: 'image/jpeg',
      upsert: false,
      // storage-js sends `max-age=<value>`, so the value is the number of seconds only.
      cacheControl: IMMUTABLE_MAX_AGE_SECONDS,
    });
    if (error) throw new Error(error.message);
  },
};

serve(withObservability('process-post-media', createProcessPostMediaHandler({
  serviceRoleKey: currentServiceRoleKeys(),
  rpc: async (fn, args) => {
    const { data, error } = await admin.rpc(fn, args);
    return { data, error: error ? { message: error.message } : null };
  },
  storage,
})));
