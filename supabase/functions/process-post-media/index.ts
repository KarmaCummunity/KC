// process-post-media — service role only. Wiring only: the logic is in handler.ts.
// Started by the database (debounced kick on a new photo job, and the minute job
// `post_media_process`); see docs/SSOT/OPERATOR_RUNBOOK.md → "Post photo derivatives".
// Secrets (names): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEYS).

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { withObservability } from '../_shared/observability/mod.ts';
import { currentServiceRoleKeys, primaryServiceRoleKey } from '../_shared/serviceRoleGuard.ts';
import { createProcessPostMediaHandler, type MediaStorage } from './handler.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
/** Where the sanitized copies are written (and removed): always the public bucket, under `derived/`. */
const COPY_BUCKET = 'post-images';
const DOWNLOAD_TIMEOUT_MS = 20_000;
const IMMUTABLE_MAX_AGE_SECONDS = '31536000';

const admin = createClient(SUPABASE_URL, primaryServiceRoleKey(), { auth: { persistSession: false } });

/**
 * Whether Storage answered "no such object": 404, or the 400 whose JSON body carries
 * statusCode "404" (how storage-api reports a missing object on some versions).
 */
async function isMissingObject(response: Response): Promise<boolean> {
  if (response.status === 404) return true;
  if (response.status !== 400) return false;
  const body = await response.json().catch(() => null) as { statusCode?: unknown } | null;
  return String(body?.statusCode) === '404';
}

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
  // The authenticated object route: it serves private buckets (`post-uploads`) to the service role.
  async download(bucket, key, maxBytes, signal) {
    const controller = new AbortController();
    signal.addEventListener('abort', () => controller.abort(), { once: true });
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
      const path = key.split('/').map(encodeURIComponent).join('/');
      const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
        headers: { authorization: `Bearer ${primaryServiceRoleKey()}`, apikey: primaryServiceRoleKey() },
        signal: controller.signal,
      });
      if (!response.ok) {
        if (await isMissingObject(response)) return null;
        throw new Error(`download HTTP ${response.status}`);
      }
      return await readCapped(response, maxBytes, () => controller.abort());
    } finally {
      clearTimeout(timer);
    }
  },
  // Through fetch, not storage-js: storage-js cannot abort an upload, and the lease bounds writes.
  async upload(key, bytes, contentType, signal) {
    const path = key.split('/').map(encodeURIComponent).join('/');
    const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${COPY_BUCKET}/${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${primaryServiceRoleKey()}`,
        apikey: primaryServiceRoleKey(),
        'content-type': contentType,
        'cache-control': `public, max-age=${IMMUTABLE_MAX_AGE_SECONDS}, immutable`,
        'x-upsert': 'false',
      },
      body: new Uint8Array(bytes), // an ArrayBuffer-backed copy, the body type fetch accepts
      signal,
    });
    if (!response.ok) throw new Error(`upload HTTP ${response.status}`);
  },
  // Through fetch for the same reason as upload: storage-js cannot abort a request.
  async remove(keys, signal) {
    const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${COPY_BUCKET}`, {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${primaryServiceRoleKey()}`,
        apikey: primaryServiceRoleKey(),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ prefixes: keys }),
      signal,
    });
    if (!response.ok) throw new Error(`remove HTTP ${response.status}`);
  },
};

serve(withObservability('process-post-media', createProcessPostMediaHandler({
  serviceRoleKey: currentServiceRoleKeys(),
  rpc: async (fn, args, signal) => {
    // postgrest-js aborts the HTTP request; a statement already running in the database may still finish.
    const { data, error } = await admin.rpc(fn, args).abortSignal(signal);
    return { data, error: error ? { message: error.message } : null };
  },
  storage,
})));
