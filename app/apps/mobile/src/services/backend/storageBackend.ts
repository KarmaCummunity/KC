// The one door the app's files go through (ADR-012 section 4): upload, public address, signed
// address, delete.
//
// By default every call goes to Supabase Storage exactly as before. A build that sets
// EXPO_PUBLIC_KC_API_STORAGE=1 (with EXPO_PUBLIC_KC_API_URL) uses KC's own storage instead:
// the API grants an upload and keeps the index, and the bytes go straight to the object store.
// Files have their own switch, like realtime: they move when KC's store holds them, which is
// not the day the data ports move.
//
// Nothing else in the app addresses a bucket or builds a storage address
// (`app/scripts/check-api-door.mjs` enforces it).

import {
  type ApiStorage,
  createApiStorage,
  isPublicObjectUrl,
  publicObjectName,
  publicObjectUrl,
  StorageRequestError,
  withoutTrailingSlashes,
} from '@kc/infrastructure-api';
import { getSupabaseClient } from '@kc/infrastructure-supabase';
import { getSupabasePublicEnv } from '../../lib/supabasePublicConfig';
import { getAccessToken, getApiBaseUrl } from './apiBackend';

/** The store answered with an error status: the request stored, signed or deleted nothing. */
export class StorageHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'StorageHttpError';
  }
}

/** One file to store. */
export interface FileToSend {
  readonly bucket: string;
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly contentType: string;
  /** The full Cache-Control value stored with the file. */
  readonly cacheControl: string;
  /** Aborts the request in flight. */
  readonly signal: AbortSignal;
}

/** Sends one file; rejects with `StorageHttpError` when the store answered an error. */
export type SendFile = (file: FileToSend) => Promise<void>;

let apiStorage: ApiStorage | null | undefined;

/** KC's own storage, or null while the app's files are on Supabase Storage. */
function getApiStorage(): ApiStorage | null {
  if (apiStorage !== undefined) return apiStorage;
  const baseUrl = getApiBaseUrl();
  const enabled = typeof process !== 'undefined' && process.env['EXPO_PUBLIC_KC_API_STORAGE'] === '1';
  apiStorage = baseUrl && enabled ? createApiStorage({ baseUrl, getAccessToken }) : null;
  return apiStorage;
}

/**
 * Host that serves public files, without a trailing slash, or null when none is configured.
 * On KC's storage it is the media domain (`EXPO_PUBLIC_KC_MEDIA_URL`, a CDN in front of the
 * public buckets), and the API itself when none is set, which is how the local store serves.
 */
export function publicFilesBaseUrl(): string | null {
  if (getApiStorage()) {
    const media = typeof process !== 'undefined' ? process.env['EXPO_PUBLIC_KC_MEDIA_URL'] : undefined;
    return (media === undefined ? '' : withoutTrailingSlashes(media.trim())) || getApiBaseUrl();
  }
  const env = getSupabasePublicEnv();
  return env ? withoutTrailingSlashes(env.url) : null;
}

/**
 * The address of a public file, or '' when no file host is configured. The shape is the same
 * on either store (`<host>/storage/v1/object/public/<bucket>/<path>`), so an address stored
 * in the database keeps naming the same file when the files move.
 */
export function publicFileUrl(bucket: string, path: string): string {
  const base = publicFilesBaseUrl();
  return base ? publicObjectUrl(base, bucket, path) : '';
}

/**
 * True when the file host resizes an image on request. It is a paid add-on of Supabase
 * Storage; KC's store serves the copies written at upload instead, so the image helpers
 * choose the stored thumbnail there.
 */
export function resizesImagesOnRequest(): boolean {
  return !getApiStorage();
}

/**
 * The address of a resized copy made on request, or null where the file host makes none.
 * @param query The transform's parameters, already encoded (`width=…&quality=…`).
 */
export function resizedImageUrl(bucket: string, path: string, query: string): string | null {
  if (!resizesImagesOnRequest()) return null;
  const base = publicFilesBaseUrl();
  return base ? `${base}/storage/v1/render/image/public/${bucket}/${path}?${query}` : null;
}

/** True when the address is a public file's, on any host. */
export function isPublicFileUrl(url: string): boolean {
  return isPublicObjectUrl(url);
}

