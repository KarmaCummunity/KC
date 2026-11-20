// process-post-media — makes the sanitized copy of each new post photo (KC#2316).
// Service role only. NOT scheduled by this change: activation is a separate, gated step.
//
// One run: up to `limit` (1..5, default 3) jobs, claimed ONE at a time with a lease
// (post_media_processing_claim) and only while the run's time budget lasts, so no claimed job
// ever waits on another and no attempt is spent on a job the run had no time for. For each:
//   1. refuse a key outside the owner's folder, and an object Storage recorded as missing, over
//      8 MiB or not JPEG/PNG — all BEFORE downloading it;
//   2. download it with a hard byte cap (the recorded size), then inspect the real bytes and cap
//      the pixel size from the header BEFORE decoding (imageCheck.ts);
//   3. re-encode a ≤ 2048 px copy and a ≤ 400 px thumb (sanitize.ts) and upload them to this
//      attempt's own keys, `<owner>/derived/<media>-a<n>.jpg` (+ `-thumb`); never the original,
//      never overwriting (no upsert);
//   4. complete with a compare-and-set (post_media_processing_complete): the database checks the
//      lease, that the row and the post are unchanged and showable, the exact key, and that Storage
//      holds the object with the reported size. A lost race ('stale' / 'changed') changes nothing;
//      the attempt's objects stay unreferenced and storage reconciliation removes them after a day.
// Failures are recorded with post_media_processing_fail: a file refused for what it is fails at
// once; network / storage / database errors retry (at most three attempts in all).

import { isServiceRoleRequest, serviceRoleRequiredResponse } from '../_shared/serviceRoleGuard.ts';
import { ImageRejected, MAX_SOURCE_BYTES } from './imageCheck.ts';
import { jimpDecoder, sanitizeImage, type Decoder } from './sanitize.ts';

type RpcResult = { data: unknown; error: { message: string } | null };

export interface MediaStorage {
  /** The object's bytes; rejects when it would exceed `maxBytes` (read is cut off, not finished). */
  download(key: string, maxBytes: number): Promise<Uint8Array>;
  /** Stores a new object; rejects if it already exists (never overwrites). */
  upload(key: string, bytes: Uint8Array): Promise<void>;
}

export interface ProcessPostMediaDeps {
  serviceRoleKey: string | string[];
  rpc: (fn: string, args: Record<string, unknown>) => Promise<RpcResult>;
  storage: MediaStorage;
  decode?: Decoder;
  /** Wall-clock budget of one run: no new job is claimed once it is spent. */
  budgetMs?: number;
  now?: () => number;
}

/** One claimed job (post_media_processing_claim). */
export interface ClaimedMediaJob {
  media_id: string;
  lease_token: string;
  attempt: number;
  owner_id: string;
  post_id: string;
  storage_key: string;
  mime_type: string;
  size_bytes: number;
  object_size: number | null;
  object_mimetype: string | null;
}

export type JobOutcome = 'ready' | 'stale' | 'changed' | 'retry' | 'failed';

/** Below the platform's function time limit (25 s on the free tier per OPERATOR_RUNBOOK.md, not re-measured). */
const DEFAULT_BUDGET_MS = 20_000;
const SOURCE_TYPES = new Set(['image/jpeg', 'image/png']);
/** `<owner uuid>/<path>` with plain path characters and no `..` segment. */
const OWNED_KEY = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/[A-Za-z0-9._\/-]{1,400}$/;

/** A refusal that no retry can change. */
class FinalRefusal extends Error {}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** The key attempt n must write; mirrors kc_private.post_media_derivative_key. */
export function derivativeKey(ownerId: string, mediaId: string, attempt: number): string {
  return `${ownerId}/derived/${mediaId}-a${attempt}.jpg`;
}

/** `a/b/c.jpg` → `a/b/c-thumb.jpg` (the app's thumb naming). */
export function thumbKey(key: string): string {
  return key.replace(/(\.[A-Za-z0-9]+)?$/, (ext) => `-thumb${ext}`);
}

