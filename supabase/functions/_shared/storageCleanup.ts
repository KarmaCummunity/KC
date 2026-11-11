// _shared/storageCleanup.ts
//
// Lists the objects under a member's folder `<user_id>/` of a bucket, and splits paths
// into batches for the remove API. Used by the account purge (R-MVP-Privacy-6): the
// database does not track storage paths, so the worker enumerates them with the
// service-role client.

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
