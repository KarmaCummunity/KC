// A photo worker with doubles for the database and the store, which record what the worker did
// with them. Shared by the worker's test files.
import * as testImages from '../../../__tests__/support/testImages';
import { type ClaimedMediaJob, jobsPerRun, type MediaStorage, type PostMediaRun, processPostMedia } from '../processPostMedia';

export const OWNER = '0a0a0a0a-0000-4000-8000-00000000000a';
export const MEDIA = '1b1b1b1b-0000-4000-8000-000000000001';

/** A lease well in the future unless a test says otherwise. */
const LEASE_END = new Date(Date.now() + 300_000).toISOString();

export const job = (patch: Partial<ClaimedMediaJob> = {}): ClaimedMediaJob => ({
  media_id: MEDIA, lease_token: 'lease-1', attempt: 1, owner_id: OWNER, post_id: 'p1', leased_until: LEASE_END,
  storage_key: `${OWNER}/batch/0.jpg`, mime_type: 'image/jpeg', size_bytes: 5000,
  object_size: 5000, object_mimetype: 'image/jpeg', ...patch,
});

/** The photos the worker's cases upload: a real JPEG or PNG in a colour of their own. */
const WORKER_COLOUR = [0x11, 0x22, 0x33] as const;
export const realJpeg = (width = 64, height = 48) => testImages.realJpeg(width, height, WORKER_COLOUR);
export const realPng = (width = 64, height = 48) => testImages.realPng(width, height, WORKER_COLOUR);
export const isThumb = (key: string) => /-thumb\.[a-z]+$/.test(key);

export interface Harness {
  calls: { fn: string; args: Record<string, unknown> }[];
  downloads: { key: string; maxBytes: number }[];
  uploads: string[];
  /** Bytes and content type of each upload, by key. */
  stored: Map<string, { bytes: Uint8Array; contentType: string }>;
  removed: string[];
  signals: AbortSignal[];
  rpcSignals: AbortSignal[];
  removeSignals: AbortSignal[];
  /** What the worker logged, as `<level> <step>`. */
  logged: string[];
  /** One run, with the limit a scheduler's body asks for; rejects when a claim fails. */
  run: (body?: { limit?: unknown }) => Promise<PostMediaRun>;
}

/** Never settles on its own; rejects as soon as `signal` aborts (an unresponsive server). */
function hangUntilAborted<T>(signal: AbortSignal): Promise<T> {
  return new Promise<T>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
}

export function harness(opts: {
  /** Operations that never answer: RPC names, 'download', 'upload' or 'remove'. */
  hang?: string[];
  deadlines?: { rpcMs?: number; downloadMs?: number; uploadMs?: number; cleanupMs?: number };
  jobs: ClaimedMediaJob[];
  bytes?: Uint8Array;
  /** The uploader's `-thumb` sibling; absent (null) unless a test provides it. */
  thumb?: Uint8Array;
  complete?: string | { error: string };
  storage?: Partial<MediaStorage>;
  budgetMs?: number;
  clock?: () => number;
}): Harness {
  const calls: Harness['calls'] = [];
  const downloads: Harness['downloads'] = [];
  const uploads: string[] = [];
  const stored: Harness['stored'] = new Map();
  const removed: string[] = [];
  const signals: AbortSignal[] = [];
  const rpcSignals: AbortSignal[] = [];
  const removeSignals: AbortSignal[] = [];
  const logged: string[] = [];
  const hang = new Set(opts.hang ?? []);
  const run: Harness['run'] = (body = {}) =>
    processPostMedia(
      {
        ...(opts.budgetMs === undefined ? {} : { budgetMs: opts.budgetMs }),
        ...(opts.clock ? { now: opts.clock } : {}),
        ...(opts.deadlines ? { deadlines: opts.deadlines } : {}),
        log: (level, step) => logged.push(`${level} ${step}`),
        rpc: (fn, args, signal) => {
          calls.push({ fn, args });
          rpcSignals.push(signal);
          if (hang.has(fn)) return hangUntilAborted(signal);
          // The worker claims one job per call; the queue double hands them out in order.
          if (fn === 'post_media_processing_claim') return Promise.resolve({ data: opts.jobs.splice(0, 1), error: null });
          if (fn === 'post_media_processing_complete') {
            const c = opts.complete ?? 'ready';
            return Promise.resolve(typeof c === 'string' ? { data: c, error: null } : { data: null, error: { message: c.error } });
          }
          return Promise.resolve({ data: args.p_retryable ? 'retry' : 'failed', error: null });
        },
        storage: {
          download: opts.storage?.download ?? ((key, maxBytes, signal) => {
            downloads.push({ key, maxBytes });
            if (hang.has('download')) return hangUntilAborted(signal);
            return Promise.resolve(isThumb(key) ? opts.thumb ?? null : opts.bytes ?? new Uint8Array(0));
          }),
          upload: opts.storage?.upload ?? ((key, bytes, contentType, signal) => {
            uploads.push(key);
            stored.set(key, { bytes, contentType });
            signals.push(signal);
            if (hang.has('upload')) return hangUntilAborted(signal);
            return Promise.resolve();
          }),
          remove: (keys, signal) => {
            removed.push(...keys);
            removeSignals.push(signal);
            if (hang.has('remove')) return hangUntilAborted(signal);
            return Promise.resolve();
          },
        },
      },
      jobsPerRun(body.limit),
    );
  return { calls, downloads, uploads, stored, removed, signals, rpcSignals, removeSignals, logged, run };
}

export const failCall = (h: Harness) => h.calls.find((c) => c.fn === 'post_media_processing_fail')?.args;
