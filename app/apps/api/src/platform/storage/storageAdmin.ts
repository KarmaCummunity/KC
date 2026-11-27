import { Inject, Injectable } from '@nestjs/common';
import { IdentityDatabase } from '../database/identityDatabase';
import { OBJECT_STORE, type ObjectAttributes, type ObjectPage, type ObjectStore } from './objectStore';

/** Objects asked for per page of a listing, and removed per statement. */
export const FILE_PAGE_SIZE = 500;

/** A server module needs the file store and this server has none configured. */
export class NoObjectStoreError extends Error {
  constructor() {
    super('this server has no file store configured');
    this.name = 'NoObjectStoreError';
  }
}

/**
 * File work the server does on its own behalf (ADR-012 section 5): clean-up
 * jobs list and remove files whoever they belong to. Everything here acts as
 * the service role and is never reachable from a member's request.
 */
@Injectable()
export class StorageAdmin {
  constructor(
    @Inject(OBJECT_STORE) private readonly store: ObjectStore | null,
    @Inject(IdentityDatabase) private readonly database: IdentityDatabase,
  ) {}

  /** The ids of every bucket. */
  async buckets(): Promise<string[]> {
    return this.database.runAsService(async (session) => (await session.query<{ id: string }>('select id from storage.buckets order by id')).rows.map((row) => row.id));
  }

  /**
   * One page of the stored objects whose name starts with `prefix`. The
   * store is listed, not the index: a file that was uploaded and never
   * confirmed has no row and must still be found.
   * @throws NoObjectStoreError
   */
  listPage(bucket: string, prefix: string, pageToken?: string): Promise<ObjectPage> {
    return this.requireStore().list(bucket, prefix, { limit: FILE_PAGE_SIZE, ...(pageToken === undefined ? {} : { pageToken }) });
  }

  /**
   * The bytes of a file, or null when it is not stored.
   * @param maxBytes The most the caller will take.
   * @throws ObjectTooLargeError, NoObjectStoreError
   */
  read(bucket: string, name: string, maxBytes: number): Promise<Uint8Array | null> {
    return this.requireStore().read(bucket, name, { maxBytes });
  }

  /**
   * Stores a file the server made (a sanitized copy, a thumbnail) and writes
   * its row, so the database sees it with its real size and type. A name
   * that is taken is never replaced.
   * @returns false when the name is taken.
   * @throws NoObjectStoreError
   */
  async write(bucket: string, name: string, bytes: Uint8Array, object: ObjectAttributes): Promise<boolean> {
    if (!(await this.requireStore().write(bucket, name, bytes, object))) return false;
    await this.database.runAsService((session) =>
      session.query('insert into storage.objects (bucket_id, name, metadata) values ($1, $2, $3::jsonb) on conflict (bucket_id, name) do nothing', [
        bucket,
        name,
        JSON.stringify({ size: bytes.byteLength, mimetype: object.contentType, cacheControl: object.cacheControl }),
      ]),
    );
    return true;
  }

  /**
   * Removes files and their rows. The rows go first: if the store then
   * fails, what is left is an object without a row, which the reconciliation
   * finds, and never a row that promises a file that is gone.
   * @throws NoObjectStoreError
   */
  async remove(bucket: string, names: readonly string[]): Promise<void> {
    const store = this.requireStore();
    if (names.length === 0) return;
    await this.database.runAsService((session) => session.query('delete from storage.objects where bucket_id = $1 and name = any($2::text[])', [bucket, [...names]]));
    for (const name of names) await store.delete(bucket, name);
  }

  /**
   * How many objects are stored under `<folder>/` of a bucket.
   * @throws NoObjectStoreError
   */
  async countFolder(bucket: string, folder: string): Promise<number> {
    let count = 0;
    let pageToken: string | undefined;
    do {
      const page = await this.listPage(bucket, `${folder}/`, pageToken);
      count += page.entries.length;
      pageToken = page.nextPageToken ?? undefined;
    } while (pageToken !== undefined);
    return count;
  }

  /**
   * Empties a folder: every stored object under `<folder>/`, and every row
   * of the index under it, including a row whose object is already gone.
   * @returns How many stored objects were removed.
   * @throws NoObjectStoreError
   */
  async removeFolder(bucket: string, folder: string): Promise<number> {
    const prefix = `${folder}/`;
    let removed = 0;
    let pageToken: string | undefined;
    do {
      const page = await this.listPage(bucket, prefix, pageToken);
      await this.remove(bucket, page.entries.map((entry) => entry.name));
      removed += page.entries.length;
      pageToken = page.nextPageToken ?? undefined;
    } while (pageToken !== undefined);
    await this.database.runAsService((session) => session.query('delete from storage.objects where bucket_id = $1 and starts_with(name, $2)', [bucket, prefix]));
    return removed;
  }

  private requireStore(): ObjectStore {
    if (!this.store) throw new NoObjectStoreError();
    return this.store;
  }
}
