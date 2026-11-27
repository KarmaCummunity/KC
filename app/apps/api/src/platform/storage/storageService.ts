import { Inject, Injectable } from '@nestjs/common';
import { IdentityDatabase } from '../database/identityDatabase';
import type { HttpAnswer } from '../http/httpAnswer';
import type { CallerIdentity } from '../identity/callerIdentity';
import { OBJECT_STORE, type ObjectStore, type StoredObject } from './objectStore';
import { type BucketRules, isSafeObjectName, StorageAuthorizer } from './storageAuthorizer';

/** How long a member has to carry out an upload they were granted. */
const UPLOAD_URL_SECONDS = 10 * 60;
/** Longest a signed read URL may live; a caller may ask for less. */
export const MAX_READ_URL_SECONDS = 60 * 60;
/** Objects one delete request may name. */
export const MAX_DELETE_NAMES = 100;
/** Size limit of a bucket that declares none of its own. */
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

/** PostgreSQL insufficient_privilege and foreign_key_violation: the policy refused the row, or the bucket is gone. */
const REFUSED_WRITE = new Set(['42501', '23503']);

const refusal = (status: number, error: string): HttpAnswer => ({ status, body: { error } });
const maxBytesOf = (rules: BucketRules): number => rules.fileSizeLimit ?? DEFAULT_MAX_BYTES;

/** The refusal for a file the bucket's own rules do not take, or null when it fits. */
function brokenRule(rules: BucketRules, size: number, contentType: string): HttpAnswer | null {
  if (size > maxBytesOf(rules)) return refusal(413, 'too_large');
  if (rules.allowedMimeTypes && !rules.allowedMimeTypes.includes(contentType)) return refusal(415, 'type_not_allowed');
  return null;
}
const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

/**
 * What a member can do with stored files (ADR-012 section 4): get a signed
 * URL to upload with, confirm the upload, get a signed URL to read a private
 * file, and delete their files. Every right is the database's (the
 * authorizer); the bytes go between the member and the store, never through
 * here.
 */
@Injectable()
export class StorageService {
  constructor(
    @Inject(OBJECT_STORE) private readonly store: ObjectStore | null,
    @Inject(StorageAuthorizer) private readonly authorizer: StorageAuthorizer,
    @Inject(IdentityDatabase) private readonly database: IdentityDatabase,
  ) {}

  /**
   * Grants an upload of `<bucket>/<name>`. A name is written once: a file
   * that exists is never replaced, so a URL the member already shows keeps
   * meaning the same bytes.
   * @returns `200 { upload }`, or `400 invalid_request`, `403 forbidden`, `409 exists`,
   *   `413 too_large`, `415 type_not_allowed`, `503 not_configured`.
   */
  async grantUpload(caller: CallerIdentity, body: unknown): Promise<HttpAnswer> {
    if (!this.store) return refusal(503, 'not_configured');
    const { bucket, name, contentType, size, cacheControl } = (body ?? {}) as Record<string, unknown>;
    if (!isText(bucket) || !isText(name) || !isSafeObjectName(name) || !isText(contentType) || typeof size !== 'number' || !Number.isInteger(size) || size <= 0) {
      return refusal(400, 'invalid_request');
    }
    const rules = await this.authorizer.bucketRules(bucket);
    if (!rules || !(await this.authorizer.mayUpload(caller, bucket, name))) return refusal(403, 'forbidden');
    const outsideRules = brokenRule(rules, size, contentType);
    if (outsideRules) return outsideRules;
    if (await this.authorizer.objectExists(bucket, name)) return refusal(409, 'exists');
    const upload = await this.store.signedUploadUrl({ bucket, name, contentType, maxBytes: maxBytesOf(rules), cacheControl: isText(cacheControl) ? cacheControl : null }, UPLOAD_URL_SECONDS);
    return { status: 200, body: { upload } };
  }

  /**
   * Confirms an upload and writes its row, as the caller, so the insert
   * policy decides once more on the real row. The stored object is checked
   * against the bucket's rules here too: what the store accepted is what
   * counts, not what the grant asked for. Confirming twice is harmless. When
   * the row is refused the object is left for the reconciliation job, which
   * removes files without a row: it may be another member's upload in flight.
   * @returns `200 { path }`, or `400 invalid_request`, `403 forbidden`, `404 not_uploaded`,
   *   `413 too_large`, `415 type_not_allowed`, `503 not_configured`.
   */
  async completeUpload(caller: CallerIdentity, body: unknown): Promise<HttpAnswer> {
    if (!this.store) return refusal(503, 'not_configured');
    const { bucket, name } = (body ?? {}) as Record<string, unknown>;
    if (!isText(bucket) || !isText(name) || !isSafeObjectName(name)) return refusal(400, 'invalid_request');
    const rules = await this.authorizer.bucketRules(bucket);
    // Asked before the store is looked at: a member with no right to the name learns nothing about it, and nothing of another member's is touched.
    if (!rules || !(await this.authorizer.mayUpload(caller, bucket, name))) return refusal(403, 'forbidden');
    const stored = await this.store.head(bucket, name);
    if (!stored) return refusal(404, 'not_uploaded');
    const outsideRules = brokenRule(rules, stored.size, stored.contentType);
    if (outsideRules) {
      // The caller's own upload, outside the bucket's rules: it gets no row, so it must not stay.
      await this.store.delete(bucket, name);
      return outsideRules;
    }
    return (await this.indexObject(caller, bucket, name, stored)) ? { status: 200, body: { path: name } } : refusal(403, 'forbidden');
  }

