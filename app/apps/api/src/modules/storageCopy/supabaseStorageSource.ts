import { withoutTrailingSlashes } from '@kc/infrastructure-api';
import { ObjectTooLargeError } from '../../platform/storage/objectStore';
import type { CopySource } from './copyStoredFiles';

/** Where the files live today, and the key that may read every one of them. */
export interface SupabaseStorageSourceConfig {
  /** The Supabase project's address, e.g. `https://<ref>.supabase.co`. */
  readonly url: string;
  /** A key of the project that reads private files too (its service role key). A secret. */
  readonly key: string;
}

/** The fetch this module uses; replaced in tests. */
export type SourceFetch = (url: string, init: RequestInit) => Promise<Response>;

/** The longest one file may take to arrive. */
const READ_TIMEOUT_MS = 60_000;

/** The source answered a read with something other than the file or "not found". */
export class CopySourceError extends Error {
  constructor(readonly status: number) {
    super(`the source answered ${status}`);
    this.name = 'CopySourceError';
  }
}

/**
 * Supabase Storage as the source of the copy (ADR-012 section 6): one
 * authenticated read per file, through the project's own storage API, so
 * private buckets are read the same way as public ones. The service answers
 * "not found" for a file the key may not read, exactly as for one that is
 * gone; `readableBuckets` is how a caller learns that the key sees everything.
 */
export function createSupabaseStorageSource(config: SupabaseStorageSourceConfig, fetchFn: SourceFetch = fetch): CopySource {
  const base = `${withoutTrailingSlashes(config.url)}/storage/v1`;
  // The key is sent both ways: as the project key every request needs, and as the caller it acts for.
  const headers = { apikey: config.key, authorization: `Bearer ${config.key}` };
  return {
    async readableBuckets() {
      const response = await fetchFn(`${base}/bucket`, { headers, signal: AbortSignal.timeout(READ_TIMEOUT_MS) });
      if (!response.ok) throw await discard(response, new CopySourceError(response.status));
      return ((await response.json()) as Array<{ id: string }>).map((bucket) => bucket.id);
    },

    async read(bucket, name, maxBytes) {
      const response = await fetchFn(`${base}/object/${encodeURIComponent(bucket)}/${name.split('/').map(encodeURIComponent).join('/')}`, {
        headers,
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      });
      if (await isNotFound(response)) return discard(response, null);
      if (!response.ok) throw await discard(response, new CopySourceError(response.status));
      // Decided from the announced size where there is one, before the body is read.
      if (Number(response.headers.get('content-length') ?? 0) > maxBytes) throw await discard(response, new ObjectTooLargeError(maxBytes));
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > maxBytes) throw new ObjectTooLargeError(maxBytes);
      return bytes;
    },
  };
}

/**
 * Whether the answer says the file does not exist. The service reports it in
 * the body, under status 400 or 404 depending on its version. Only its own
 * wording for a missing file counts: a key it does not accept is answered
 * with "Bucket not found" in the same form, and must never be taken for a
 * file that is gone.
 */
async function isNotFound(response: Response): Promise<boolean> {
  if (response.status !== 400 && response.status !== 404) return false;
  const body = (await response.json().catch(() => null)) as { statusCode?: unknown; error?: unknown } | null;
  return String(body?.statusCode) === '404' && body?.error === 'not_found';
}

/** Lets go of an answer whose body will not be read, so its connection is free again. @returns `result`. */
async function discard<T>(response: Response, result: T): Promise<T> {
  if (!response.bodyUsed) await response.body?.cancel();
  return result;
}
