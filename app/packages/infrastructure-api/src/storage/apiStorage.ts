import {
  type DeleteObjectsResponse,
  type ObjectRef,
  type SignedUrlResponse,
  STORAGE_PATHS,
  type UploadGrantResponse,
} from '../wire/storageWire';

export interface ApiStorageOptions {
  /** Base URL of the API, without a trailing slash. */
  readonly baseUrl: string;
  /**
   * The signed-in member's access token, or null when signed out.
   * `forceRefresh` is true after the API rejected the token.
   */
  readonly getAccessToken: (forceRefresh: boolean) => Promise<string | null>;
  readonly fetch?: typeof fetch;
}

/** One file to store. */
export interface ObjectUpload extends ObjectRef {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  /** The full Cache-Control value to store with the file. */
  readonly cacheControl?: string;
  /** Aborts whichever request of the upload is in flight. */
  readonly signal?: AbortSignal;
}

/**
 * The API or the store answered a storage request with a failure.
 * `status` is the HTTP status, so callers can tell a final refusal (403, 409,
 * 413, 415) from one worth another try (408, 429, 5xx).
 */
export class StorageRequestError extends Error {
  constructor(
    readonly status: number,
    /** The server's stable code, e.g. `forbidden`; `upload_failed` when the store refused the bytes. */
    readonly code: string,
  ) {
    super(`storage request failed: ${code} (${status})`);
    this.name = 'StorageRequestError';
  }
}

/** The app's side of file storage on KC's API (ADR-012 section 4). */
export interface ApiStorage {
  /**
   * Stores one file: asks for a grant, sends the bytes to the address the
   * store signed, and confirms, after which the file is in the index.
   * @throws StorageRequestError when any of the three steps is refused.
   */
  upload(object: ObjectUpload): Promise<void>;
  /**
   * A short-lived address of a file the member may read.
   * @throws StorageRequestError e.g. 403 `forbidden`, 404 `not_found`.
   */
  signedUrl(object: ObjectRef, expiresInSeconds: number): Promise<string>;
  /** Deletes the member's files; resolves with the names that were removed. */
  remove(bucket: string, names: readonly string[]): Promise<readonly string[]>;
}

/** The server's error code of a refused request, or a fallback when the body carries none. */
async function errorCodeOf(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    // The storage routes answer `{ error: '<code>' }`; the API's generic errors `{ error: { code } }`.
    if (typeof body.error === 'string') return body.error;
    const code = (body.error as { code?: unknown } | undefined)?.code;
    return typeof code === 'string' ? code : fallback;
  } catch {
    return fallback;
  }
}

export function createApiStorage(options: ApiStorageOptions): ApiStorage {
  const fetchImpl = options.fetch ?? globalThis.fetch;

  async function send(path: string, body: unknown, forceRefresh: boolean, signal: AbortSignal | undefined): Promise<Response> {
    const token = await options.getAccessToken(forceRefresh);
    return fetchImpl(`${options.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
      signal,
    });
  }

  /** One request of a member route; a rejected token is replaced once and the request sent again. */
  async function request<Answer>(path: string, body: unknown, signal?: AbortSignal): Promise<Answer> {
    let response = await send(path, body, false, signal);
    if (response.status === 401) response = await send(path, body, true, signal);
    if (!response.ok) throw new StorageRequestError(response.status, await errorCodeOf(response, 'request_failed'));
    return (await response.json()) as Answer;
  }

  return {
    async upload({ bucket, name, bytes, contentType, cacheControl, signal }) {
      const { upload } = await request<UploadGrantResponse>(STORAGE_PATHS.uploads, { bucket, name, contentType, size: bytes.byteLength, cacheControl }, signal);
      // The address itself is the grant: the bytes go to the store without the member's token.
      const stored = await fetchImpl(upload.url, {
        method: upload.method,
        headers: upload.headers,
        // React Native's fetch takes typed arrays, which its typings omit; the DOM fetch sends them as they are.
        body: bytes as unknown as BodyInit,
        signal,
      });
      if (!stored.ok) throw new StorageRequestError(stored.status, await errorCodeOf(stored, 'upload_failed'));
      await request(STORAGE_PATHS.complete, { bucket, name }, signal);
    },

    async signedUrl({ bucket, name }, expiresInSeconds) {
      return (await request<SignedUrlResponse>(STORAGE_PATHS.signedUrls, { bucket, name, expiresIn: expiresInSeconds })).signedUrl;
    },

    async remove(bucket, names) {
      if (names.length === 0) return [];
      return (await request<DeleteObjectsResponse>(STORAGE_PATHS.delete, { bucket, names })).deleted;
    },
  };
}
