// purge-deleted-accounts — FR-SETTINGS-012 AC4 (service role, called daily by pg_cron).
//
// Deletes the accounts whose 30-day grace period has ended, in the order of `_shared/accountPurge.ts`:
// Storage first, then the database rows, then the auth identity (which cascades the users row).
// A failing account is reported and stays `pending_deletion`, so the next run retries it (0699);
// one bad account never blocks the rest.
//
// POST → 200 { ok: true, purged, failed }   (401 for any caller but the service role)

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { reportError, withObservability } from '../_shared/observability/mod.ts';
import { isServiceRoleRequest, serviceRoleRequiredResponse } from '../_shared/serviceRoleGuard.ts';
import { type AccountPurgeGateway, purgeAccount } from '../_shared/accountPurge.ts';
import type { StorageListEntry } from '../_shared/storageCleanup.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

/** Accounts purged per run; the rest wait for the next day's run. */
const BATCH_SIZE = 50;

/** Binds the purge steps to the service-role client; every call rejects on an error. */
function purgeGateway(admin: SupabaseClient): AccountPurgeGateway {
  return {
    async mediaPaths(userId) {
      const { data, error } = await admin.rpc('account_purge_media_paths', { p_user_id: userId });
      if (error) throw error;
      return (data ?? []) as string[];
    },
    storage: {
      async list(bucket, prefix, offset, limit) {
        const { data, error } = await admin.storage.from(bucket).list(prefix, { limit, offset });
        if (error) throw error;
        return (data ?? []) as StorageListEntry[];
      },
      async remove(bucket, paths) {
        const { error } = await admin.storage.from(bucket).remove(paths);
        if (error) throw error;
      },
    },
    async deleteData(userId) {
      const { error } = await admin.rpc('delete_account_data_for', { p_user_id: userId });
      if (error) throw error;
    },
    async deleteIdentity(userId) {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) throw error;
    },
  };
}

// The handler is inline so the service-role check is visibly the first thing `serve` runs
// (the regression test in `_shared/serviceRoleGuard.test.ts` reads it from here).
serve(withObservability('purge-deleted-accounts', async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  if (!isServiceRoleRequest(req, SERVICE_KEY)) return serviceRoleRequiredResponse();

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: due, error } = await admin.rpc('accounts_due_for_purge', { p_limit: BATCH_SIZE });
  if (error) {
    await reportError(error, { fn: 'purge-deleted-accounts', req, tags: { stage: 'list_due' } });
    return new Response(JSON.stringify({ ok: false, error: 'db_failed' }), { status: 500 });
  }

  const gateway = purgeGateway(admin);
  let purged = 0;
  let failed = 0;
  for (const row of (due ?? []) as { user_id: string }[]) {
    const report = (error: unknown, stage: string, bucket?: string) =>
      reportError(error, {
        fn: 'purge-deleted-accounts',
        req,
        tags: { stage, user_id: row.user_id, ...(bucket ? { bucket } : {}) },
      });
    if (await purgeAccount(gateway, row.user_id, report)) purged++;
    else failed++;
  }
  return new Response(JSON.stringify({ ok: true, purged, failed }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}));
