// purge-deleted-accounts — service role only; started daily by the database job
// `account_purge` (supabase/schemas/95_platform/900_job_registry.sql). Wiring only: the
// purge is in handler.ts. The worker's functions live in `kc_private`, which the HTTP API
// does not expose, so it connects through the transaction pooler.
//
// POST → 200 { ok: true, purged, failed }   (401 for any caller but the service role)
// Secrets (names): SUPABASE_DB_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import postgres from 'npm:postgres@3.4.5';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { reportError, withObservability } from '../_shared/observability/mod.ts';
import type { StorageListEntry } from '../_shared/storageCleanup.ts';
import { createPurgeDatabase, createPurgeHandler, type PurgeStorage } from './handler.ts';

const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
// `prepare: false`: the transaction pooler does not keep prepared statements.
const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 2 });
const admin = createClient(Deno.env.get('SUPABASE_URL')!, SERVICE_KEY, { auth: { persistSession: false } });

const storage: PurgeStorage = {
  async buckets() {
    const { data, error } = await admin.storage.listBuckets();
    if (error) throw error;
    return (data ?? []).map((bucket) => bucket.id);
  },
  async list(bucket, prefix, offset, limit) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit, offset });
    if (error) throw error;
    return (data ?? []) as StorageListEntry[];
  },
  async remove(bucket, paths) {
    const { error } = await admin.storage.from(bucket).remove(paths);
    if (error) throw error;
  },
};

Deno.serve(withObservability('purge-deleted-accounts', createPurgeHandler({
  db: createPurgeDatabase((text, params) => sql.unsafe(text, params as never[])),
  storage,
  serviceRoleKey: SERVICE_KEY,
  report: (error, tags) =>
    reportError(error, {
      fn: 'purge-deleted-accounts',
      tags: { stage: tags.stage, ...(tags.user_id ? { user_id: tags.user_id } : {}) },
    }),
})));
