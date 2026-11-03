// backfill-image-thumbs — PERF-4 part 2 of 2
//
// Generates 400px post thumbnails and 96px avatar thumbnails for objects
// uploaded before the PR-1a thumb pipeline shipped. New uploads after PR-1a
// always include their own -thumb sibling; this function fills in the rest.
//
// For each full-size object missing its `-thumb` sibling, downloads the
// original, resizes via ImageMagick WASM, and uploads the thumb with
// `cache-control: public, max-age=31536000, immutable`. Idempotent: existing
// thumbs are skipped.
//
// Triggered manually (or via cron) with optional body:
//   { "bucket"?: "post-images" | "avatars" | "both",
//     "pageLimit"?: number,        // max objects to process per invocation; default 100
//     "lookbackHours"?: number,    // only objects newer than N hours; default null (all)
//     "dryRun"?: boolean }
//
// POST → 200 { ok: true, bucket, scanned, generated, skipped_existing, errors, more }
//      → 401 { ok: false, error: "unauthenticated" }
//      → 500 { ok: false, error: string }
//
// Runbook entry: docs/SSOT/OPERATOR_RUNBOOK.md → "Backfill image thumbs".

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { Jimp } from 'https://esm.sh/jimp@1.6.0';
import { reportError, withObservability } from '../_shared/observability/mod.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const LIST_PAGE = 100;

/**
 * The Supabase gateway already verifies the JWT signature before forwarding
 * to this function (verify_jwt: true is the default). We additionally check
 * the role claim equals "service_role" so anon / authenticated users with
 * valid JWTs can't trigger the backfill. Robust to env-var format drift
 * between legacy JWT and new `sb_secret_` key formats.
 */
function isServiceRoleJwt(bearer: string): boolean {
  if (!bearer.startsWith('Bearer ')) return false;
  const token = bearer.slice(7);
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload?.role === 'service_role';
  } catch {
    return false;
  }
}
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

