// _shared/storageCleanup.ts
//
// Collects every object a user owns in a userId-first bucket so account
// deletion can purge it (R-MVP-Privacy-6). Buckets covered here store
// objects as `<user_id>/<...>/<file>`; the delete RPC does not track their
// paths, so they are enumerated with the service-role client instead.

/** One row of `storage.from(bucket).list()`: folders have `id === null`. */
export interface StorageListEntry {
  readonly name: string;
  readonly id: string | null;
}

/** Lists one page of direct children of `prefix`. */
export type ListPage = (prefix: string, offset: number, limit: number) => Promise<StorageListEntry[]>;

export const LIST_PAGE_SIZE = 100;
/** `<user_id>/<chat_or_batch>/<file>` is two levels below the user folder. */
export const MAX_FOLDER_DEPTH = 3;

/**
 * Returns the full object paths under `prefix`, descending into sub-folders
 * up to `maxDepth` levels and paging through each folder.
 */
export async function collectObjectPaths(
  listPage: ListPage,
  prefix: string,
  maxDepth: number = MAX_FOLDER_DEPTH,
): Promise<string[]> {
  if (maxDepth <= 0) return [];
  const paths: string[] = [];
  for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
    const page = await listPage(prefix, offset, LIST_PAGE_SIZE);
    for (const entry of page) {
      const full = `${prefix}/${entry.name}`;
      if (entry.id === null) paths.push(...(await collectObjectPaths(listPage, full, maxDepth - 1)));
      else paths.push(full);
    }
    if (page.length < LIST_PAGE_SIZE) break;
  }
  return paths;
}

/** Splits `paths` into chunks the Storage `remove()` API accepts in one call. */
export function chunkPaths(paths: readonly string[], size: number = LIST_PAGE_SIZE): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < paths.length; i += size) chunks.push(paths.slice(i, i + size));
  return chunks;
}

/**
 * Buckets whose storage insert policies require every client upload to sit under
 * `<user_id>/`, so that folder holds everything the user owns there: the avatar and
 * its thumb, post images with their thumbs (attached or not), chat images and
 * listing images. Server-side rewrites (EXIF strip, thumb backfill) stay in it too.
 */
export const USER_FOLDER_BUCKETS = ['avatars', 'chat-media', 'listing-images', 'post-images'] as const;

/** The two Storage calls the purge needs; both reject on a Storage error. */
export interface StorageGateway {
  list(bucket: string, prefix: string, offset: number, limit: number): Promise<StorageListEntry[]>;
  remove(bucket: string, paths: string[]): Promise<void>;
}

/** Receives a Storage failure; the purge itself never throws. */
export type PurgeErrorReporter = (error: unknown, bucket: string) => Promise<void>;

/**
 * Removes every object under `<userId>/` in each user-folder bucket (R-MVP-Privacy-6).
 * A bucket that fails is reported and skipped, so one Storage error never leaves the
 * other buckets untouched.
 */
export async function purgeUserFolders(
  gateway: StorageGateway,
  userId: string,
  onError: PurgeErrorReporter,
): Promise<void> {
  for (const bucket of USER_FOLDER_BUCKETS) {
    try {
      const listPage: ListPage = (prefix, offset, limit) => gateway.list(bucket, prefix, offset, limit);
      for (const chunk of chunkPaths(await collectObjectPaths(listPage, userId))) {
        await gateway.remove(bucket, chunk);
      }
    } catch (error) {
      await onError(error, bucket);
    }
  }
}
