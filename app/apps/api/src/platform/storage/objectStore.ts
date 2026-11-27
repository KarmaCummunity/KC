// Where the bytes of KC's files live (ADR-012 section 1). The API never
// streams a member's upload or download: it issues URLs and keeps the index.
// Server modules that work on files (copies, thumbnails, clean-up) read and
// write through the same interface.

/** What the store knows about one object. */
export interface StoredObject {
  /** Size in bytes. */
  readonly size: number;
  readonly contentType: string;
  /** The Cache-Control value served with the object, when one was stored. */
  readonly cacheControl: string | null;
  /**
   * MD5 of the bytes, in lower-case hex, as the store itself recorded it;
   * null when the store has none for the object. It tells a damaged or
   * different copy from a faithful one and is no protection against forgery.
   */
  readonly md5: string | null;
}

/** What the writer of an object decides about it; the store works out the rest. */
export type ObjectAttributes = Pick<StoredObject, 'contentType' | 'cacheControl'>;

/** One object of a listing. */
export interface ObjectEntry {
  readonly name: string;
  /** Size in bytes. */
  readonly size: number;
  /** When the object was stored. */
  readonly createdAt: Date;
}

/** One page of a listing, in name order. */
export interface ObjectPage {
  readonly entries: readonly ObjectEntry[];
  /** Passed back to get the next page; null after the last one. */
  readonly nextPageToken: string | null;
}

/** What an upload is allowed to be; the store refuses anything else. */
export interface UploadGrant {
  readonly bucket: string;
  readonly name: string;
  readonly contentType: string;
  /** Largest body the upload may have, in bytes. */
  readonly maxBytes: number;
  readonly cacheControl: string | null;
}

/** How a client carries out an upload it was granted. */
export interface SignedUpload {
  readonly url: string;
  readonly method: 'PUT';
  /** Headers the client must send with the bytes, exactly. */
  readonly headers: Readonly<Record<string, string>>;
  /** ISO time after which the URL no longer works. */
  readonly expiresAt: string;
}

export interface ObjectStore {
  /** A URL the client uploads the bytes to. The object replaces nothing: a name that exists is refused. */
  signedUploadUrl(grant: UploadGrant, expiresInSeconds: number): Promise<SignedUpload>;
  /** A short-lived URL that serves a private object. */
  signedReadUrl(bucket: string, name: string, expiresInSeconds: number): Promise<string>;
  /** The lasting address of an object of a public bucket. */
  publicUrl(bucket: string, name: string): string;
  /** What is stored under the name, or null when nothing is. */
  head(bucket: string, name: string): Promise<StoredObject | null>;
  /**
   * The bytes of an object, or null when nothing is stored under the name.
   * @param options.maxBytes The most the caller will take; a larger object is not read.
   * @throws ObjectTooLargeError when the object is larger than `maxBytes`.
   */
  read(bucket: string, name: string, options?: { readonly maxBytes?: number }): Promise<Uint8Array | null>;
  /** Stores bytes on the server's own behalf (a copy, a thumbnail). @returns false when the name is taken. */
  write(bucket: string, name: string, bytes: Uint8Array, object: ObjectAttributes): Promise<boolean>;
  /** Removes an object; removing one that is not there is not an error. */
  delete(bucket: string, name: string): Promise<void>;
  /**
   * The objects of a bucket whose name starts with `prefix`, at any depth, in
   * name order: names are flat, a slash is part of the name. Objects removed
   * while a listing is paged through do not disturb the pages that follow.
   * @param options.limit Most entries of one page.
   * @param options.pageToken `nextPageToken` of the page before; absent for the first.
   */
  list(bucket: string, prefix: string, options: { readonly limit: number; readonly pageToken?: string }): Promise<ObjectPage>;
}

/** An object is larger than the reader said it would take; nothing of it was handed over. */
export class ObjectTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`object larger than ${maxBytes} bytes`);
    this.name = 'ObjectTooLargeError';
  }
}

/** Injection token of the configured `ObjectStore`, or of null when the API has no store. */
export const OBJECT_STORE = Symbol('OBJECT_STORE');