/** Pre-download refusals, from what the claim says about the row and the stored object. */
export function preflight(job: ClaimedMediaJob): void {
  const owned = OWNED_KEY.exec(job.storage_key);
  if (!owned || owned[1] !== job.owner_id || job.storage_key.split('/').includes('..')) {
    throw new FinalRefusal('foreign_or_invalid_path');
  }
  if (job.object_size === null) throw new FinalRefusal('object_missing');
  if (job.object_size > MAX_SOURCE_BYTES) throw new FinalRefusal('too_large');
  if (!job.object_mimetype || !SOURCE_TYPES.has(job.object_mimetype)) throw new FinalRefusal('unsupported_type');
}

async function processJob(job: ClaimedMediaJob, deps: ProcessPostMediaDeps): Promise<JobOutcome> {
  const fail = async (error: string, retryable: boolean): Promise<JobOutcome> => {
    const res = await deps.rpc('post_media_processing_fail', {
      p_media_id: job.media_id, p_lease_token: job.lease_token, p_error: error, p_retryable: retryable,
    });
    if (res.error) throw new Error(`fail_rpc: ${res.error.message}`);
    return res.data === 'retry' ? 'retry' : res.data === 'failed' ? 'failed' : 'stale';
  };

  let sanitized;
  try {
    preflight(job);
    const bytes = await deps.storage.download(job.storage_key, job.object_size as number);
    sanitized = await sanitizeImage(bytes, deps.decode ?? jimpDecoder);
  } catch (err) {
    if (err instanceof FinalRefusal || err instanceof ImageRejected) return fail(err.message, false);
    return fail(`download: ${err instanceof Error ? err.message : String(err)}`, true);
  }

  const key = derivativeKey(job.owner_id, job.media_id, job.attempt);
  try {
    await deps.storage.upload(key, sanitized.derivative.bytes);
    await deps.storage.upload(thumbKey(key), sanitized.thumb.bytes);
  } catch (err) {
    return fail(`upload: ${err instanceof Error ? err.message : String(err)}`, true);
  }
  const done = await deps.rpc('post_media_processing_complete', {
    p_media_id: job.media_id,
    p_lease_token: job.lease_token,
    p_derivative_key: key,
    p_size_bytes: sanitized.derivative.bytes.byteLength,
    p_width: sanitized.derivative.width,
    p_height: sanitized.derivative.height,
  });
  if (done.error) return fail(`complete: ${done.error.message}`, true);
  return done.data === 'ready' ? 'ready' : done.data === 'changed' ? 'changed' : 'stale';
}

export function createProcessPostMediaHandler(deps: ProcessPostMediaDeps) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
    if (!isServiceRoleRequest(req, deps.serviceRoleKey)) return serviceRoleRequiredResponse();

    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Math.max(Math.trunc(Number(body?.limit)) || 3, 1), 5);
    const now = deps.now ?? Date.now;
    const deadline = now() + (deps.budgetMs ?? DEFAULT_BUDGET_MS);

    const outcomes: Record<string, JobOutcome> = {};
    let claimed = 0;
    while (claimed < limit && now() < deadline) {
      const claim = await deps.rpc('post_media_processing_claim', { p_limit: 1, p_lease_seconds: 300 });
      if (claim.error) return json({ ok: false, error: claim.error.message, outcomes }, 500);
      const [job] = (claim.data ?? []) as ClaimedMediaJob[];
      if (!job) break; // nothing due
      claimed += 1;
      try {
        outcomes[job.media_id] = await processJob(job, deps);
      } catch (err) {
        console.error('[process-post-media]', job.media_id, err instanceof Error ? err.message : err);
        outcomes[job.media_id] = 'stale'; // the lease expires and a later claim hands the job out again
      }
    }
    return json({ ok: true, claimed, outcomes });
  };
}