  /**
   * Stores bytes this server already holds, as `caller`: the server-side
   * counterpart of grant, upload and confirm, for a hosted adapter that copies
   * a file (ADR-012 section 5). The same policy and bucket rules apply.
   * @returns `200 { path }`, or `400 invalid_request`, `403 forbidden`, `409 exists`,
   *   `413 too_large`, `415 type_not_allowed`, `503 not_configured`.
   */
  async storeBytes(caller: CallerIdentity | null, file: { bucket: string; name: string; bytes: Uint8Array; contentType: string }): Promise<HttpAnswer> {
    if (!this.store) return refusal(503, 'not_configured');
    const { bucket, name, bytes, contentType } = file;
    if (!isSafeObjectName(name) || bytes.byteLength === 0) return refusal(400, 'invalid_request');
    const rules = await this.authorizer.bucketRules(bucket);
    if (!caller || !rules || !(await this.authorizer.mayUpload(caller, bucket, name))) return refusal(403, 'forbidden');
    const outsideRules = brokenRule(rules, bytes.byteLength, contentType);
    if (outsideRules) return outsideRules;
    const stored = { size: bytes.byteLength, contentType, cacheControl: null };
    // The store refuses to replace: a name that is taken stays what it was.
    if (!(await this.store.write(bucket, name, bytes, stored))) return refusal(409, 'exists');
    if (await this.indexObject(caller, bucket, name, stored)) return { status: 200, body: { path: name } };
    // This call created the object a moment ago and the index refused it: it is ours to remove.
    await this.store.delete(bucket, name);
    return refusal(403, 'forbidden');
  }

  /**
   * Writes the object's row as the caller, so the insert policy decides on
   * the real row. Writing a row that is already there changes nothing.
   * @returns false when the policy refused the row (the right was lost since it was asked).
   */
  private async indexObject(caller: CallerIdentity, bucket: string, name: string, stored: Omit<StoredObject, 'md5'>): Promise<boolean> {
    try {
      await this.database.runAs(caller, (session) =>
        session.query('insert into storage.objects (bucket_id, name, metadata) values ($1, $2, $3::jsonb) on conflict (bucket_id, name) do nothing', [
          bucket,
          name,
          JSON.stringify({ size: stored.size, mimetype: stored.contentType, cacheControl: stored.cacheControl }),
        ]),
      );
      return true;
    } catch (error) {
      if (REFUSED_WRITE.has((error as { code?: string }).code ?? '')) return false;
      throw error;
    }
  }

  /**
   * A short-lived URL of a file the caller may read. A file that is not in
   * the index has none: the app also asks this to learn whether an upload it
   * remembers is still there.
   * @returns `200 { signedUrl }`, or `400 invalid_request`, `403 forbidden`, `404 not_found`, `503 not_configured`.
   */
  async signedReadUrl(caller: CallerIdentity, body: unknown): Promise<HttpAnswer> {
    if (!this.store) return refusal(503, 'not_configured');
    const { bucket, name, expiresIn } = (body ?? {}) as Record<string, unknown>;
    if (!isText(bucket) || !isText(name) || typeof expiresIn !== 'number' || expiresIn <= 0) return refusal(400, 'invalid_request');
    if (!(await this.authorizer.mayRead(caller, bucket, name))) return refusal(403, 'forbidden');
    // Only after the right was established: whether a file exists is not told to someone who may not read it.
    if (!(await this.authorizer.objectExists(bucket, name))) return refusal(404, 'not_found');
    return { status: 200, body: { signedUrl: await this.store.signedReadUrl(bucket, name, Math.min(Math.floor(expiresIn), MAX_READ_URL_SECONDS)) } };
  }

  /**
   * Deletes the caller's files and their rows. A name the caller may not
   * delete is skipped, as a delete that matches no row is today.
   * @returns `200 { deleted }` with the names that were removed, or `400 invalid_request`, `503 not_configured`.
   */
  async deleteObjects(caller: CallerIdentity, body: unknown): Promise<HttpAnswer> {
    if (!this.store) return refusal(503, 'not_configured');
    const { bucket, names } = (body ?? {}) as Record<string, unknown>;
    if (!isText(bucket) || !Array.isArray(names) || names.length === 0 || names.length > MAX_DELETE_NAMES || !names.every(isText)) return refusal(400, 'invalid_request');
    const deleted: string[] = [];
    for (const name of new Set(names as string[])) {
      if (!(await this.authorizer.mayDelete(caller, bucket, name))) continue;
      // The row goes first, as the caller: if the store then fails, the reconciliation finds the object without a row.
      await this.database.runAs(caller, (session) => session.query('delete from storage.objects where bucket_id = $1 and name = $2', [bucket, name]));
      await this.store.delete(bucket, name);
      deleted.push(name);
    }
    return { status: 200, body: { deleted } };
  }
}