// Bucket-specific thumb sizing.
const THUMB_CONFIG: Record<string, { maxEdge: number; quality: number }> = {
  'post-images': { maxEdge: 400, quality: 75 },
  'avatars': { maxEdge: 96, quality: 75 },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type AdminClient = SupabaseClient;

/** `a/b/c.jpg` → `a/b/c-thumb.jpg`. Mirrors the FE helper in `apps/mobile/src/lib/imageUrl.ts`. */
function deriveThumbPath(path: string): string {
  if (!path) return path;
  const dotIdx = path.lastIndexOf('.');
  const slashIdx = path.lastIndexOf('/');
  if (dotIdx === -1 || dotIdx < slashIdx) return `${path}-thumb`;
  return `${path.slice(0, dotIdx)}-thumb${path.slice(dotIdx)}`;
}

function isThumbPath(name: string): boolean {
  return /-thumb(\.[a-zA-Z0-9]+)?$/.test(name);
}

interface ListedBucket {
  /** Non-thumb object paths, oldest-first. */
  originals: string[];
  /** Set of paths that already exist as thumbs (e.g., `a/b/0-thumb.jpg`). */
  existingThumbs: Set<string>;
}

async function listBucket(
  admin: AdminClient,
  bucket: string,
  sinceIso: string | null,
  prefix = '',
): Promise<ListedBucket> {
  const originals: string[] = [];
  const existingThumbs = new Set<string>();
  let offset = 0;
  while (true) {
    const { data, error } = await admin.storage
      .from(bucket)
      .list(prefix, { limit: LIST_PAGE, offset, sortBy: { column: 'created_at', order: 'asc' } });
    if (error) throw new Error(`list(${bucket}/${prefix}): ${error.message}`);
    if (!data || data.length === 0) break;

    for (const obj of data) {
      const fullPath = prefix ? `${prefix}/${obj.name}` : obj.name;
      if (obj.metadata) {
        if (isThumbPath(obj.name)) {
          existingThumbs.add(fullPath);
          continue;
        }
        if (sinceIso) {
          const created = obj.created_at ?? obj.updated_at ?? '';
          if (created < sinceIso) continue;
        }
        originals.push(fullPath);
      } else {
        const nested = await listBucket(admin, bucket, sinceIso, fullPath);
        originals.push(...nested.originals);
        for (const t of nested.existingThumbs) existingThumbs.add(t);
      }
    }
    if (data.length < LIST_PAGE) break;
    offset += LIST_PAGE;
  }
  return { originals, existingThumbs };
}

async function resizeToJpeg(bytes: Uint8Array, maxEdge: number, quality: number): Promise<Uint8Array> {
  // Jimp accepts ArrayBuffer / Uint8Array directly via `Jimp.read(buffer)`.
  // The v1 API uses static `Jimp.read(...)` returning a `Jimp` instance.
  const img = await Jimp.read(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const ratio = Math.min(maxEdge / img.width, maxEdge / img.height, 1);
  const targetW = Math.max(1, Math.round(img.width * ratio));
  const targetH = Math.max(1, Math.round(img.height * ratio));
  if (ratio < 1) img.resize({ w: targetW, h: targetH });
  const out = await img.getBuffer('image/jpeg', { quality });
  return new Uint8Array(out);
}

interface BackfillStats {
  bucket: string;
  scanned: number;
  generated: number;
  skipped_existing: number;
  errors: number;
  more: boolean;
  first_error?: string;
}

async function backfillBucket(
  admin: AdminClient,
  bucket: string,
  opts: { pageLimit: number; sinceIso: string | null; dryRun: boolean },
): Promise<BackfillStats> {
  const cfg = THUMB_CONFIG[bucket];
  if (!cfg) throw new Error(`unknown bucket: ${bucket}`);

  const { originals, existingThumbs } = await listBucket(admin, bucket, opts.sinceIso);
  const stats: BackfillStats = {
    bucket,
    scanned: 0,
    generated: 0,
    skipped_existing: 0,
    errors: 0,
    more: false,
  };

  const recordError = (path: string, stage: string, err: unknown) => {
    stats.errors++;
    const msg = err instanceof Error ? err.message : String(err);
    if (!stats.first_error) stats.first_error = `${stage}@${bucket}/${path}: ${msg}`;
    console.error(`[backfill-image-thumbs] ${stage}@${bucket}/${path}:`, msg);
  };

  // Walk all originals oldest-first; pageLimit caps the number of *new* thumbs
  // generated per invocation, not the total scanned. Already-thumbed objects
  // are recognised via the in-memory `existingThumbs` set populated by
  // listBucket (no per-object list ops).
  for (const path of originals) {
    if (stats.generated >= opts.pageLimit) {
      stats.more = true;
      break;
    }
    stats.scanned++;
    const thumbPath = deriveThumbPath(path);
    if (existingThumbs.has(thumbPath)) {
      stats.skipped_existing++;
      continue;
    }
    try {
      if (opts.dryRun) {
        stats.generated++;
        continue;
      }
      const { data: blob, error: dlErr } = await admin.storage.from(bucket).download(path);
      if (dlErr || !blob) {
        recordError(path, 'download', dlErr ?? new Error('null blob'));
        continue;
      }
      const originalBytes = new Uint8Array(await blob.arrayBuffer());
      let thumbBytes: Uint8Array;
      try {
        thumbBytes = await resizeToJpeg(originalBytes, cfg.maxEdge, cfg.quality);
      } catch (err) {
        recordError(path, 'resize', err);
        continue;
      }
      const { error: upErr } = await admin.storage
        .from(bucket)
        .upload(thumbPath, thumbBytes, {
          contentType: 'image/jpeg',
          upsert: true,
          cacheControl: IMMUTABLE_CACHE_CONTROL,
        });
      if (upErr) {
        recordError(path, 'upload', upErr);
        continue;
      }
      stats.generated++;
    } catch (err) {
      recordError(path, 'unknown', err);
    }
  }
  return stats;
}

serve(withObservability('backfill-image-thumbs', async (req: Request) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  const auth = req.headers.get('Authorization') ?? '';
  if (!isServiceRoleJwt(auth)) {
    return json({ ok: false, error: 'unauthenticated' }, 401);
  }

  let body: {
    bucket?: 'post-images' | 'avatars' | 'both';
    pageLimit?: number;
    lookbackHours?: number;
    dryRun?: boolean;
  } = {};
  try {
    body = await req.json().catch(() => ({}));
  } catch {
    body = {};
  }

  const bucketArg = body.bucket ?? 'both';
  const pageLimit = typeof body.pageLimit === 'number' ? Math.max(1, Math.min(500, body.pageLimit)) : 100;
  const sinceIso = typeof body.lookbackHours === 'number'
    ? new Date(Date.now() - body.lookbackHours * 3600_000).toISOString()
    : null;
  const dryRun = body.dryRun === true;

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    });

    const buckets = bucketArg === 'both' ? ['post-images', 'avatars'] : [bucketArg];
    const results: BackfillStats[] = [];
    for (const bucket of buckets) {
      const stats = await backfillBucket(admin, bucket, { pageLimit, sinceIso, dryRun });
      console.log(`[backfill-image-thumbs] ${JSON.stringify(stats)}`);
      results.push(stats);
    }

    return json({ ok: true, dryRun, results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await reportError(err, { fn: 'backfill-image-thumbs', req });
    return json({ ok: false, error: msg }, 500);
  }
}));
