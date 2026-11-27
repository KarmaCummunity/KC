// Removes stored files that have no row in the index (`storage.objects`), in every bucket. The
// index is the record that a file exists (ADR-012 section 2), so a file without a row is one
// nothing can reach: an upload that was sent and never confirmed, or, while the existing files
// are being copied into KC's store (ADR-012 section 6), a copy of a file that was deleted at the
// source afterwards. Without this pass a deleted photo would live on in the copy.
//
// Only files older than `minAgeMs` are judged: an upload is stored before its row is written.

import { MIN_AGE_MS, type OrphanFiles } from './reconcileStorage';

export interface FileIndex {
  /** Whether the index has any row for the bucket. */
  hasFiles(bucket: string): Promise<boolean>;
  /** Of `names` in `bucket`, those without a row. */
  unindexed(bucket: string, names: readonly string[]): Promise<string[]>;
}

export interface UnindexedDeps {
  readonly index: FileIndex;
  readonly files: OrphanFiles;
  /** Receives a failure with the stage and bucket only. */
  readonly report: (error: unknown, tags: { stage: 'scan' | 'remove'; bucket: string }) => void;
  readonly minAgeMs?: number;
  readonly now?: () => number;
}

export interface UnindexedSummary {
  /** Files old enough to be judged. */
  scanned: number;
  removed: number;
  errors: number;
  /** Buckets left untouched because their index is empty. */
  skipped: string[];
}

/**
 * One pass over every bucket, a page of the listing at a time. A page that
 * cannot be listed or judged ends the bucket for this run; a page that cannot
 * be removed is counted and the run goes on.
 *
 * A bucket whose index has no row at all is skipped and named in the answer:
 * stored files beside an empty index is what a server connected to the wrong
 * database looks like, and removing them all would be the worst reading of it.
 */
export async function removeUnindexedFiles(deps: UnindexedDeps, buckets: readonly string[]): Promise<UnindexedSummary> {
  const summary: UnindexedSummary = { scanned: 0, removed: 0, errors: 0, skipped: [] };
  const before = (deps.now ?? Date.now)() - (deps.minAgeMs ?? MIN_AGE_MS);
  for (const bucket of buckets) {
    try {
      if (await deps.index.hasFiles(bucket)) await sweepBucket(deps, bucket, before, summary);
      else summary.skipped.push(bucket);
    } catch (error) {
      summary.errors += 1;
      deps.report(error, { stage: 'scan', bucket });
    }
  }
  return summary;
}

/** Judges every page of one bucket; a listing or index failure is the caller's to count. */
async function sweepBucket(deps: UnindexedDeps, bucket: string, before: number, summary: UnindexedSummary): Promise<void> {
  let pageToken: string | undefined;
  do {
    const page = await deps.files.listPage(bucket, '', pageToken);
    const old = page.entries.filter((file) => file.createdAt.getTime() < before).map((file) => file.name);
    summary.scanned += old.length;
    const unindexed = old.length > 0 ? await deps.index.unindexed(bucket, old) : [];
    pageToken = page.nextPageToken ?? undefined;
    if (unindexed.length === 0) continue;
    try {
      await deps.files.remove(bucket, unindexed);
      summary.removed += unindexed.length;
    } catch (error) {
      summary.errors += unindexed.length;
      deps.report(error, { stage: 'remove', bucket });
    }
  } while (pageToken !== undefined);
}
