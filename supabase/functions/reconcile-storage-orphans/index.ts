// reconcile-storage-orphans — service role only; started daily by the database job
// `storage_orphans` (supabase/schemas/95_platform/900_job_registry.sql). Wiring only: the
// reconciliation is in handler.ts.
//
// POST → 200 { ok: true, scanned, removed, errors }   (401 for any caller but the service role)
// Secrets (names): SUPABASE_DB_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import postgres from 'npm:postgres@3.4.5';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { reportError, withObservability } from '../_shared/observability/mod.ts';
import { createOrphanDatabase, createOrphanHandler, type ObjectEntry, type OrphanStorage } from './handler.ts';

const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
// `prepare: false`: the transaction pooler does not keep prepared statements.
const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 2 });
const admin = createClient(Deno.env.get('SUPABASE_URL')!, SERVICE_KEY, { auth: { persistSession: false } });

const storage: OrphanStorage = {
  async list(bucket, prefix, offset, limit) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit, offset });
    if (error) throw error;
    return (data ?? []) as ObjectEntry[];
  },
  async remove(bucket, paths) {
    const { error } = await admin.storage.from(bucket).remove(paths);
    if (error) throw error;
  },
};

Deno.serve(withObservability('reconcile-storage-orphans', createOrphanHandler({
  // The key array is passed as one array parameter.
  db: createOrphanDatabase((text, params) => sql.unsafe(text, params as never[])),
  storage,
  serviceRoleKey: SERVICE_KEY,
  report: (error, tags) => reportError(error, { fn: 'reconcile-storage-orphans', tags }),
})));
