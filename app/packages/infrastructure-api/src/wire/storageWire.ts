// The wire format of file storage (ADR-012), shared by the API and the app so neither can
// drift from the other: the member routes, their bodies, and the shape of a public address.

/** Paths of the member routes, relative to the API base URL. */
export const STORAGE_PATHS = {
  /** Grants an upload: `UploadGrantRequest` → `UploadGrantResponse`. */
  uploads: '/v1/storage/uploads',
  /** Confirms an upload into the index: `ObjectRef` → `UploadCompleteResponse`. */
  complete: '/v1/storage/uploads/complete',
  /** A short-lived address of a private file: `SignedUrlRequest` → `SignedUrlResponse`. */
  signedUrls: '/v1/storage/signed-urls',
  /** Deletes the member's files: `DeleteObjectsRequest` → `DeleteObjectsResponse`. */
  delete: '/v1/storage/objects/delete',
} as const;

/**
 * Path under which a public file is served, on whichever host serves the
 * files: `<host>/storage/v1/object/public/<bucket>/<name>`. It is the shape
 * the addresses already stored in the database have (a member's
 * `avatar_url`), so moving the files changes the host of an address and
 * nothing else.
 */
export const PUBLIC_OBJECT_PATH = '/storage/v1/object/public';

/** A stored file: its bucket and its name inside the bucket. */
export interface ObjectRef {
  readonly bucket: string;
  readonly name: string;
}

export interface UploadGrantRequest extends ObjectRef {
  readonly contentType: string;
  /** Size of the file in bytes. */
  readonly size: number;
  /** The full Cache-Control value to store with the file. */
  readonly cacheControl?: string;
}

/** Where and how to send the bytes of a granted upload. */
export interface UploadTarget {
  readonly url: string;
  readonly method: 'PUT';
  /** Headers the request must carry, exactly: the grant covers them. */
  readonly headers: Readonly<Record<string, string>>;
  /** ISO time after which the address no longer accepts the bytes. */
  readonly expiresAt: string;
}

export interface UploadGrantResponse {
  readonly upload: UploadTarget;
}

export interface UploadCompleteResponse {
  /** The file's name in its bucket, as it is now in the index. */
  readonly path: string;
}

export interface SignedUrlRequest extends ObjectRef {
  /** Seconds the address should stay valid; the server may shorten it. */
  readonly expiresIn: number;
}

export interface SignedUrlResponse {
  readonly signedUrl: string;
}

export interface DeleteObjectsRequest {
  readonly bucket: string;
  readonly names: readonly string[];
}

export interface DeleteObjectsResponse {
  /** The names that were removed; a name the member may not delete is skipped. */
  readonly deleted: readonly string[];
}

/** The `error` of a refused storage request. */
export type StorageErrorCode = 'invalid_request' | 'forbidden' | 'exists' | 'too_large' | 'type_not_allowed' | 'not_uploaded' | 'not_found' | 'not_configured';

/** Escapes each segment of a name, keeping the slashes between them. */
function encodeName(name: string): string {
  return name.split('/').map(encodeURIComponent).join('/');
}

/**
 * The address of a public file.
 * @param baseUrl Host that serves the files, with or without a trailing slash.
 */
export function publicObjectUrl(baseUrl: string, bucket: string, name: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${PUBLIC_OBJECT_PATH}/${encodeURIComponent(bucket)}/${encodeName(name)}`;
}

/** True when the address is a public file's, on any host. */
export function isPublicObjectUrl(url: string): boolean {
  return url.includes(`${PUBLIC_OBJECT_PATH}/`);
}

/**
 * The name of the file a public address points at, or null when the address
 * is not a public file of `bucket`. The host is not looked at: an address
 * written before the files moved names the same file.
 */
export function publicObjectName(url: string, bucket: string): string | null {
  const marker = `${PUBLIC_OBJECT_PATH}/${encodeURIComponent(bucket)}/`;
  const at = url.indexOf(marker);
  if (at < 0) return null;
  const encoded = url.slice(at + marker.length).split(/[?#]/)[0] ?? '';
  try {
    return decodeURIComponent(encoded) || null;
  } catch {
    // Not a valid escape sequence: not an address this code wrote.
    return null;
  }
}
