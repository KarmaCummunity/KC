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
//      attempt's own keys, `derived/<owner>/<media>-a<n>.jpg` (+ `-thumb`), in the namespace only
//      the service role can write; never the original, never overwriting (no upsert);
//   4. complete with a compare-and-set (post_media_processing_complete): the database checks the
//      lease, that the row and the post are unchanged and showable, the exact key, and that Storage
//      holds the object with the reported size. When it does not answer 'ready' (a lost race, a
//      job cancelled by the account purge) or anything fails after an upload, the worker removes
//      the objects this attempt wrote: they are never referenced.
// The worker's own writes are bounded by the lease: it starts no upload in the lease's last 30 s
// and aborts every upload at that point. That is an application-level limit, NOT a storage fence:
// an aborted request may still be committed by Storage afterwards, and nothing checks the owner or
// a deletion tombstone at storage-commit time. The account purge waits until a cancelled job's
// lease has run out (kc_private.post_media_purge_hold) before it empties `derived/<owner>/`, which
// narrows, but does not close, the window for a late object there.
// Failures are recorded with post_media_processing_fail: a file refused for what it is fails at
// once; network / storage / database errors retry (at most three attempts in all).
// Every database call, download and upload has a finite deadline and is ABORTED at it (the request,
// not only the wait). Decoding and encoding are synchronous CPU work and cannot be interrupted;
// they are bounded only by the source caps. A completion call that times out has an unknown
// outcome: the worker then removes nothing and records nothing (the lease decides what happens).

import { isServiceRoleRequest, serviceRoleRequiredResponse } from '../_shared/serviceRoleGuard.ts';
import { ImageRejected, MAX_SOURCE_BYTES } from './imageCheck.ts';
import { jimpDecoder, sanitizeImage, type Decoder } from './sanitize.ts';

type RpcResult = { data: unknown; error: { message: string } | null };

export interface MediaStorage {
  /** The object's bytes; rejects when it would exceed `maxBytes` (read is cut off) or `signal` aborts. */
  download(key: string, maxBytes: number, signal: AbortSignal): Promise<Uint8Array>;
  /** Stores a new object; rejects if it already exists (never overwrites) or `signal` aborts. */
  upload(key: string, bytes: Uint8Array, signal: AbortSignal): Promise<void>;
  /** Removes objects; best effort (a failure is logged by the caller). */
  remove(keys: string[]): Promise<void>;
}

/** Per-operation deadlines (ms). Every operation is aborted when its deadline passes. */
export interface Deadlines {
  readonly rpcMs: number;
  readonly downloadMs: number;
  readonly uploadMs: number;
}

/** Defaults: not measured on the platform; chosen so one job fits well inside a lease. */
export const DEFAULT_DEADLINES: Deadlines = { rpcMs: 5_000, downloadMs: 15_000, uploadMs: 15_000 };

export interface ProcessPostMediaDeps {
  serviceRoleKey: string | string[];
  /** One database function call; must abort its request when `signal` aborts. */
  rpc: (fn: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<RpcResult>;
  deadlines?: Partial<Deadlines>;
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
  /** End of this attempt's lease (ISO time); the worker starts no write after it (application-level only). */
  leased_until: string;
  attempt: number;
  owner_id: string;
  post_id: string;
  storage_key: string;
  mime_type: string;
  size_bytes: number;
  object_size: number | null;
  object_mimetype: string | null;
}

export type JobOutcome = 'ready' | 'stale' | 'changed' | 'retry' | 'failed' | 'unknown';

/** An operation did not finish before its deadline; it was aborted. */
export class DeadlineExceeded extends Error {
  constructor(label: string) {
    super(`deadline_exceeded: ${label}`);
    this.name = 'DeadlineExceeded';
  }
}

/** Runs `op` with an AbortSignal that fires after `ms`; rejects with DeadlineExceeded at that point. */
export async function withDeadline<T>(ms: number, label: string, op: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Settle with the deadline first, then abort: the aborted operation's own rejection must not
      // win the race and hide that this was a deadline.
      reject(new DeadlineExceeded(label));
      controller.abort();
    }, Math.max(0, ms));
  });
  try {
    return await Promise.race([op(controller.signal), expired]);
  } finally {
    clearTimeout(timer);
  }
}

