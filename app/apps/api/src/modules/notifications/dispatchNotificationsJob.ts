import { Inject, Injectable } from '@nestjs/common';
import { IdentityDatabase } from '../../platform/database/identityDatabase';
import type { JobReport, ScheduledJob } from '../../platform/jobs/scheduledJob';
import { drainPushQueues } from './pushDrain';
import type { PushTransport } from './pushTypes';
import { createSqlPushDatabase } from './sqlPushDatabase';

/** Injection token of the push provider (replaced in tests, so none reaches the network). */
export const PUSH_TRANSPORT = Symbol('PUSH_TRANSPORT');

/**
 * The push worker of the notification queue (FR-NOTIF-001..018): delivers
 * queued notifications to the inbox and sends their pushes through the Expo
 * push service. The rules are in `pushDispatch.ts` and `pushMessages.ts`.
 * Two runs at once never send the same push: the database hands an event to
 * one worker.
 */
@Injectable()
export class DispatchNotificationsJob implements ScheduledJob {
  readonly name = 'dispatch-notification';

  constructor(
    @Inject(IdentityDatabase) private readonly database: IdentityDatabase,
    @Inject(PUSH_TRANSPORT) private readonly transport: PushTransport,
  ) {}

  /** @returns The run's counts (`rounds`, `events`, `sent`, …). */
  run(): Promise<JobReport> {
    // The worker's functions are in `kc_private`: each call is one statement, in its own transaction, as the service role.
    const db = createSqlPushDatabase((sql, params) => this.database.runAsService(async (session) => (await session.query<Record<string, unknown>>(sql, params)).rows));
    return drainPushQueues({ db, transport: this.transport }).then((summary) => ({ ...summary }));
  }
}
