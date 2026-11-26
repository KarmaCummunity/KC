import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { publicObjectUrl } from '@kc/infrastructure-api';
import { type ObjectEntry, type ObjectPage, type ObjectStore, ObjectTooLargeError, type SignedUpload, type StoredObject, type UploadGrant } from './objectStore';
import { isSafeObjectName } from './storageAuthorizer';
import { signGrant } from './storageGrants';

/** Path of the API's routes that stand in for the store's signed addresses; public files are served under the shared public path. */
export const LOCAL_STORE_PATH = '/v1/storage/local';
/** Query parameter that carries the grant: a token is longer than a path segment may be. */
export const GRANT_PARAMETER = 'grant';
const META_SUFFIX = '.kcmeta.json';

/** A bucket or object name that could address something outside the store's directory. */
export class UnsafeObjectPathError extends Error {
  constructor() {
    super('unsafe object path');
    this.name = 'UnsafeObjectPathError';
  }
}

export interface LocalObjectStoreOptions {
  /** Directory the objects are kept in; created on first use. */
  readonly directory: string;
  /** The API's own base URL, which the store's URLs point back at. */
  readonly baseUrl: string;
  /** Key of the grants in the URLs. */
  readonly signingSecret: string;
  /** Current time in milliseconds; replaced in tests. */
  readonly now?: () => number;
}

/**
 * An `ObjectStore` on a local directory, for development and tests (ADR-012
 * section 1): every flow of the real store, with no cloud account. Its
 * "signed URLs" are routes of this API that carry a grant
 * (`localStoreRoutes.ts`). Not for production: there is no CDN, no
 * replication, and the bytes pass through the API.
 */
export class LocalObjectStore implements ObjectStore {
  constructor(private readonly options: LocalObjectStoreOptions) {}

  signedUploadUrl(grant: UploadGrant, expiresInSeconds: number): Promise<SignedUpload> {
    const expiresAt = this.nowSeconds() + expiresInSeconds;
    const token = signGrant({ action: 'upload', ...grant, expiresAt }, this.options.signingSecret);
    return Promise.resolve({
      url: `${this.options.baseUrl}${LOCAL_STORE_PATH}/upload?${GRANT_PARAMETER}=${token}`,
      method: 'PUT',
      headers: { 'content-type': grant.contentType },
      expiresAt: new Date(expiresAt * 1000).toISOString(),
    });
  }

  signedReadUrl(bucket: string, name: string, expiresInSeconds: number): Promise<string> {
    const token = signGrant({ action: 'read', bucket, name, expiresAt: this.nowSeconds() + expiresInSeconds }, this.options.signingSecret);
    return Promise.resolve(`${this.options.baseUrl}${LOCAL_STORE_PATH}/read?${GRANT_PARAMETER}=${token}`);
  }

  publicUrl(bucket: string, name: string): string {
    return publicObjectUrl(this.options.baseUrl, bucket, name);
  }

  async head(bucket: string, name: string): Promise<StoredObject | null> {
    const path = this.pathOf(bucket, name) + META_SUFFIX;
    try {
      return JSON.parse(await readFile(path, 'utf8')) as StoredObject;
    } catch {
      return null;
    }
  }

  async read(bucket: string, name: string, options: { readonly maxBytes?: number } = {}): Promise<Uint8Array | null> {
    const path = this.pathOf(bucket, name);
    let size: number;
    try {
      size = (await stat(path)).size;
    } catch {
      return null;
    }
    // Decided from the file's size, before a byte of it is read.
    if (options.maxBytes !== undefined && size > options.maxBytes) throw new ObjectTooLargeError(options.maxBytes);
    return readFile(path).catch(() => null);
  }

  async write(bucket: string, name: string, bytes: Uint8Array, object: Omit<StoredObject, 'size'>): Promise<boolean> {
    const path = this.pathOf(bucket, name);
    await mkdir(dirname(path), { recursive: true });
    try {
      // `wx` fails when the file exists: an upload never replaces an object.
      await writeFile(path, bytes, { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw error;
    }
    const stored: StoredObject = { size: bytes.byteLength, contentType: object.contentType, cacheControl: object.cacheControl };
    await writeFile(path + META_SUFFIX, JSON.stringify(stored));
    return true;
  }

  async delete(bucket: string, name: string): Promise<void> {
    const path = this.pathOf(bucket, name);
    await Promise.all([rm(path, { force: true }), rm(path + META_SUFFIX, { force: true })]);
  }

  async list(bucket: string, prefix: string, options: { readonly limit: number; readonly pageToken?: string }): Promise<ObjectPage> {
    if (!isSafeObjectName(bucket) || bucket.includes('/')) throw new UnsafeObjectPathError();
    const names = (await this.namesUnder(join(this.options.directory, encodeURIComponent(bucket)), ''))
      // The token is the last name of the page before: the next page is every name after it.
      .filter((name) => name.startsWith(prefix) && (options.pageToken === undefined || name > options.pageToken))
      .sort();
    const page = names.slice(0, options.limit);
    const entries = await Promise.all(page.map((name) => this.entryOf(bucket, name)));
    return {
      // An object removed between the walk and the read is simply no longer listed.
      entries: entries.filter((entry): entry is ObjectEntry => entry !== null),
      nextPageToken: names.length > page.length ? (page.at(-1) ?? null) : null,
    };
  }

  /** Every object name under a directory of the store, relative to the bucket. A directory that is not there holds none. */
  private async namesUnder(directory: string, folder: string): Promise<string[]> {
    const children = await readdir(directory, { withFileTypes: true }).catch(() => []);
    const names: string[] = [];
    for (const child of children) {
      const name = folder + decodeURIComponent(child.name);
      if (child.isDirectory()) names.push(...(await this.namesUnder(join(directory, child.name), `${name}/`)));
      else if (!child.name.endsWith(META_SUFFIX)) names.push(name);
    }
    return names;
  }

  private async entryOf(bucket: string, name: string): Promise<ObjectEntry | null> {
    try {
      const file = await stat(this.pathOf(bucket, name));
      // An object is written once and never changed, so the time of its last write is when it was stored.
      return { name, size: file.size, createdAt: file.mtime };
    } catch {
      return null;
    }
  }

  private nowSeconds(): number {
    return Math.floor((this.options.now ?? Date.now)() / 1000);
  }

  /**
   * Where an object's bytes are kept. Callers pass names that already went
   * through `isSafeObjectName`; it is checked again here, so nothing that
   * reaches the file system can leave the bucket's directory.
   * @throws UnsafeObjectPathError for a bucket or name that is not a plain relative path.
   */
  private pathOf(bucket: string, name: string): string {
    if (!isSafeObjectName(name) || !isSafeObjectName(bucket) || bucket.includes('/')) throw new UnsafeObjectPathError();
    return join(this.options.directory, encodeURIComponent(bucket), ...name.split('/').map(encodeURIComponent));
  }
}
