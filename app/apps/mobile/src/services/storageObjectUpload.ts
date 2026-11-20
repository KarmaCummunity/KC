// One Supabase Storage upload that can really be cancelled, with a bounded time budget and
// retries for transient failures. Every media pipeline goes through here.
//
// Why not `client.storage.from(b).upload()`: storage-js (2.119) passes no abort signal to its
// fetch, so a cancel or a timeout could only stop *waiting*, never the write itself. This module
// sends the same request (POST /storage/v1/object/<bucket>/<path>, as the signed-in member,
// without upsert) through `fetch` with an AbortController, so cancel and timeout abort the
// transport.
//
// What an abort can NOT guarantee: a server that already received the whole body may still
// commit the object. Hence the contract:
//   * every attempt writes a path no other attempt uses (`pathForAttempt`), so a late write can
//     never overwrite, or be mistaken for, another attempt's object;
//   * only the path of the attempt that succeeded is returned and ever referenced;
//   * the path of an aborted or failed-in-flight attempt is "abandoned" (abandonedUploads.ts): it
//     is deleted now AND kept on a persisted ledger until a delete issued after the settle window
//     (when no late commit can still land) succeeds. Each upload start sweeps due entries.

import { getSupabaseClient } from '@kc/infrastructure-supabase';
import { getSupabasePublicEnv } from '../lib/supabasePublicConfig';
import { abandonUpload, sweepAbandonedUploads } from './abandonedUploads';
import { retryAsync, throwIfAborted, UploadCancelledError, UploadTimeoutError } from './uploadControl';

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

/** Storage answered with an error status: the attempt stored nothing. */
export class StorageHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'StorageHttpError';
  }
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

function objectUrl(baseUrl: string, bucket: string, path: string): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `${baseUrl.replace(/\/+$/, '')}/storage/v1/object/${encodeURIComponent(bucket)}/${encoded}`;
}

async function storageHttpError(response: Response): Promise<StorageHttpError> {
  let message = `HTTP ${response.status}`;
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === 'string') message = body.message;
  } catch {
    // Not JSON: keep the status line.
  }
  return new StorageHttpError(response.status, message);
}

interface AttemptContext {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly timeoutMs: number;
}

/** One POST of the bytes to `path`, aborted by the caller's signal or by its own deadline. */
async function uploadAttempt(input: StorageObjectUpload, path: string, ctx: AttemptContext): Promise<string> {
  throwIfAborted(input.signal);
  const controller = new AbortController();
  let timedOut = false;
  const onCallerAbort = () => controller.abort();
  input.signal?.addEventListener('abort', onCallerAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ctx.timeoutMs);
  try {
    const response = await fetch(objectUrl(ctx.url, input.bucket, path), {
      method: 'POST',
      headers: ctx.headers,
      // React Native's fetch accepts typed arrays (its typings omit them); like storage-js before,
      // RN's networking layer base64-encodes a binary body in JS before handing it to native
      // (Libraries/Network/convertRequestBody.js). The DOM fetch on web sends the bytes as is.
      body: input.bytes as unknown as BodyInit,
      signal: controller.signal,
    });
    if (response.ok) return path;
    throw await storageHttpError(response);
  } catch (err) {
    if (err instanceof StorageHttpError) throw err; // the server answered: nothing stored
    void abandonUpload(input.bucket, path); // aborted or lost mid-flight: the write may still land
    if (controller.signal.aborted) {
      throw timedOut ? new UploadTimeoutError(`${input.bucket}/${path}`, ctx.timeoutMs) : new UploadCancelledError();
    }
    throw err;
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener('abort', onCallerAbort);
  }
}

/** Uploads the bytes; resolves with the path of the attempt that Storage confirmed. */
export async function uploadStorageObject(input: StorageObjectUpload): Promise<string> {
  throwIfAborted(input.signal);
  void sweepAbandonedUploads().catch(() => undefined); // earlier abandoned attempts whose window has passed
  const env = getSupabasePublicEnv();
  if (!env) throw new StorageHttpError(500, 'storage_not_configured');
  const { data } = await getSupabaseClient().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new StorageHttpError(401, 'not_authenticated');
  const ctx: AttemptContext = {
    url: env.url,
    timeoutMs: input.timeoutMs ?? uploadTimeoutMs(input.bytes.byteLength),
    headers: {
      authorization: `Bearer ${token}`,
      apikey: env.anonKey,
      'content-type': input.contentType,
      'cache-control': input.cacheControl,
      'x-upsert': 'false',
    },
  };
  return retryAsync((attempt) => uploadAttempt(input, input.pathForAttempt(attempt), ctx), {
    attempts: input.attempts ?? DEFAULT_ATTEMPTS,
    baseDelayMs: RETRY_BASE_DELAY_MS,
    isRetryable: isTransientUploadError,
    signal: input.signal,
  });
}
