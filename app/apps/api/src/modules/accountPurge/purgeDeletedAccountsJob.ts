import { Inject, Injectable } from '@nestjs/common';
import { type DatabaseSession, IdentityDatabase } from '../../platform/database/identityDatabase';
import { batchLimit, type JobReport, type ScheduledJob } from '../../platform/jobs/scheduledJob';
import { APP_LOGGER, type AppLogger } from '../../platform/logging/appLogger';
import { StorageAdmin } from '../../platform/storage/storageAdmin';
import { type PurgeDatabase, purgeDueAccounts } from './purgeAccounts';

/** Accounts one run purges unless the scheduler asks otherwise, and the most it may ask for. */
const DEFAULT_BATCH = 50;
const MAX_BATCH = 200;

/**
 * The daily purge of accounts past their grace period (FR-SETTINGS-012 AC4),
 * on KC's own storage. Ported from `supabase/functions/purge-deleted-accounts`;
 * the order of the steps and why is in `purgeAccounts.ts`.
 */
@Injectable()
export class PurgeDeletedAccountsJob implements ScheduledJob {
  readonly name = 'purge-deleted-accounts';

  constructor(
    @Inject(StorageAdmin) private readonly files: StorageAdmin,
    @Inject(IdentityDatabase) private readonly database: IdentityDatabase,
    @Inject(APP_LOGGER) private readonly logger: AppLogger,
  ) {}

  /**
   * @param input `{ limit? }`: accounts to purge in this run.
   * @returns `{ purged, failed, deferred }`.
   */
  async run(input: Readonly<Record<string, unknown>>): Promise<JobReport> {
    const summary = await purgeDueAccounts(
      {
        db: this.purgeDatabase(),
        files: this.files,
        report: (error, tags) => this.logger.error({ err: error, ...tags }, 'account purge step failed'),
      },
      batchLimit(input.limit, DEFAULT_BATCH, MAX_BATCH),
    );
    return { ...summary };
  }

  /** The database port: each method is one statement, as the service role, in its own transaction. */
  private purgeDatabase(): PurgeDatabase {
    const one = <Row extends Record<string, unknown>>(text: string, values: unknown[]) =>
      this.database.runAsService(async (session: DatabaseSession) => (await session.query<Row>(text, values)).rows);
    return {
      dueAccounts: async (limit) => (await one<{ user_id: string }>('select a.user_id from kc_private.accounts_due_for_purge($1::integer) a', [limit])).map((row) => row.user_id),
      prepare: async (userId) => {
        await one('select kc_private.account_purge_prepare($1::uuid)', [userId]);
      },
      holdForMedia: async (userId) => (await one<{ held: boolean }>('select kc_private.post_media_purge_hold($1::uuid) as held', [userId]))[0]?.held === true,
      finish: async (userId) => (await one<{ finished: boolean }>('select kc_private.account_purge_finish($1::uuid) as finished', [userId]))[0]?.finished === true,
    };
  }
}
