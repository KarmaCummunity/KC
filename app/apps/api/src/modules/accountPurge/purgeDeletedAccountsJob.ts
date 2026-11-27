import { Inject, Injectable } from '@nestjs/common';
import { type DatabaseSession, IdentityDatabase } from '../../platform/database/identityDatabase';
import { batchLimit, type JobReport, type ScheduledJob } from '../../platform/jobs/scheduledJob';
import { APP_LOGGER, type AppLogger } from '../../platform/logging/appLogger';
import { StorageAdmin } from '../../platform/storage/storageAdmin';
import { type PurgeDatabase, purgeDueAccounts } from './purgeAccounts';
import { type SweepAnswer, type SweepDatabase, sweepDueIntents, type SweepSummary } from './sweepDeletionIntents';

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
   * @returns `{ purged, failed, deferred, intents }`; `intents` is null when the re-sweep itself failed.
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
    // The re-sweep never undoes or hides the accounts purged above: its own failure is logged
    // and the run still answers with what it purged.
    let intents: SweepSummary | null = null;
    try {
      intents = await sweepDueIntents(this.sweepDatabase(), this.files, (error, intentId) =>
        this.logger.error({ err: error, stage: 'sweep', intent_id: intentId }, 'storage deletion intent sweep failed'),
      );
    } catch (error) {
      this.logger.error({ err: error, stage: 'sweep' }, 'storage deletion intents could not be swept');
    }
    return { ...summary, intents };
  }

  /** One statement as the service role, in its own transaction. */
  private one<Row extends Record<string, unknown>>(text: string, values: unknown[]): Promise<Row[]> {
    return this.database.runAsService(async (session: DatabaseSession) => (await session.query<Row>(text, values)).rows);
  }

  /** The database port of the re-sweep. */
  private sweepDatabase(): SweepDatabase {
    return {
      dueIntents: async (limit) =>
        (await this.one<{ id: string; bucket: string; prefix: string }>('select d.id, d.bucket, d.prefix from kc_private.storage_deletion_intents_due($1::integer) d', [limit])).map((row) => ({
          id: Number(row.id),
          bucket: row.bucket,
          prefix: row.prefix,
        })),
      recordSweep: async (id, found, remaining, error) =>
        ((await this.one<{ answer: SweepAnswer }>('select kc_private.storage_deletion_intent_swept($1::bigint, $2::integer, $3::integer, $4::text) as answer', [id, found, remaining, error]))[0]?.answer ?? 'unknown'),
      pruneIntents: async () => Number((await this.one<{ pruned: string }>('select kc_private.storage_deletion_intents_prune() as pruned', []))[0]?.pruned ?? 0),
    };
  }

  /** The database port of the purge: each method is one statement. */
  private purgeDatabase(): PurgeDatabase {
    const one = this.one.bind(this);
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
