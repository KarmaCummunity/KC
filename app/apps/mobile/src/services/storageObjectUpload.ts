// One Supabase Storage upload with a bounded time budget and retries for transient failures.
// Every media pipeline goes through here so a dead connection ends in a clear error the screen
// can show (and retry), never in a spinner that turns forever.

import { getSupabaseClient } from '@kc/infrastructure-supabase';
import { retryAsync, UploadTimeoutError, withTimeout } from './uploadControl';

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
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly cacheControl: string;
  /** Only buckets with SELECT + UPDATE policies accept an upsert (avatars); post-images does not. */
  readonly upsert?: boolean;
  readonly signal?: AbortSignal;
  readonly attempts?: number;
}

/** The error shape storage-js returns (`StorageApiError` / `StorageUnknownError`). */
interface StorageErrorLike {
  readonly message?: string;
  readonly status?: number | string;
  readonly statusCode?: number | string;
}

/** Per-attempt time budget, proportional to the payload size. */
export function uploadTimeoutMs(byteLength: number): number {
  return BASE_TIMEOUT_MS + Math.ceil((byteLength / MIN_THROUGHPUT_BYTES_PER_SEC) * 1000);
}

function httpStatus(err: StorageErrorLike): number | null {
  const raw = err.status ?? err.statusCode;
  const n = typeof raw === 'string' ? Number.parseInt(raw, 10) : raw;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** The object already exists at that path (HTTP 409 / "resource already exists"). */
export function isAlreadyExistsError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as StorageErrorLike;
  return httpStatus(e) === 409 || /already exists/i.test(e.message ?? '');
}

/**
 * Network failures (no HTTP status), timeouts, 408, 429 and 5xx may succeed on a later try.
 * Any other 4xx (RLS refusal, too large, wrong type) is final.
 */
export function isTransientUploadError(err: unknown): boolean {
  if (err instanceof UploadTimeoutError) return true;
  if (!err || typeof err !== 'object') return false;
  const status = httpStatus(err as StorageErrorLike);
  if (status === null) return true;
  return status === 408 || status === 429 || status >= 500;
}

/** Uploads one object; resolves once Storage confirms it, rejects with the last error otherwise. */
export async function uploadStorageObject(input: StorageObjectUpload): Promise<void> {
  const client = getSupabaseClient();
  const timeoutMs = uploadTimeoutMs(input.bytes.byteLength);
  await retryAsync(
    async (attempt) => {
      const { error } = await withTimeout(
        client.storage.from(input.bucket).upload(input.path, input.bytes, {
          contentType: input.contentType,
          upsert: input.upsert ?? false,
          cacheControl: input.cacheControl,
        }),
        timeoutMs,
        `${input.bucket}/${input.path}`,
        input.signal,
      );
      if (!error) return;
      // A retry after a timed-out attempt may find the first attempt's object already stored.
      // The path is unique to this upload, so that object is ours and the upload succeeded.
      if (attempt > 1 && !input.upsert && isAlreadyExistsError(error)) return;
      throw error;
    },
    {
      attempts: input.attempts ?? DEFAULT_ATTEMPTS,
      baseDelayMs: RETRY_BASE_DELAY_MS,
      isRetryable: isTransientUploadError,
      signal: input.signal,
    },
  );
}

/** Human-readable reason of an upload failure, for logs and the retry notice. */
export function uploadErrorMessage(err: unknown): string {
  if (err && typeof err === 'object' && typeof (err as StorageErrorLike).message === 'string') {
    return (err as StorageErrorLike).message as string;
  }
  return String(err);
}
