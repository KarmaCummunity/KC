import { Inject, Injectable } from '@nestjs/common';
import { IdentityDatabase } from '../../platform/database/identityDatabase';
import type { JobReport, ScheduledJob } from '../../platform/jobs/scheduledJob';
import { APP_LOGGER, type AppLogger } from '../../platform/logging/appLogger';
import { StorageAdmin } from '../../platform/storage/storageAdmin';
import { reconcileStorage } from './reconcileStorage';

/**
 * The daily removal of files no row references, on KC's own storage
 * (ADR-012). Ported from `supabase/functions/reconcile-storage-orphans`; the
 * rules are in `reconcileStorage.ts`.
 */
@Injectable()
export class ReconcileStorageOrphansJob implements ScheduledJob {
  readonly name = 'reconcile-storage-orphans';

  constructor(
    @Inject(StorageAdmin) private readonly files: StorageAdmin,
    @Inject(IdentityDatabase) private readonly database: IdentityDatabase,
    @Inject(APP_LOGGER) private readonly logger: AppLogger,
  ) {}

  /** @returns `{ scanned, removed, errors }`. */
  async run(): Promise<JobReport> {
    const summary = await reconcileStorage({
      files: this.files,
      db: {
        orphanKeys: (bucket, keys) =>
          this.database.runAsService(async (session) =>
            (await session.query<{ key: string }>('select k as key from kc_private.storage_orphan_keys($1::text, $2::text[]) k', [bucket, [...keys]])).rows.map((row) => row.key),
          ),
      },
      report: (error, tags) => this.logger.error({ err: error, ...tags }, 'storage reconciliation step failed'),
    });
    return { ...summary };
  }
}
