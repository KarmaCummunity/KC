// Removes files no database row references (docs/db/target-design.md, "Cleanup"). The
// database decides what an orphan is (kc_private.storage_orphan_keys); this lists, asks and
// deletes. Ported from supabase/functions/reconcile-storage-orphans.
//
// A device uploads a file before it records the row, and a deleted post loses its rows before
// its files, so only objects older than `minAgeMs` are judged: a fresh upload is never taken
// for an orphan. On KC's own storage the same pass also removes an upload that was sent and
// never confirmed: it has no row anywhere, so the database names it an orphan too.

/** One stored object, as a listing reports it. */
export interface StoredFile {
  readonly name: string;
  readonly createdAt: Date;
}

export interface OrphanDatabase {
  /** Of `keys` in `bucket`, those no row references; empty for a bucket that is not recorded row by row. */
  orphanKeys(bucket: string, keys: readonly string[]): Promise<string[]>;
}

export interface OrphanFiles {
  /** One page of a bucket's objects in name order; `nextPageToken` is null after the last page. */
  listPage(bucket: string, prefix: string, pageToken?: string): Promise<{ readonly entries: readonly StoredFile[]; readonly nextPageToken: string | null }>;
  remove(bucket: string, names: readonly string[]): Promise<void>;
}

export interface ReconcileDeps {
  readonly db: OrphanDatabase;
  readonly files: OrphanFiles;
  /** Receives a failure with the stage and bucket only. */
  readonly report: (error: unknown, tags: { stage: 'scan' | 'remove'; bucket: string }) => void;
  /** Buckets whose objects are recorded row by row. */
  readonly buckets?: readonly string[];
  readonly minAgeMs?: number;
  readonly now?: () => number;
}

export const RECONCILED_BUCKETS = ['post-images'] as const;
export const MIN_AGE_MS = 24 * 60 * 60 * 1000;

export interface OrphanSummary {
  /** Objects old enough to be judged. */
  scanned: number;
  removed: number;
  errors: number;
}

/**
 * One reconciliation run, a page of the listing at a time, so its memory
 * does not grow with the bucket. A page that cannot be listed or judged ends
 * the bucket for this run (the next run starts over); a page that cannot be
 * removed is counted and the run goes on.
 */
export async function reconcileStorage(deps: ReconcileDeps): Promise<OrphanSummary> {
  const summary: OrphanSummary = { scanned: 0, removed: 0, errors: 0 };
  const before = (deps.now ?? Date.now)() - (deps.minAgeMs ?? MIN_AGE_MS);
  for (const bucket of deps.buckets ?? RECONCILED_BUCKETS) {
    let pageToken: string | undefined;
    do {
      let orphans: string[];
      try {
        const page = await deps.files.listPage(bucket, '', pageToken);
        const old = page.entries.filter((file) => file.createdAt.getTime() < before).map((file) => file.name);
        summary.scanned += old.length;
        orphans = old.length > 0 ? await deps.db.orphanKeys(bucket, old) : [];
        pageToken = page.nextPageToken ?? undefined;
      } catch (error) {
        summary.errors += 1;
        deps.report(error, { stage: 'scan', bucket });
        break;
      }
      if (orphans.length === 0) continue;
      try {
        await deps.files.remove(bucket, orphans);
        summary.removed += orphans.length;
      } catch (error) {
        summary.errors += orphans.length;
        deps.report(error, { stage: 'remove', bucket });
      }
    } while (pageToken !== undefined);
  }
  return summary;
}
