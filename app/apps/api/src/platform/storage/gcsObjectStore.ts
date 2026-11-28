import type { File, Storage } from '@google-cloud/storage';
import { publicObjectUrl } from '@kc/infrastructure-api';
import type { ObjectPage, ObjectStore, SignedUpload, StoredObject, UploadGrant } from './objectStore';
import { ObjectTooLargeError } from './objectStore';

const HTTP_NOT_FOUND = 404;
const HTTP_PRECONDITION_FAILED = 412;
/** Type recorded for an object that was stored without one. */
const UNTYPED = 'application/octet-stream';

export interface GcsObjectStoreOptions {
  /** The Cloud Storage client. The deployed API builds it from the service's own identity: there is no key file. */
  readonly storage: Storage;
  /**
   * What comes before a KC bucket's name to make the cloud bucket's name,
   * e.g. `kc-dev-` for `kc-dev-avatars`: cloud bucket names are unique among
   * all customers, and each environment has its own set.
   */
  readonly bucketPrefix: string;
  /** KC's media address, which serves the public buckets under the shared public path. */
  readonly mediaBaseUrl: string;
}

/**
 * An `ObjectStore` on Google Cloud Storage (ADR-012 section 1), for the
 * deployed API. What a grant fixes is enforced by the store itself, because
 * it is part of the signed address: the content type, the largest size, and
 * that the name is still free. A client that sends anything else is refused
 * by Cloud Storage, without the API seeing the bytes.
 */
export class GcsObjectStore implements ObjectStore {
  constructor(private readonly options: GcsObjectStoreOptions) {}

  async signedUploadUrl(grant: UploadGrant, expiresInSeconds: number): Promise<SignedUpload> {
    const expires = Date.now() + expiresInSeconds * 1000;
    // Signed headers are conditions: the store accepts the upload only when the client sends each of them unchanged.
    const conditions: Record<string, string> = {
      // Generation 0 is "no object yet": an upload never replaces one.
      'x-goog-if-generation-match': '0',
      'x-goog-content-length-range': `0,${grant.maxBytes}`,
      ...(grant.cacheControl === null ? {} : { 'cache-control': grant.cacheControl }),
    };
    const [url] = await this.file(grant.bucket, grant.name).getSignedUrl({
      version: 'v4',
      action: 'write',
      expires,
      contentType: grant.contentType,
      extensionHeaders: conditions,
    });
    return { url, method: 'PUT', headers: { 'content-type': grant.contentType, ...conditions }, expiresAt: new Date(expires).toISOString() };
  }

  async signedReadUrl(bucket: string, name: string, expiresInSeconds: number): Promise<string> {
    const [url] = await this.file(bucket, name).getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + expiresInSeconds * 1000 });
    return url;
  }

  publicUrl(bucket: string, name: string): string {
    return publicObjectUrl(this.options.mediaBaseUrl, bucket, name);
  }

  async head(bucket: string, name: string): Promise<StoredObject | null> {
    try {
      const [metadata] = await this.file(bucket, name).getMetadata();
      return { size: Number(metadata.size), contentType: metadata.contentType ?? UNTYPED, cacheControl: metadata.cacheControl ?? null };
    } catch (error) {
      if (statusOf(error) === HTTP_NOT_FOUND) return null;
      throw error;
    }
  }

  async read(bucket: string, name: string, options: { readonly maxBytes?: number } = {}): Promise<Uint8Array | null> {
    const stored = await this.head(bucket, name);
    if (!stored) return null;
    // Decided from the recorded size, before a byte is fetched. An object never changes, so the size holds.
    if (options.maxBytes !== undefined && stored.size > options.maxBytes) throw new ObjectTooLargeError(options.maxBytes);
    try {
      const [bytes] = await this.file(bucket, name).download();
      return bytes;
    } catch (error) {
      // Removed between the two calls: the same answer as never stored.
      if (statusOf(error) === HTTP_NOT_FOUND) return null;
      throw error;
    }
  }

  async write(bucket: string, name: string, bytes: Uint8Array, object: Omit<StoredObject, 'size'>): Promise<boolean> {
    try {
      await this.file(bucket, name).save(Buffer.from(bytes), {
        // One request: these are copies and thumbnails, far below the size where a resumable session pays for its extra round trip.
        resumable: false,
        contentType: object.contentType,
        metadata: object.cacheControl === null ? {} : { cacheControl: object.cacheControl },
        // Generation 0 is "no object yet": the store refuses a name that is taken, also between two servers.
        preconditionOpts: { ifGenerationMatch: 0 },
      });
      return true;
    } catch (error) {
      if (statusOf(error) === HTTP_PRECONDITION_FAILED) return false;
      throw error;
    }
  }

  async delete(bucket: string, name: string): Promise<void> {
    await this.file(bucket, name).delete({ ignoreNotFound: true });
  }

  async list(bucket: string, prefix: string, options: { readonly limit: number; readonly pageToken?: string }): Promise<ObjectPage> {
    // Without a delimiter the listing is flat, in name order: a slash is part of the name.
    const [files, nextQuery] = await this.options.storage.bucket(this.cloudBucket(bucket)).getFiles({
      prefix,
      maxResults: options.limit,
      autoPaginate: false,
      ...(options.pageToken === undefined ? {} : { pageToken: options.pageToken }),
    });
    return {
      entries: files.map((file) => ({ name: file.name, size: Number(file.metadata.size), createdAt: new Date(file.metadata.timeCreated ?? 0) })),
      nextPageToken: nextQuery?.pageToken ?? null,
    };
  }

  private file(bucket: string, name: string): File {
    return this.options.storage.bucket(this.cloudBucket(bucket)).file(name);
  }

  private cloudBucket(bucket: string): string {
    return this.options.bucketPrefix + bucket;
  }
}

/** The HTTP status a Cloud Storage error carries, when it carries one. */
function statusOf(error: unknown): number | null {
  const code = (error as { readonly code?: unknown } | null)?.code;
  return typeof code === 'number' ? code : null;
}
