// Makes the sanitized copy of each new post photo (KC#2316). Ported from
// supabase/functions/process-post-media; the rules are unchanged. Started by a scheduler through
// the jobs route: at once when a photo is queued and every minute as the safety net.
//
// One run: up to `limit` (1..5, default 3) jobs, claimed ONE at a time with a lease
// (post_media_processing_claim) and only while the run's time budget lasts, so no claimed job
// ever waits on another and no attempt is spent on a job the run had no time for. For each:
//   1. refuse a key outside the owner's folder, and an object Storage recorded as missing, over
//      8 MiB or not JPEG/PNG — all BEFORE downloading it;
//   2. download it with a hard byte cap (the recorded size), check the real bytes and the pixel
//      size from the header, and rebuild the file without metadata (sanitize.ts: no pixel decode);
//   3. do the same for the uploader's `-thumb` sibling when it exists and is valid (it is optional:
//      without it, readers fall back to the full copy);
//   4. upload them to this attempt's own keys, `derived/<owner>/<media>-a<n>.<jpg|png>` (+ `-thumb`),
//      in the namespace only the service role can write; never the original, never overwriting;
//   5. complete with a compare-and-set (post_media_processing_complete): the database checks the
//      lease, that the row and the post are unchanged and showable, the exact key, and that Storage
//      holds the object with the key's type and the reported size (the index row the worker's
//      upload wrote). When it does not answer 'ready'
//      (a lost race, a job cancelled by the account purge) or anything fails after an upload, the
//      worker removes the objects this attempt wrote: they are never referenced.
//   6. once the photo is 'ready', remove the member's upload and its thumbnail: everyone is shown
//      the copy, and the upload is the file that may still carry where it was taken. (New with
//      KC's own storage; the Edge Function left the upload to a daily in-place rewrite.)
// The worker's own writes are bounded by the lease: it starts no upload in the lease's last 30 s
// and aborts every upload at that point. That is an application-level limit, NOT a storage fence:
// an aborted request may still be committed by Storage afterwards, and nothing checks the owner or
// a deletion tombstone at storage-commit time. The account purge waits until a cancelled job's
// lease has run out (kc_private.post_media_purge_hold) before it empties `derived/<owner>/`, which
// narrows, but does not close, the window for a late object there.
// Failures are recorded with post_media_processing_fail: a file refused for what it is fails at
// once; network / storage / database errors retry (at most three attempts in all).
// Every database call, download and upload has a finite deadline and is ABORTED at it (the request,
// not only the wait). A completion call that times out has an unknown outcome: the worker then
// removes nothing and records nothing (the lease decides what happens).

import { DeadlineExceeded, type Deadlines, DEFAULT_DEADLINES, withDeadline } from './deadlines';
import { ImageRejected, MAX_SOURCE_BYTES, type ImageType } from './imageCheck';
import { sanitizeImage, type SanitizedImage } from './sanitize';

type RpcResult = { data: unknown; error: { message: string } | null };
/** The database functions this worker calls (all service role only). */
type WorkerRpc = 'post_media_processing_claim' | 'post_media_processing_complete' | 'post_media_processing_fail';

export interface MediaStorage {
  /**
   * The object's bytes, or null when no such object exists; rejects when it would exceed `maxBytes`
   * (the read is cut off) or `signal` aborts.
   */
  download(key: string, maxBytes: number, signal: AbortSignal): Promise<Uint8Array | null>;
  /** Stores a new object of `contentType`; rejects if it already exists (never overwrites) or `signal` aborts. */
  upload(key: string, bytes: Uint8Array, contentType: ImageType, signal: AbortSignal): Promise<void>;
  /** Removes objects; must abort its request when `signal` aborts. Best effort (failures logged). */
  remove(keys: string[], signal: AbortSignal): Promise<void>;
}

