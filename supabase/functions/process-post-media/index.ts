// KC#2316. One-minute worker, ten photos per lease; also drains old pending rows.
// Uses the same transaction-pooler secret as account purge. No public SQL RPC.
import postgres from 'npm:postgres@3.4.5';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { encodePostImage } from './image.ts';
import { currentServiceRoleKeys, primaryServiceRoleKey } from '../_shared/serviceRoleGuard.ts';
import { reportError, withObservability } from '../_shared/observability/mod.ts';
import { createMediaHandler, type MediaJob } from './handler.ts';

const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 2 });
const admin = createClient(Deno.env.get('SUPABASE_URL')!, primaryServiceRoleKey(), { auth: { persistSession: false } });
const bucket = admin.storage.from('post-images');

Deno.serve(withObservability('process-post-media', createMediaHandler({
  serviceRoleKey: currentServiceRoleKeys(),
  async claim() {
    return await sql<MediaJob[]>`select * from kc_private.claim_post_media()`;
  },
  async finish(job, ok) {
    const rows = await sql`select kc_private.finish_post_media(${job.id}, ${job.attempts}, ${ok}) as finished`;
    return rows[0].finished === true;
  },
  async download(path) {
    const { data, error } = await bucket.download(path);
    if (error || !data) throw error ?? new Error('missing_image');
    return new Uint8Array(await data.arrayBuffer());
  },
  encode: encodePostImage,
  async upload(path, bytes, mime) {
    const { error } = await bucket.upload(path, bytes, { contentType: mime, upsert: true, cacheControl: '3600' });
    if (error) throw error;
  },
  report: (error) => reportError(error, { fn: 'process-post-media' }),
})));
