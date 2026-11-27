// Copies the files KC already has into its own object store (ADR-012 section 6), by name, and
// proves each copy by size and checksum. The index (`storage.objects`) says which files exist;
// the store they live in today is the source; KC's store is the destination.
//
// A pass can be run again at any time and does only what is still missing: a file whose copy
// is proven is not downloaded again, a file that changed at the source since it was copied is
// replaced, and a copy that cannot be proven is removed, so a pass never leaves a wrong file
// behind. A pass never removes a file the source no longer has: the removal of files without a
// row does that (`storageMaintenance/removeUnindexedFiles.ts`).

import { createHash } from 'node:crypto';
import type { ObjectStore } from '../../platform/storage/objectStore';

/** One file as the index records it. */
export interface IndexedFile {
  readonly name: string;
  /** Size in bytes; null for a row that does not record one. */
  readonly size: number | null;
  readonly contentType: string;
  readonly cacheControl: string | null;
  /** MD5 of the bytes in lower-case hex, when the source recorded one that is a plain MD5; null otherwise. */
  readonly md5: string | null;
}

export interface CopyIndex {
  /**
   * The files of a bucket whose name sorts after `after`, in name order.
   * @param after The last name of the page before; null for the first page.
   * @param limit Most files of one page.
   */
  page(bucket: string, after: string | null, limit: number): Promise<IndexedFile[]>;
}

/** The store the files live in today. */
export interface CopySource {
  /**
   * The buckets this reader can see. A source hides what a caller may not
   * read, so a file it "does not have" means something only in a bucket that
   * is listed here.
   */
  readableBuckets(): Promise<string[]>;
  /**
   * The bytes of a file, or null when the source does not have it.
   * @throws ObjectTooLargeError when the file is larger than `maxBytes`; nothing of it is handed over.
   */
  read(bucket: string, name: string, maxBytes: number): Promise<Uint8Array | null>;
}

/** Where a pass stopped, and so where the next one starts. */
export interface CopyCursor {
  readonly bucket: string;
  /** The last name that was handled; null to start at the bucket's first file. */
  readonly after: string | null;
}

export interface CopyDeps {
  readonly index: CopyIndex;
  readonly source: CopySource;
  readonly destination: Pick<ObjectStore, 'head' | 'write' | 'delete'>;
  /** Receives a file that could not be copied, or that neither store has, with where it is. */
  readonly report: (problem: unknown, file: { bucket: string; name: string }) => void;
}

export interface CopyOptions {
  /** Every bucket to copy. */
  readonly buckets: readonly string[];
  /** Where the pass before stopped; null to start from the first bucket. */
  readonly from: CopyCursor | null;
  /** Most files one pass handles. */
  readonly limit: number;
}

export interface CopySummary {
  /** Files of the index this pass looked at. */
  scanned: number;
  /** Already in the destination with the source's size and checksum. */
  verified: number;
  /** Copied and proven by this pass. */
  copied: number;
  /** Changed at the source since they were copied: copied again. */
  replaced: number;
  /** In the destination only: stored there in the first place, never at the source. */
  destinationOnly: number;
  /** In neither store: a row that promises a file that is gone. */
  absent: number;
  /** Could not be copied or proven; the next pass tries again. */
  failed: number;
  /** Where the next pass starts; null when this one reached the end. */
  next: CopyCursor | null;
}

type Outcome = Exclude<keyof CopySummary, 'scanned' | 'next'>;

/** The largest file a pass will hold in memory: far above every bucket's own limit, so only a file that should not exist is refused. */
export const LARGEST_COPIED_FILE_BYTES = 50 * 1024 * 1024;
/** Files copied at once: enough to keep a pass moving, few enough that their bytes fit in memory together. */
const FILES_AT_ONCE = 4;

/** The source does not show every bucket to this reader: its answers about their files cannot be trusted. */
export class CopySourceAccessError extends Error {
  constructor(readonly buckets: readonly string[]) {
    super(`the source does not let this reader see: ${buckets.join(', ')}`);
    this.name = 'CopySourceAccessError';
  }
}

