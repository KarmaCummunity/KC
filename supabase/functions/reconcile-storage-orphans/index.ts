// reconcile-storage-orphans — TD-122
//
// Daily reconciliation: lists every object in the `post-images` bucket,
// cross-references against `media_assets`, and removes blobs whose owning
// post no longer exists. Triggered by a pg_cron job (migration 0079) via
// net.http_post. Requires service-role key (passed as Bearer token).
//
// POST (no body) → 200 { ok: true, removed: number, errors: number }
//               → 401 { ok: false, error: 'unauthenticated' }
//               → 500 { ok: false, error: string }

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { reportError, withObservability } from '../_shared/observability/mod.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BUCKET = 'post-images';
// Supabase Storage list() max per call.
const PAGE_SIZE = 100;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function listAllObjects(
  client: SupabaseClient,
  prefix = '',
): Promise<string[]> {
  const paths: string[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await client.storage
      .from(BUCKET)
      .list(prefix, { limit: PAGE_SIZE, offset });
    if (error) throw new Error(`list(${prefix}, offset=${offset}): ${error.message}`);
    if (!data || data.length === 0) break;
    for (const obj of data) {
      const fullPath = prefix ? `${prefix}/${obj.name}` : obj.name;
      if (obj.metadata) {
        // It's a file (has metadata), not a folder placeholder.
        paths.push(fullPath);
      } else {
        // It's a folder — recurse.
        const nested = await listAllObjects(client, fullPath);
        paths.push(...nested);
      }
    }
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return paths;
}

serve(withObservability('reconcile-storage-orphans', async (req: Request) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ') || auth.slice(7) !== SUPABASE_SERVICE_ROLE_KEY) {
    return json({ ok: false, error: 'unauthenticated' }, 401);
  }

  try {
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // 1. List all objects in the bucket.
    const allPaths = await listAllObjects(adminClient);
    if (allPaths.length === 0) {
      return json({ ok: true, removed: 0, errors: 0, scanned: 0 });
    }

    // 2. Find which paths still have a media_assets row.
    //    Column is `path` per migration 0002_init_posts.sql:130 — relative
    //    path inside the post-images bucket, same shape that
    //    `listAllObjects` returns above.
    const { data: rows, error: queryErr } = await adminClient
      .from('media_assets')
      .select('path')
      .in('path', allPaths);
    if (queryErr) throw new Error(`media_assets query: ${queryErr.message}`);

    const activePaths = new Set((rows ?? []).map((r: { path: string }) => r.path));
    const orphans = allPaths.filter((p) => !activePaths.has(p));

    if (orphans.length === 0) {
      return json({ ok: true, removed: 0, errors: 0, scanned: allPaths.length });
    }

    // 3. Delete orphaned blobs in batches of 50.
    const BATCH = 50;
    let removed = 0;
    let errors = 0;
    for (let i = 0; i < orphans.length; i += BATCH) {
      const batch = orphans.slice(i, i + BATCH);
      const { error: rmErr } = await adminClient.storage.from(BUCKET).remove(batch);
      if (rmErr) {
        await reportError(rmErr, {
          fn: 'reconcile-storage-orphans',
          req,
          tags: { stage: 'remove' },
          extra: { batch_size: batch.length },
        });
        errors += batch.length;
      } else {
        removed += batch.length;
      }
    }

    console.log(
      `[reconcile-storage-orphans] scanned=${allPaths.length} orphans=${orphans.length} removed=${removed} errors=${errors}`,
    );
    return json({ ok: true, scanned: allPaths.length, removed, errors });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await reportError(err, { fn: 'reconcile-storage-orphans', req });
    return json({ ok: false, error: msg }, 500);
  }
}));
