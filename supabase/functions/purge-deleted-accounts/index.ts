// purge-deleted-accounts — FR-SETTINGS-012 AC4 (service role, called daily by pg_cron).
//
// Deletes the accounts whose 30-day grace period has ended: for each one
//   1. `delete_account_data_for(user_id)` removes the database rows and returns the post media paths,
//   2. the post media and every object under the user's folders are removed from Storage,
//   3. `auth.admin.deleteUser()` frees the email / SSO identity.
// A failing account is reported and skipped so one bad account never blocks the rest; Storage
// failures are reported but do not stop the account's purge.
//
// POST → 200 { ok: true, purged, failed }   (401 for any caller but the service role)

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { reportError, withObservability } from '../_shared/observability/mod.ts';
import { isServiceRoleRequest, serviceRoleRequiredResponse } from '../_shared/serviceRoleGuard.ts';
import { purgeUserFolders, type StorageGateway, type StorageListEntry } from '../_shared/storageCleanup.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

/** Accounts purged per run; the rest wait for the next day's run. */
const BATCH_SIZE = 50;

interface PurgeRpcResult {
  media_paths: string[];
}

/** Adapts the service-role Storage client to the purge's gateway (errors reject). */
function storageGateway(admin: SupabaseClient): StorageGateway {
  return {
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
}

/** Removes the user's Storage objects; failures are reported, never thrown. */
async function purgeStorage(admin: SupabaseClient, userId: string, mediaPaths: string[], req: Request): Promise<void> {
  const report = (error: unknown, bucket: string) =>
    reportError(error, { fn: 'purge-deleted-accounts', req, tags: { stage: 'storage_cleanup', bucket } });
  try {
    if (mediaPaths.length > 0) {
      const { error } = await admin.storage.from('post-images').remove(mediaPaths);
      if (error) await report(error, 'post-images');
    }
    await purgeUserFolders(storageGateway(admin), userId, report);
  } catch (e) {
    await report(e, 'unknown');
  }
}

/** Deletes the auth identity, retrying once: after step 1 the account is no longer listed as due. */
async function deleteAuthUser(admin: SupabaseClient, userId: string): Promise<{ message: string } | null> {
  let last: { message: string } | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (!error) return null;
    last = error;
  }
  return last;
}

/** Purges one account. Returns true when it is gone completely. */
async function purgeAccount(admin: SupabaseClient, userId: string, req: Request): Promise<boolean> {
  const { data, error } = await admin.rpc('delete_account_data_for', { p_user_id: userId });
  if (error) {
    await reportError(error, { fn: 'purge-deleted-accounts', req, tags: { stage: 'db_purge' } });
    return false;
  }
  await purgeStorage(admin, userId, (data as PurgeRpcResult).media_paths ?? [], req);

  const authError = await deleteAuthUser(admin, userId);
  if (authError) {
    // The database rows are gone, so this identity needs manual cleanup.
    await reportError(authError, { fn: 'purge-deleted-accounts', req, tags: { stage: 'auth_delete', user_id: userId } });
    return false;
  }
  return true;
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

  let purged = 0;
  let failed = 0;
  for (const row of (due ?? []) as { user_id: string }[]) {
    if (await purgeAccount(admin, row.user_id, req)) purged++;
    else failed++;
  }
  return new Response(JSON.stringify({ ok: true, purged, failed }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}));
