import { Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Client } from 'pg';
import type { ApiConfig } from '../config/apiConfig';
import { API_CONFIG } from '../config/apiConfig.module';
import { IdentityDatabase } from '../database/identityDatabase';
import { APP_LOGGER, type AppLogger } from '../logging/appLogger';
import { RealtimeHub } from './realtimeHub';

/** The channel `realtime.send` notifies on; the payload is the id of the stored row. */
export const REALTIME_NOTIFY_CHANNEL = 'kc_realtime';
/** How often rows the notifications may have missed are looked for. */
const SWEEP_INTERVAL_MS = 5_000;
/** How far back a sweep looks: several sweeps, so one failed sweep loses nothing. */
const SWEEP_WINDOW_SECONDS = 20;
/** How long a delivered row is remembered: longer than the sweep window, so no sweep delivers it again. */
const REMEMBER_DELIVERED_MS = 2 * SWEEP_WINDOW_SECONDS * 1000;
/** The longest start-up waits for the listening connection. */
const STARTUP_WAIT_MS = 2_000;
/** Wait before the listening connection is opened again after it was lost. */
const RECONNECT_DELAY_MS = 1_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface StoredEvent {
  readonly id: string;
  readonly topic: string;
  readonly event: string | null;
  readonly payload: unknown;
}

const EVENT_COLUMNS = 'id, topic, event, payload';

/**
 * Brings the events the database sends to this instance's subscribers
 * (ADR-011 section 3). `realtime.messages` is the queue and `NOTIFY` the
 * bell: on a notification the row is read and handed to the hub. A sweep
 * re-reads the last seconds, which covers a notification lost while the
 * listening connection was down. A row is delivered at most once here.
 */
@Injectable()
export class DatabaseEvents implements OnModuleInit, OnApplicationShutdown {
  /** Row id → when it may be forgotten. Stops the sweep from delivering a row twice. */
  private readonly delivered = new Map<string, number>();
  private listener: Client | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(IdentityDatabase) private readonly database: IdentityDatabase,
    @Inject(RealtimeHub) private readonly hub: RealtimeHub,
    @Inject(APP_LOGGER) private readonly logger: AppLogger,
  ) {}

  /**
   * Starts listening before the server takes connections, so the first
   * subscriber misses nothing, but waits only briefly: the API starts and
   * serves requests whether or not the database is reachable yet.
   */
  async onModuleInit(): Promise<void> {
    await Promise.race([this.listen(), new Promise((resolve) => setTimeout(resolve, STARTUP_WAIT_MS).unref())]);
    this.sweepTimer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    // The timers must not keep a stopping process alive.
    this.sweepTimer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    await this.listener?.end().catch(() => undefined);
  }

  /** Opens the listening connection; when it is lost, opens it again after a pause. */
  private async listen(): Promise<void> {
    if (this.stopped) return;
    // A connection of its own: `LISTEN` belongs to a session, and pooled connections change hands.
    const client = new Client({ connectionString: this.config.databaseUrl });
    const lost = (error?: unknown) => {
      if (this.listener !== client) return;
      this.listener = null;
      if (this.stopped) return;
      this.logger.warn({ err: error }, 'realtime: the listening connection was lost; reconnecting');
      this.reconnectTimer = setTimeout(() => void this.listen(), RECONNECT_DELAY_MS);
      this.reconnectTimer.unref();
    };
    client.on('notification', (notification) => {
      if (notification.payload && UUID.test(notification.payload)) void this.deliverRows([notification.payload]);
    });
    client.on('error', lost);
    client.on('end', () => lost());
    this.listener = client;
    try {
      await client.connect();
      await client.query(`listen ${REALTIME_NOTIFY_CHANNEL}`);
      // What was sent while nobody listened.
      await this.sweep();
    } catch (error) {
      await client.end().catch(() => undefined);
      lost(error);
    }
  }

  /** Reads the rows of these ids and hands the ones not yet delivered to the hub. */
  private async deliverRows(ids: readonly string[]): Promise<void> {
    const wanted = ids.filter((id) => !this.delivered.has(id));
    if (wanted.length === 0) return;
    try {
      const rows = await this.read(`select ${EVENT_COLUMNS} from realtime.messages where id = any($1::uuid[]) and extension = 'broadcast'`, [wanted]);
      this.handOver(rows);
    } catch (error) {
      // The sweep will find the rows again.
      this.logger.warn({ err: error }, 'realtime: an event row could not be read');
    }
  }

  /** Hands over the recent rows no notification brought. */
  private async sweep(): Promise<void> {
    if (this.stopped) return;
    try {
      // `inserted_at` is a timestamp without a zone, written in UTC like every session of this database.
      const rows = await this.read(
        `select ${EVENT_COLUMNS} from realtime.messages
          where extension = 'broadcast' and inserted_at > (now() at time zone 'utc') - make_interval(secs => $1)
          order by inserted_at`,
        [SWEEP_WINDOW_SECONDS],
      );
      this.handOver(rows);
      this.forgetOld();
    } catch (error) {
      this.logger.warn({ err: error }, 'realtime: the sweep failed');
    }
  }

  private read(sql: string, values: unknown[]): Promise<StoredEvent[]> {
    return this.database.runAsService(async (session) => (await session.query<StoredEvent>(sql, values)).rows);
  }

  private handOver(rows: readonly StoredEvent[]): void {
    const forgetAt = Date.now() + REMEMBER_DELIVERED_MS;
    for (const row of rows) {
      if (this.delivered.has(row.id)) continue;
      this.delivered.set(row.id, forgetAt);
      this.hub.deliver(row.topic, 'broadcast', { op: 'event', topic: row.topic, event: row.event ?? '', payload: row.payload });
    }
  }

  private forgetOld(): void {
    const now = Date.now();
    for (const [id, forgetAt] of this.delivered) if (forgetAt <= now) this.delivered.delete(id);
  }
}