/** Below the platform's function time limit (25 s on the free tier per OPERATOR_RUNBOOK.md, not re-measured). */
const DEFAULT_BUDGET_MS = 20_000;
/** No upload starts within this margin before the lease ends, and every upload is aborted there. */
export const WRITE_MARGIN_MS = 30_000;
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
  return `derived/${ownerId}/${mediaId}-a${attempt}.jpg`;
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

/** A database function call with its deadline. */
function callRpc(deps: ProcessPostMediaDeps, fn: string, args: Record<string, unknown>): Promise<RpcResult> {
  const ms = deps.deadlines?.rpcMs ?? DEFAULT_DEADLINES.rpcMs;
  return withDeadline(ms, `rpc ${fn}`, (signal) => deps.rpc(fn, args, signal));
}

async function processJob(job: ClaimedMediaJob, deps: ProcessPostMediaDeps): Promise<JobOutcome> {
  const deadlines = { ...DEFAULT_DEADLINES, ...deps.deadlines };
  const fail = async (error: string, retryable: boolean): Promise<JobOutcome> => {
    const res = await callRpc(deps, 'post_media_processing_fail', {
      p_media_id: job.media_id, p_lease_token: job.lease_token, p_error: error, p_retryable: retryable,
    });
    if (res.error) throw new Error(`fail_rpc: ${res.error.message}`);
    return res.data === 'retry' ? 'retry' : res.data === 'failed' ? 'failed' : 'stale';
  };

  let sanitized;
  try {
    preflight(job);
    const bytes = await withDeadline(deadlines.downloadMs, 'download', (signal) =>
      deps.storage.download(job.storage_key, job.object_size as number, signal));
    sanitized = await sanitizeImage(bytes, deps.decode ?? jimpDecoder);
  } catch (err) {
    if (err instanceof FinalRefusal || err instanceof ImageRejected) return fail(err.message, false);
    return fail(`download: ${err instanceof Error ? err.message : String(err)}`, true);
  }

  const key = derivativeKey(job.owner_id, job.media_id, job.attempt);
  const written: string[] = [];
  /** Removes what this attempt wrote: it is never referenced once the attempt does not complete. */
  const removeWritten = async () => {
    if (written.length === 0) return;
    await deps.storage.remove(written).catch((err) =>
      console.error('[process-post-media] cleanup', job.media_id, err instanceof Error ? err.message : err));
  };
  const writeDeadline = Date.parse(job.leased_until) - WRITE_MARGIN_MS;
  const now = deps.now ?? Date.now;
  const uploadWithinLease = async (objectKey: string, bytes: Uint8Array) => {
    const remaining = writeDeadline - now();
    if (!(remaining > 0)) throw new Error('lease_ending');
    written.push(objectKey); // recorded first: an aborted upload may still have landed
    await withDeadline(Math.min(remaining, deadlines.uploadMs), 'upload', (signal) =>
      deps.storage.upload(objectKey, bytes, signal));
  };
  if (!(writeDeadline - now() > 0)) return 'stale'; // too late to write: the lease runs out, the job comes back
  try {
    await uploadWithinLease(key, sanitized.derivative.bytes);
    await uploadWithinLease(thumbKey(key), sanitized.thumb.bytes);
  } catch (err) {
    await removeWritten();
    return fail(`upload: ${err instanceof Error ? err.message : String(err)}`, true);
  }
  let done: RpcResult;
  try {
    done = await callRpc(deps, 'post_media_processing_complete', {
      p_media_id: job.media_id,
      p_lease_token: job.lease_token,
      p_derivative_key: key,
      p_size_bytes: sanitized.derivative.bytes.byteLength,
      p_width: sanitized.derivative.width,
      p_height: sanitized.derivative.height,
    });
  } catch (err) {
    // No answer: it may have committed. Removing the copy could break a ready row; recording a
    // failure is pointless (a completed job refuses it). The lease decides; leave everything as is.
    if (err instanceof DeadlineExceeded) return 'unknown';
    throw err;
  }
  if (done.error) {
    await removeWritten();
    return fail(`complete: ${done.error.message}`, true);
  }
  if (done.data === 'ready') return 'ready';
  await removeWritten();
  return done.data === 'changed' ? 'changed' : 'stale';
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
      let claim: RpcResult;
      try {
        claim = await callRpc(deps, 'post_media_processing_claim', { p_limit: 1, p_lease_seconds: 300 });
      } catch (err) {
        // A claim that may have succeeded is not lost: its lease runs out and the job comes back.
        return json({ ok: false, error: err instanceof Error ? err.message : String(err), outcomes }, 500);
      }
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