export interface ProcessPostMediaDeps {
  /** One database function call; must abort its request when `signal` aborts. */
  rpc: (fn: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<RpcResult>;
  deadlines?: Partial<Deadlines>;
  storage: MediaStorage;
  /** Wall-clock budget of one run: no new job is claimed once it is spent. */
  budgetMs?: number;
  now?: () => number;
  /** Receives what went wrong with one photo: the step, the media id and the reason. Never the bytes. */
  log: (level: 'warn' | 'error', step: string, mediaId: string, reason: string) => void;
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

/** One run's wall-clock budget: short, so a scheduler's request is answered well within its own timeout. */
const DEFAULT_BUDGET_MS = 20_000;
/** Jobs per run: the default, and the most a request may ask for. */
const DEFAULT_JOBS_PER_RUN = 3;
const MAX_JOBS_PER_RUN = 5;
/** The uploader's thumb is small (the app makes ≤ 400 px); anything bigger is not used. */
const THUMB_CAPS = { maxSourceEdge: 1024, maxSourcePixels: 1024 * 1024 };
const THUMB_MAX_BYTES = 1024 * 1024;
/** No upload starts within this margin before the lease ends, and every upload is aborted there. */
export const WRITE_MARGIN_MS = 30_000;
const SOURCE_TYPES = new Set(['image/jpeg', 'image/png']);
/** `<owner uuid>/<path>` with plain path characters and no `..` segment. */
const OWNED_KEY = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/[A-Za-z0-9._/-]{1,400}$/;

/** A refusal that no retry can change. */
class FinalRefusal extends Error {}

/** The reason of a failure as text, for the job's record and the log. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The key attempt n must write; mirrors kc_private.post_media_derivative_key. */
export function derivativeKey(ownerId: string, mediaId: string, attempt: number, type: ImageType = 'image/jpeg'): string {
  return `derived/${ownerId}/${mediaId}-a${attempt}.${type === 'image/png' ? 'png' : 'jpg'}`;
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
function callRpc(deps: ProcessPostMediaDeps, fn: WorkerRpc, args: Record<string, unknown>): Promise<RpcResult> {
  const ms = deps.deadlines?.rpcMs ?? DEFAULT_DEADLINES.rpcMs;
  return withDeadline(ms, `rpc ${fn}`, (signal) => deps.rpc(fn, args, signal));
}

/**
 * The uploader's `-thumb` sibling, sanitized, or null when there is none or it is not a valid small
 * image of the source's type (the copy is then used everywhere). A thumb never fails the job:
 * any problem with it, transient or not, only costs the thumb.
 */
async function sanitizedThumb(
  job: ClaimedMediaJob, type: ImageType, deps: ProcessPostMediaDeps, downloadMs: number,
): Promise<SanitizedImage | null> {
  try {
    const bytes = await withDeadline(downloadMs, 'thumb download', (signal) =>
      deps.storage.download(thumbKey(job.storage_key), THUMB_MAX_BYTES, signal));
    const thumb = bytes ? sanitizeImage(bytes, THUMB_CAPS) : null;
    return thumb?.type === type ? thumb : null;
  } catch (err) {
    deps.log('warn', 'thumb skipped', job.media_id, reasonOf(err));
    return null;
  }
}

/**
 * Removes the member's upload and its thumbnail once the copy is what the photo's row points
 * at (ADR-012, "The uploaded originals"): the upload may carry where it was taken, and nothing
 * references it any more. Best effort: a file that could not be removed is logged, and the
 * daily reconciliation removes it, as a file no row references.
 */
async function removeUpload(job: ClaimedMediaJob, deps: ProcessPostMediaDeps, cleanupMs: number): Promise<void> {
  const uploads = [job.storage_key, thumbKey(job.storage_key)];
  await withDeadline(cleanupMs, 'remove upload', (signal) => deps.storage.remove(uploads, signal)).catch((err: unknown) =>
    deps.log('warn', 'remove upload', job.media_id, reasonOf(err)));
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

  let sanitized: SanitizedImage;
  let thumb: SanitizedImage | null;
  try {
    preflight(job);
    const bytes = await withDeadline(deadlines.downloadMs, 'download', (signal) =>
      deps.storage.download(job.storage_key, job.object_size as number, signal));
    if (!bytes) throw new FinalRefusal('object_missing');
    sanitized = sanitizeImage(bytes);
    thumb = await sanitizedThumb(job, sanitized.type, deps, deadlines.downloadMs);
  } catch (err) {
    if (err instanceof FinalRefusal || err instanceof ImageRejected) return fail(err.message, false);
    return fail(`download: ${reasonOf(err)}`, true);
  }

  const key = derivativeKey(job.owner_id, job.media_id, job.attempt, sanitized.type);
  const written: string[] = [];
  /** Removes what this attempt wrote: it is never referenced once the attempt does not complete. */
  const removeWritten = async () => {
    if (written.length === 0) return;
    await withDeadline(deadlines.cleanupMs, 'cleanup', (signal) => deps.storage.remove(written, signal)).catch((err: unknown) =>
      deps.log('error', 'cleanup', job.media_id, reasonOf(err)));
  };
  const writeDeadline = Date.parse(job.leased_until) - WRITE_MARGIN_MS;
  const now = deps.now ?? Date.now;
  const uploadWithinLease = async (objectKey: string, image: SanitizedImage) => {
    const remaining = writeDeadline - now();
    if (!(remaining > 0)) throw new Error('lease_ending');
    written.push(objectKey); // recorded first: an aborted upload may still have landed
    await withDeadline(Math.min(remaining, deadlines.uploadMs), 'upload', (signal) =>
      deps.storage.upload(objectKey, image.bytes, image.type, signal));
  };
  if (!(writeDeadline - now() > 0)) return 'stale'; // too late to write: the lease runs out, the job comes back
  try {
    await uploadWithinLease(key, sanitized);
    if (thumb) await uploadWithinLease(thumbKey(key), thumb);
  } catch (err) {
    await removeWritten();
    return fail(`upload: ${reasonOf(err)}`, true);
  }
  let done: RpcResult;
  try {
    done = await callRpc(deps, 'post_media_processing_complete', {
      p_media_id: job.media_id,
      p_lease_token: job.lease_token,
      p_derivative_key: key,
      p_size_bytes: sanitized.bytes.byteLength,
      p_width: sanitized.width,
      p_height: sanitized.height,
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
  if (done.data === 'ready') {
    await removeUpload(job, deps, deadlines.cleanupMs);
    return 'ready';
  }
  await removeWritten();
  return done.data === 'changed' ? 'changed' : 'stale';
}

/** What one run did: how many jobs it claimed and how each ended, by media id. */
export interface PostMediaRun {
  readonly claimed: number;
  readonly outcomes: Readonly<Record<string, JobOutcome>>;
}

/** The claim could not be made, so the run ended; `outcomes` holds the jobs it had finished. */
export class ClaimFailedError extends Error {
  constructor(reason: string, readonly outcomes: Readonly<Record<string, JobOutcome>>) {
    super(`post_media_processing_claim: ${reason}`);
    this.name = 'ClaimFailedError';
  }
}

/** The number of jobs a run may claim: `asked` within 1..5, or the default. */
export function jobsPerRun(asked: unknown): number {
  return Math.min(Math.max(Math.trunc(Number(asked)) || DEFAULT_JOBS_PER_RUN, 1), MAX_JOBS_PER_RUN);
}

/**
 * One run: claims up to `limit` jobs, one at a time and only while the budget lasts.
 * @throws ClaimFailedError when a claim fails or is not answered. A claim that may have
 *   succeeded is not lost: its lease runs out and the job comes back.
 */
export async function processPostMedia(deps: ProcessPostMediaDeps, limit: number): Promise<PostMediaRun> {
  const now = deps.now ?? Date.now;
  const deadline = now() + (deps.budgetMs ?? DEFAULT_BUDGET_MS);
  const outcomes: Record<string, JobOutcome> = {};
  let claimed = 0;
  while (claimed < limit && now() < deadline) {
    let claim: RpcResult;
    try {
      claim = await callRpc(deps, 'post_media_processing_claim', { p_limit: 1, p_lease_seconds: 300 });
    } catch (err) {
      throw new ClaimFailedError(reasonOf(err), outcomes);
    }
    if (claim.error) throw new ClaimFailedError(claim.error.message, outcomes);
    const [job] = (claim.data ?? []) as ClaimedMediaJob[];
    if (!job) break; // nothing due
    claimed += 1;
    try {
      outcomes[job.media_id] = await processJob(job, deps);
    } catch (err) {
      deps.log('error', 'job', job.media_id, reasonOf(err));
      outcomes[job.media_id] = 'stale'; // the lease expires and a later claim hands the job out again
    }
  }
  return { claimed, outcomes };
}
