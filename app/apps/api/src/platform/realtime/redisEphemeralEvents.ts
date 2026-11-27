import { randomUUID } from 'node:crypto';
import type { PresenceMember } from '@kc/infrastructure-api';
import { Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { APP_LOGGER, type AppLogger } from '../logging/appLogger';
import { REDIS_CLIENT } from '../redis/redis.tokens';
import { EphemeralEvents } from './ephemeralEvents';
import { RealtimeHub } from './realtimeHub';

/** The Redis channel every instance publishes to and listens on. */
const CHANNEL = 'kc:realtime';
const presenceKey = (topic: string) => `kc:realtime:presence:${topic}`;
/** How long a presence entry lives without its instance renewing it. */
export const PRESENCE_TTL_MS = 90_000;
/** How often an instance renews its members' entries and looks for members that vanished. */
const HEARTBEAT_INTERVAL_MS = 30_000;

/** What travels between instances. */
type Message =
  | { readonly kind: 'broadcast'; readonly topic: string; readonly event: string; readonly payload: unknown; readonly senderId: string }
  | { readonly kind: 'presence'; readonly topic: string; readonly joins: PresenceMember[]; readonly leaves: PresenceMember[] };

/** One connection's presence, as stored: the member it shows and until when the entry counts. */
interface StoredPresence extends PresenceMember {
  readonly until: number;
}

/**
 * Client-sent broadcasts and presence across every instance (ADR-011 section
 * 4). An event is published to Redis and each instance hands it to its own
 * subscribers. Presence is a Redis hash per topic, one field per connection,
 * each with an expiry its instance renews, so the members of an instance that
 * died disappear on their own. When Redis cannot be reached an event still
 * reaches the subscribers of the instance it arrived at.
 */
@Injectable()
export class RedisEphemeralEvents extends EphemeralEvents implements OnModuleInit, OnApplicationShutdown {
  private readonly instanceId = randomUUID();
  /** A connection of its own: a subscribed Redis connection can do nothing else. */
  private subscriber: Redis | null = null;
  /** topic → connection id → the member this instance tracks there. */
  private readonly tracked = new Map<string, Map<string, PresenceMember>>();
  /** topic → the member keys this instance last told its presence subscribers about. */
  private readonly lastKnown = new Map<string, string>();
  private heartbeat: NodeJS.Timeout | null = null;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(RealtimeHub) private readonly hub: RealtimeHub,
    @Inject(APP_LOGGER) private readonly logger: AppLogger,
  ) {
    super();
  }

  onModuleInit(): void {
    const subscriber = this.redis.duplicate();
    this.subscriber = subscriber;
    subscriber.on('error', (error) => this.logger.error({ err: error }, 'realtime: the Redis subscription failed'));
    subscriber.on('message', (_channel, text) => this.receive(text));
    // Not awaited: the API starts whether or not Redis is reachable; ioredis subscribes again after a reconnect.
    void subscriber.subscribe(CHANNEL).catch((error: unknown) => this.logger.warn({ err: error }, 'realtime: could not subscribe to Redis yet'));
    this.heartbeat = setInterval(() => void this.renewAndReconcile(), HEARTBEAT_INTERVAL_MS);
    this.heartbeat.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    // Members of a stopping instance leave at once instead of waiting for their entries to expire.
    for (const [topic, connections] of this.tracked) {
      await this.redis.hdel(presenceKey(topic), ...[...connections.keys()].map((id) => this.field(id))).catch(() => undefined);
    }
    this.subscriber?.disconnect();
  }

  broadcast(topic: string, event: string, payload: unknown, senderId: string): void {
    this.publish({ kind: 'broadcast', topic, event, payload, senderId });
  }

  async membersOf(topic: string): Promise<PresenceMember[]> {
    const stored = await this.redis.hvals(presenceKey(topic)).catch(() => null);
    // Redis is down: this instance still knows its own members.
    if (stored === null) return uniqueMembers([...(this.tracked.get(topic)?.values() ?? [])]);
    const now = Date.now();
    return uniqueMembers(stored.map(parseStored).filter((entry): entry is StoredPresence => entry !== null && entry.until > now));
  }

  async track(topic: string, connectionId: string, member: PresenceMember): Promise<void> {
    const connections = this.tracked.get(topic) ?? new Map<string, PresenceMember>();
    connections.set(connectionId, member);
    this.tracked.set(topic, connections);
    await this.store(topic, connectionId, member);
    // Told to every instance; a join of a member who is already there changes nothing for a client.
    this.publish({ kind: 'presence', topic, joins: [member], leaves: [] });
  }

  async untrack(topic: string, connectionId: string, key: string): Promise<void> {
    const connections = this.tracked.get(topic);
    const member = connections?.get(connectionId);
    if (!connections || !member) return;
    connections.delete(connectionId);
    if (connections.size === 0) this.tracked.delete(topic);
    await this.redis.hdel(presenceKey(topic), this.field(connectionId)).catch(() => undefined);
    // The member left only if no other connection of theirs, on any instance, is still there.
    const stillThere = (await this.membersOf(topic)).some((other) => other.key === key);
    if (!stillThere) this.publish({ kind: 'presence', topic, joins: [], leaves: [member] });
  }

  private field(connectionId: string): string {
    return `${this.instanceId}:${connectionId}`;
  }

  private async store(topic: string, connectionId: string, member: PresenceMember): Promise<void> {
    const entry: StoredPresence = { ...member, until: Date.now() + PRESENCE_TTL_MS };
    await this.redis
      .multi()
      .hset(presenceKey(topic), this.field(connectionId), JSON.stringify(entry))
      // The whole hash goes when nobody renewed anything on the topic for a while.
      .pexpire(presenceKey(topic), 2 * PRESENCE_TTL_MS)
      .exec()
      .catch((error: unknown) => this.logger.warn({ err: error }, 'realtime: presence could not be stored'));
  }

  /** Publishes to every instance; when Redis cannot be reached, hands the message to this instance at least. */
  private publish(message: Message): void {
    void this.redis.publish(CHANNEL, JSON.stringify(message)).catch(() => this.deliver(message));
  }

  private receive(text: string): void {
    try {
      this.deliver(JSON.parse(text) as Message);
    } catch (error) {
      this.logger.warn({ err: error }, 'realtime: an inter-instance message could not be read');
    }
  }

  private deliver(message: Message): void {
    if (message.kind === 'broadcast') {
      // The sender's connection id exists on one instance only; everywhere else nothing is excepted.
      this.hub.deliver(message.topic, 'broadcast', { op: 'event', topic: message.topic, event: message.event, payload: message.payload }, message.senderId);
      return;
    }
    this.hub.deliver(message.topic, 'presence', { op: 'presence_diff', topic: message.topic, joins: message.joins, leaves: message.leaves });
  }

  /** Renews this instance's entries, and tells its presence subscribers when the members of a topic changed without a leave. */
  private async renewAndReconcile(): Promise<void> {
    try {
      for (const [topic, connections] of this.tracked) {
        for (const [connectionId, member] of connections) await this.store(topic, connectionId, member);
      }
      for (const topic of this.hub.topicsOf('presence')) {
        const members = await this.membersOf(topic);
        const keys = members.map((member) => member.key).sort().join(',');
        // An instance that died sent no leave: its members drop out here when their entries expire.
        if (this.lastKnown.has(topic) && this.lastKnown.get(topic) !== keys) this.hub.deliver(topic, 'presence', { op: 'presence_state', topic, members });
        this.lastKnown.set(topic, keys);
      }
      for (const topic of this.lastKnown.keys()) if (!this.hub.topicsOf('presence').includes(topic)) this.lastKnown.delete(topic);
    } catch (error) {
      this.logger.warn({ err: error }, 'realtime: the presence heartbeat failed');
    }
  }
}

function parseStored(text: string): StoredPresence | null {
  try {
    const entry = JSON.parse(text) as Partial<StoredPresence>;
    return typeof entry.key === 'string' && typeof entry.until === 'number' ? { key: entry.key, meta: entry.meta ?? {}, until: entry.until } : null;
  } catch {
    return null;
  }
}

/** One entry per member key; the last one wins. */
function uniqueMembers(entries: readonly PresenceMember[]): PresenceMember[] {
  const byKey = new Map<string, PresenceMember>();
  for (const entry of entries) byKey.set(entry.key, { key: entry.key, meta: entry.meta });
  return [...byKey.values()];
}
