// One file upload that can really be cancelled, with a bounded time budget and retries for
// transient failures. Every media pipeline goes through here; the request itself is the
// storage door's (`backend/storageBackend.ts`), which sends it with an abort signal.
//
// What an abort can NOT guarantee: a store that already received the whole body may still
// commit the object. Hence the contract:
//   * every attempt writes a path no other attempt uses (`pathForAttempt`), so a late write can
//     never overwrite, or be mistaken for, another attempt's object;
//   * only the path of the attempt that succeeded is returned and ever referenced;
//   * the path of an aborted or failed-in-flight attempt is "abandoned" (abandonedUploads.ts): it
//     is deleted now AND kept on a persisted ledger until a later successful delete after a
//     best-effort delay. That delay does not prove server quiescence. Each upload start sweeps
//     due entries; later commits and devices that never reopen remain possible gaps.

import { abandonUpload, sweepAbandonedUploads } from './abandonedUploads';
import { openFileStore, type SendFile, StorageHttpError } from './backend/storageBackend';
import { retryAsync, throwIfAborted, UploadCancelledError, UploadTimeoutError } from './uploadControl';

export { StorageHttpError } from './backend/storageBackend';

/** Fixed part of the per-attempt budget: TLS handshake, auth, server-side write. */
const BASE_TIMEOUT_MS = 20_000;
/**
 * Slowest throughput we still wait for (bytes per second, ≈ a weak 3G link). A 400 KB photo
 * gets ~36 s, the 5 MB worst case ~3.5 min: generous for real links, finite for dead ones.
 */
const MIN_THROUGHPUT_BYTES_PER_SEC = 25 * 1024;
const DEFAULT_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 800;

export interface StorageObjectUpload {
  readonly bucket: string;
  /**
   * The object path of attempt `n` (1-based). Each attempt MUST name a path no other attempt
   * uses: an aborted request may still land later.
   */
  readonly pathForAttempt: (attempt: number) => string;
  readonly bytes: Uint8Array;
  readonly contentType: string;
  /** The full Cache-Control value stored with the object, e.g. `public, max-age=31536000, immutable`. */
  readonly cacheControl: string;
  readonly signal?: AbortSignal;
  readonly attempts?: number;
  /** Per-attempt budget; defaults to `uploadTimeoutMs(bytes.byteLength)`. */
  readonly timeoutMs?: number;
}

/** Per-attempt time budget, proportional to the payload size. */
export function uploadTimeoutMs(byteLength: number): number {
  return BASE_TIMEOUT_MS + Math.ceil((byteLength / MIN_THROUGHPUT_BYTES_PER_SEC) * 1000);
}

/**
 * Network failures, timeouts, 408, 429 and 5xx may succeed on a later try (on a new path).
 * Any other answer (RLS refusal, too large, wrong type) and a cancellation are final.
 */
export function isTransientUploadError(err: unknown): boolean {
  if (err instanceof UploadTimeoutError) return true;
  if (err instanceof UploadCancelledError) return false;
  if (err instanceof StorageHttpError) return err.status === 408 || err.status === 429 || err.status >= 500;
  return err instanceof TypeError; // fetch rejects with TypeError when the network fails
}

/** Human-readable reason of an upload failure, for logs and the retry notice. */
export function uploadErrorMessage(err: unknown): string {
  if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return String(err);
}

/** One send of the bytes to `path`, aborted by the caller's signal or by its own deadline. */
async function uploadAttempt(input: StorageObjectUpload, path: string, send: SendFile, timeoutMs: number): Promise<string> {
  throwIfAborted(input.signal);
  const controller = new AbortController();
  let timedOut = false;
  const onCallerAbort = () => controller.abort();
  input.signal?.addEventListener('abort', onCallerAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    await send({ bucket: input.bucket, path, bytes: input.bytes, contentType: input.contentType, cacheControl: input.cacheControl, signal: controller.signal });
    return path;
  } catch (err) {
    if (err instanceof StorageHttpError) throw err; // the store answered: nothing stored
    void abandonUpload(input.bucket, path); // aborted or lost mid-flight: the write may still land
    if (controller.signal.aborted) {
      throw timedOut ? new UploadTimeoutError(`${input.bucket}/${path}`, timeoutMs) : new UploadCancelledError();
    }
    throw err;
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener('abort', onCallerAbort);
  }
}

/** Uploads the bytes; resolves with the path of the attempt that the store confirmed. */
export async function uploadStorageObject(input: StorageObjectUpload): Promise<string> {
  throwIfAborted(input.signal);
  void sweepAbandonedUploads().catch(() => undefined); // earlier abandoned attempts whose window has passed
  const send = await openFileStore();
  const timeoutMs = input.timeoutMs ?? uploadTimeoutMs(input.bytes.byteLength);
  return retryAsync((attempt) => uploadAttempt(input, input.pathForAttempt(attempt), send, timeoutMs), {
    attempts: input.attempts ?? DEFAULT_ATTEMPTS,
    baseDelayMs: RETRY_BASE_DELAY_MS,
    isRetryable: isTransientUploadError,
    signal: input.signal,
  });
}
