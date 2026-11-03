// strip-exif — TD-23
//
// Server-side EXIF strip for the `post-images` bucket.
// Scans all JPEG objects uploaded in the last `lookbackHours` hours (default: 25)
// and removes APP1/EXIF segments from any that still carry EXIF metadata.
// The client already strips via JPEG re-encode (P0.4-FE); this is a
// "defense-in-depth" pass for hostile or misconfigured clients.
//
// Triggered by pg_cron (migration 0080) daily at 02:30 UTC via net.http_post.
// Also accepts a manual POST with optional `{ "lookbackHours": N }` body.
//
// POST (body: optional JSON { lookbackHours?: number })
//   → 200 { ok: true, scanned, stripped, skipped, errors }
//   → 401 { ok: false, error: "unauthenticated" }
//   → 500 { ok: false, error: string }
//
// JPEG segment layout: [FF][marker][len_hi][len_lo][data...]
// APP1 = marker 0xE1. An EXIF APP1 starts with the ASCII literal "Exif\0\0".

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { reportError, withObservability } from '../_shared/observability/mod.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BUCKET = 'post-images';
const DEFAULT_LOOKBACK_HOURS = 25;
const LIST_PAGE = 100;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── JPEG EXIF stripping ───────────────────────────────────────────────────────

const APP1_MARKER = 0xe1;
const EXIF_HEADER = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]); // "Exif\0\0"

function hasExifBytes(data: Uint8Array, segmentDataOffset: number): boolean {
  if (data.length < segmentDataOffset + 6) return false;
  return EXIF_HEADER.every((b, i) => data[segmentDataOffset + i] === b);
}

/**
 * Remove all APP1 segments whose data starts with "Exif\0\0".
 * Returns null when no EXIF is found (file unchanged).
 * Returns the stripped bytes otherwise.
 */
function stripExif(original: Uint8Array): Uint8Array | null {
  // JPEG must start with FF D8.
  if (original.length < 4 || original[0] !== 0xff || original[1] !== 0xd8) return null;

  const out: Uint8Array[] = [];
  let i = 0;
  let stripped = false;

  // Keep the SOI marker.
  out.push(original.slice(0, 2));
  i = 2;

  while (i < original.length) {
    if (original[i] !== 0xff) break; // malformed
    const marker = original[i + 1];
    if (marker === 0xd9 /* EOI */ || marker === 0xda /* SOS */) {
      out.push(original.slice(i));
      break;
    }
    const segLen = (original[i + 2] << 8) | original[i + 3]; // includes 2-byte length field
    const segEnd = i + 2 + segLen;

    if (marker === APP1_MARKER && hasExifBytes(original, i + 4)) {
      // Skip this segment — it's the EXIF APP1.
      stripped = true;
    } else {
      out.push(original.slice(i, segEnd));
    }

    i = segEnd;
  }

  if (!stripped) return null;

  // Concatenate into a single buffer.
  const totalLen = out.reduce((acc, b) => acc + b.byteLength, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of out) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

// ── Storage helpers ───────────────────────────────────────────────────────────

type AdminClient = SupabaseClient;

async function listRecentPaths(
  admin: AdminClient,
  sinceIso: string,
  prefix = '',
): Promise<string[]> {
  const paths: string[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await admin.storage
      .from(BUCKET)
      .list(prefix, { limit: LIST_PAGE, offset, sortBy: { column: 'created_at', order: 'desc' } });
    if (error) throw new Error(`list(${prefix}): ${error.message}`);
    if (!data || data.length === 0) break;

    let hasOld = false;
    for (const obj of data) {
      const fullPath = prefix ? `${prefix}/${obj.name}` : obj.name;
      if (obj.metadata) {
        // File — check created_at against our window.
        const created = obj.created_at ?? obj.updated_at ?? '';
        if (created >= sinceIso) {
          paths.push(fullPath);
        } else {
          // Items are sorted newest-first; once we see an old one, remaining are older.
          hasOld = true;
        }
      } else {
        // Folder — recurse.
        const nested = await listRecentPaths(admin, sinceIso, fullPath);
        paths.push(...nested);
      }
    }
    if (hasOld || data.length < LIST_PAGE) break;
    offset += LIST_PAGE;
  }
  return paths;
}

// ── Handler ───────────────────────────────────────────────────────────────────

serve(withObservability('strip-exif', async (req: Request) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ') || auth.slice(7) !== SERVICE_KEY) {
    return json({ ok: false, error: 'unauthenticated' }, 401);
  }

  let lookbackHours = DEFAULT_LOOKBACK_HOURS;
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body?.lookbackHours === 'number') lookbackHours = body.lookbackHours;
  } catch {
    // ignore
  }

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    });

    const since = new Date(Date.now() - lookbackHours * 3600_000).toISOString();
    const paths = await listRecentPaths(admin, since);

    let scanned = 0, stripped = 0, skipped = 0, errors = 0;

    for (const path of paths) {
      scanned++;
      try {
        // Download.
        const { data: blob, error: dlErr } = await admin.storage.from(BUCKET).download(path);
        if (dlErr || !blob) { errors++; continue; }

        const bytes = new Uint8Array(await blob.arrayBuffer());
        const cleaned = stripExif(bytes);

        if (!cleaned) { skipped++; continue; }

        // Re-upload in-place.
        const { error: upErr } = await admin.storage
          .from(BUCKET)
          .upload(path, cleaned, { contentType: 'image/jpeg', upsert: true });
        if (upErr) { errors++; continue; }

        stripped++;
      } catch {
        errors++;
      }
    }

    console.log(
      `[strip-exif] scanned=${scanned} stripped=${stripped} skipped=${skipped} errors=${errors}`,
    );
    return json({ ok: true, scanned, stripped, skipped, errors });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await reportError(err, { fn: 'strip-exif', req });
    return json({ ok: false, error: msg }, 500);
  }
}));