/** A copy was written and the destination does not report the bytes that were sent. */
export class CopyNotProvenError extends Error {
  constructor() {
    super('the copy does not match its source');
    this.name = 'CopyNotProvenError';
  }
}

/** The destination took the name while the file was being copied. */
export class CopyNameTakenError extends Error {
  constructor() {
    super('the name was taken during the copy');
    this.name = 'CopyNameTakenError';
  }
}

/**
 * One bounded pass over the index, in bucket and name order. A file that
 * fails is counted and reported and the pass goes on; a page of the index
 * that cannot be read fails the pass as a whole, and so does a source that
 * hides a bucket from this reader, before any file is judged.
 * @returns What was done, and the cursor of the next pass.
 * @throws CopySourceAccessError
 */
export async function copyStoredFiles(deps: CopyDeps, options: CopyOptions): Promise<CopySummary> {
  const summary: CopySummary = { scanned: 0, verified: 0, copied: 0, replaced: 0, destinationOnly: 0, absent: 0, failed: 0, next: null };
  const buckets = [...options.buckets].sort();
  const readable = await deps.source.readableBuckets();
  const hidden = buckets.filter((bucket) => !readable.includes(bucket));
  if (hidden.length > 0) throw new CopySourceAccessError(hidden);
  let position = options.from ?? firstOf(buckets);
  while (position !== null && summary.scanned < options.limit) {
    const bucket = position.bucket;
    // A cursor that names a bucket which no longer exists has no files: the pass moves on to the buckets after it.
    const files = buckets.includes(bucket) ? await deps.index.page(bucket, position.after, options.limit - summary.scanned) : [];
    if (files.length === 0) {
      position = firstOf(buckets.filter((candidate) => candidate > bucket));
      continue;
    }
    for (const outcome of await inGroups(files, FILES_AT_ONCE, (file) => copyOne(deps, bucket, file))) summary[outcome] += 1;
    summary.scanned += files.length;
    position = { bucket, after: files[files.length - 1]!.name };
  }
  summary.next = position;
  return summary;
}

function firstOf(buckets: readonly string[]): CopyCursor | null {
  return buckets.length > 0 ? { bucket: buckets[0]!, after: null } : null;
}

/** Runs `work` on every item, `size` at a time, and returns the results in the items' order. */
async function inGroups<T, R>(items: readonly T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += size) results.push(...(await Promise.all(items.slice(start, start + size).map(work))));
  return results;
}

async function copyOne(deps: CopyDeps, bucket: string, file: IndexedFile): Promise<Outcome> {
  try {
    const outcome = await copyFile(deps, bucket, file);
    if (outcome === 'absent') deps.report(new Error('no store has the file'), { bucket, name: file.name });
    return outcome;
  } catch (error) {
    deps.report(error, { bucket, name: file.name });
    return 'failed';
  }
}

async function copyFile({ source, destination }: CopyDeps, bucket: string, file: IndexedFile): Promise<Outcome> {
  const stored = await destination.head(bucket, file.name);
  // The source's own record already proves the copy: nothing is downloaded.
  if (stored && file.md5 !== null && stored.md5 === file.md5 && stored.size === file.size) return 'verified';
  const bytes = await source.read(bucket, file.name, LARGEST_COPIED_FILE_BYTES);
  if (bytes === null) return stored ? 'destinationOnly' : 'absent';
  const md5 = createHash('md5').update(bytes).digest('hex');
  if (stored && stored.md5 === md5 && stored.size === bytes.byteLength) return 'verified';
  // The destination never replaces a name, so a file that changed at the source is removed first.
  if (stored) await destination.delete(bucket, file.name);
  if (!(await destination.write(bucket, file.name, bytes, { contentType: file.contentType, cacheControl: file.cacheControl }))) throw new CopyNameTakenError();
  const written = await destination.head(bucket, file.name);
  if (written?.md5 !== md5 || written.size !== bytes.byteLength) {
    // A copy that cannot be proven must not be served as the file.
    await destination.delete(bucket, file.name);
    throw new CopyNotProvenError();
  }
  return stored ? 'replaced' : 'copied';
}