/** The path of the file a public address points at, or null when it is not a public file of `bucket`. */
export function publicFilePath(url: string, bucket: string): string | null {
  return publicObjectName(url, bucket);
}

/** The signed-in member's id, or null when signed out. */
export async function signedInMemberId(): Promise<string | null> {
  const { data } = await getSupabaseClient().auth.getSession();
  return data.session?.user.id ?? null;
}

/** The error body of a Supabase Storage answer as a `StorageHttpError`. */
async function supabaseStorageError(response: Response): Promise<StorageHttpError> {
  let message = `HTTP ${response.status}`;
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === 'string') message = body.message;
  } catch {
    // Not JSON: keep the status line.
  }
  return new StorageHttpError(response.status, message);
}

/**
 * Supabase Storage's own upload request, as the signed-in member and without upsert. Sent
 * with `fetch` and not the client library, which passes no abort signal to its request.
 */
function supabaseSender(baseUrl: string, anonKey: string, token: string): SendFile {
  return async ({ bucket, path, bytes, contentType, cacheControl, signal }) => {
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    const response = await fetch(`${withoutTrailingSlashes(baseUrl)}/storage/v1/object/${encodeURIComponent(bucket)}/${encoded}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, apikey: anonKey, 'content-type': contentType, 'cache-control': cacheControl, 'x-upsert': 'false' },
      // React Native's fetch accepts typed arrays (its typings omit them) and base64-encodes a
      // binary body in JS before handing it to native; the DOM fetch on web sends the bytes as is.
      body: bytes as unknown as BodyInit,
      signal,
    });
    if (!response.ok) throw await supabaseStorageError(response);
  };
}

/** KC's storage: grant, bytes to the signed address, confirmation (`@kc/infrastructure-api`). */
function apiSender(storage: ApiStorage): SendFile {
  return async ({ bucket, path, bytes, contentType, cacheControl, signal }) => {
    try {
      await storage.upload({ bucket, name: path, bytes, contentType, cacheControl, signal });
    } catch (error) {
      // One error type for the callers, whichever store answered.
      if (error instanceof StorageRequestError) throw new StorageHttpError(error.status, error.code);
      throw error;
    }
  };
}

/**
 * Prepares uploads for the signed-in member and returns the function that sends one file.
 * @throws StorageHttpError 500 when no store is configured, 401 when nobody is signed in:
 *   both before any byte is sent, so neither is retried as a transient failure.
 */
export async function openFileStore(): Promise<SendFile> {
  const storage = getApiStorage();
  const env = getSupabasePublicEnv();
  if (!storage && !env) throw new StorageHttpError(500, 'storage_not_configured');
  const { data } = await getSupabaseClient().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new StorageHttpError(401, 'not_authenticated');
  return storage ? apiSender(storage) : supabaseSender((env as { url: string }).url, (env as { anonKey: string }).anonKey, token);
}

/** A short-lived address of a file the member may read, or null when it is refused or missing. */
export async function signFileUrl(bucket: string, path: string, ttlSeconds: number): Promise<string | null> {
  const storage = getApiStorage();
  if (storage) {
    try {
      return await storage.signedUrl({ bucket, name: path }, ttlSeconds);
    } catch (error) {
      if (error instanceof StorageRequestError) return null;
      throw error;
    }
  }
  const { data, error } = await getSupabaseClient().storage.from(bucket).createSignedUrl(path, ttlSeconds);
  return error ? null : (data?.signedUrl ?? null);
}

/**
 * Deletes the member's files. Deleting a file that is not there also succeeds.
 * @returns null when the store accepted the request, otherwise why it did not.
 */
export async function removeFiles(bucket: string, paths: readonly string[]): Promise<string | null> {
  const storage = getApiStorage();
  if (storage) {
    try {
      await storage.remove(bucket, paths);
      return null;
    } catch (error) {
      if (error instanceof StorageRequestError) return error.code;
      throw error;
    }
  }
  const { error } = await getSupabaseClient().storage.from(bucket).remove([...paths]);
  return error ? error.message : null;
}

/** Test seam: forget the storage client so the next call reads the environment again. */
export function resetStorageBackendForTests(): void {
  apiStorage = undefined;
}
