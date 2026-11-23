import { Inject, Injectable } from '@nestjs/common';
import { IdentityDatabase } from '../database/identityDatabase';
import type { JobReport, ScheduledJob } from '../jobs/scheduledJob';

/** How long a sent event stays in the queue. Delivery needs seconds; an hour leaves room to look at what was sent. */
export const REALTIME_RETENTION_MINUTES = 60;

/**
 * Deletes old rows of `realtime.messages` (ADR-011 section 3): the table is a
 * queue the gateway reads within seconds, so nothing in it is needed for long.
 */
@Injectable()
export class PruneRealtimeMessagesJob implements ScheduledJob {
  readonly name = 'realtime-retention';

  constructor(@Inject(IdentityDatabase) private readonly database: IdentityDatabase) {}

  /** @returns `{ deleted }`, the number of rows removed. */
  async run(): Promise<JobReport> {
    // `inserted_at` is a timestamp without a zone, written in UTC like every session of this database.
    const result = await this.database.runAsService((session) =>
      session.query("delete from realtime.messages where inserted_at < (now() at time zone 'utc') - make_interval(mins => $1)", [REALTIME_RETENTION_MINUTES]),
    );
    return { deleted: result.rowCount ?? 0 };
  }
}
