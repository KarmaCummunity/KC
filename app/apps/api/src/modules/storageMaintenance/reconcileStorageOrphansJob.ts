import { Inject, Injectable } from '@nestjs/common';
import { IdentityDatabase } from '../../platform/database/identityDatabase';
import type { JobReport, ScheduledJob } from '../../platform/jobs/scheduledJob';
import { APP_LOGGER, type AppLogger } from '../../platform/logging/appLogger';
import { StorageAdmin } from '../../platform/storage/storageAdmin';
import { reconcileStorage } from './reconcileStorage';
import { removeUnindexedFiles } from './removeUnindexedFiles';

/**
 * The daily removal of files nothing references, on KC's own storage
 * (ADR-012), in two passes. The first is ported from
 * `supabase/functions/reconcile-storage-orphans`: files of a post no row of
 * the product references (`reconcileStorage.ts`). The second is new with
 * KC's store: files of any bucket that have no row in the index
 * (`removeUnindexedFiles.ts`).
 */
@Injectable()
export class ReconcileStorageOrphansJob implements ScheduledJob {
  readonly name = 'reconcile-storage-orphans';

  constructor(
    @Inject(StorageAdmin) private readonly files: StorageAdmin,
    @Inject(IdentityDatabase) private readonly database: IdentityDatabase,
    @Inject(APP_LOGGER) private readonly logger: AppLogger,
  ) {}

  /** @returns `{ scanned, removed, errors }` of the first pass, and the second pass's own under `unindexed` (with the buckets it `skipped`). */
  async run(): Promise<JobReport> {
    const report = (error: unknown, tags: { stage: string; bucket: string }) => this.logger.error({ err: error, ...tags }, 'storage reconciliation step failed');
    const summary = await reconcileStorage({
      files: this.files,
      db: {
        orphanKeys: (bucket, keys) =>
          this.database.runAsService(async (session) =>
            (await session.query<{ key: string }>('select k as key from kc_private.storage_orphan_keys($1::text, $2::text[]) k', [bucket, [...keys]])).rows.map((row) => row.key),
          ),
      },
      report,
    });
    const unindexed = await removeUnindexedFiles(
      {
        files: this.files,
        index: {
          hasFiles: (bucket) =>
            this.database.runAsService(async (session) => (await session.query<{ found: boolean }>('select exists (select 1 from storage.objects where bucket_id = $1) as found', [bucket])).rows[0]!.found),
          unindexed: (bucket, names) =>
            this.database.runAsService(async (session) =>
              (
                await session.query<{ name: string }>(
                  'select n as name from unnest($2::text[]) n where not exists (select 1 from storage.objects o where o.bucket_id = $1 and o.name = n)',
                  [bucket, [...names]],
                )
              ).rows.map((row) => row.name),
            ),
        },
        report,
      },
      await this.files.buckets(),
    );
    return { ...summary, unindexed };
  }
}
