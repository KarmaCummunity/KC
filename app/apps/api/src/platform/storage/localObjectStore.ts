import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { publicObjectUrl } from '@kc/infrastructure-api';
import type { ObjectStore, SignedUpload, StoredObject, UploadGrant } from './objectStore';
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

  async read(bucket: string, name: string): Promise<Uint8Array | null> {
    const path = this.pathOf(bucket, name);
    try {
      return await readFile(path);
    } catch {
      return null;
    }
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
