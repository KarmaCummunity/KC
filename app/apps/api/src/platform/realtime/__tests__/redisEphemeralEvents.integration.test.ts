import type { ServerFrame } from '@kc/infrastructure-api';
import { Redis } from 'ioredis';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import type { AppLogger } from '../../logging/appLogger';
import { RealtimeHub } from '../realtimeHub';
import { PRESENCE_TTL_MS, RedisEphemeralEvents } from '../redisEphemeralEvents';

const silent = { error: () => undefined, warn: () => undefined } as unknown as AppLogger;
const ALICE = { key: 'alice', meta: { device: 'phone' } };
const BOB = { key: 'bob', meta: {} };

/** Resolves when `check` holds, polling briefly: messages cross Redis asynchronously. */
async function eventually(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * Two API instances sharing one Redis (ADR-011 section 4): what a member on
 * one instance sends or shows must reach members connected to the other.
 */
const { REDIS_URL } = process.env;

describe('RedisEphemeralEvents across two instances', () => {
  const clients: Redis[] = [];
  const instances: RedisEphemeralEvents[] = [];
  /** A topic of its own per test, so tests do not see each other's presence. */
  let topicSequence = 0;
  const newTopic = () => `test:${process.pid}:${(topicSequence += 1)}:presence`;

  /** One instance: its hub, its events layer, and a subscriber that records what it is sent. */
  function instance() {
    const redis = new Redis(REDIS_URL as string, { maxRetriesPerRequest: 1 });
    const hub = new RealtimeHub();
    const events = new RedisEphemeralEvents(redis, hub, silent);
    events.onModuleInit();
    clients.push(redis);
    instances.push(events);
    const listen = (id: string, topic: string, extension: 'broadcast' | 'presence') => {
      const frames: ServerFrame[] = [];
      hub.subscribe({ id, send: (frame) => frames.push(frame) }, topic, extension);
      return frames;
    };
    return { events, listen };
  }

  afterEach(async () => {
    for (const events of instances.splice(0)) await events.onApplicationShutdown();
    for (const redis of clients.splice(0)) redis.disconnect();
  });

  afterAll(async () => {
    const redis = new Redis(REDIS_URL as string);
    const keys = await redis.keys(`kc:realtime:presence:test:${process.pid}:*`);
    if (keys.length > 0) await redis.del(...keys);
    redis.disconnect();
  });

  it('carries a typing event to subscribers on both instances, except the connection that sent it', async () => {
    const first = instance();
    const second = instance();
    const topic = 'chat:c1:typing';
    const sender = first.listen('sender', topic, 'broadcast');
    const sameInstance = first.listen('same-instance', topic, 'broadcast');
    const otherInstance = second.listen('other-instance', topic, 'broadcast');
    // Give both instances' subscriptions time to reach Redis.
    await new Promise((resolve) => setTimeout(resolve, 100));

    first.events.broadcast(topic, 'typing', { userId: 'alice' }, 'sender');
    await eventually(() => sameInstance.length === 1 && otherInstance.length === 1);

    const expected = { op: 'event', topic, event: 'typing', payload: { userId: 'alice' } };
    expect([sameInstance, otherInstance]).toEqual([[expected], [expected]]);
    expect(sender).toEqual([]);
  });

  it('shows a member tracked on one instance to a member who joins on the other, with joins and leaves', async () => {
    const first = instance();
    const second = instance();
    const topic = newTopic();
    const watcher = second.listen('watcher', topic, 'presence');
    await new Promise((resolve) => setTimeout(resolve, 100));

    await first.events.track(topic, 'conn-a', ALICE);
    const membersSeenElsewhere = await second.events.membersOf(topic);
    await second.events.track(topic, 'conn-b', BOB);
    await first.events.untrack(topic, 'conn-a', ALICE.key);
    await eventually(() => watcher.length === 3);

    expect(membersSeenElsewhere).toEqual([ALICE]);
    expect(watcher).toEqual([
      { op: 'presence_diff', topic, joins: [ALICE], leaves: [] },
      { op: 'presence_diff', topic, joins: [BOB], leaves: [] },
      { op: 'presence_diff', topic, joins: [], leaves: [ALICE] },
    ]);
    expect(await first.events.membersOf(topic)).toEqual([BOB]);
  });

  it('keeps a member present while one of their devices, on any instance, is still there', async () => {
    const first = instance();
    const second = instance();
    const topic = newTopic();
    const watcher = first.listen('watcher', topic, 'presence');
    await new Promise((resolve) => setTimeout(resolve, 100));
    await first.events.track(topic, 'phone', ALICE);
    await second.events.track(topic, 'laptop', ALICE);
    await eventually(() => watcher.length === 2);
    watcher.length = 0;

    await first.events.untrack(topic, 'phone', ALICE.key);
    const afterFirstDevice = await second.events.membersOf(topic);
    await second.events.untrack(topic, 'laptop', ALICE.key);
    await eventually(() => watcher.length === 1);

    expect(afterFirstDevice.map((member) => member.key)).toEqual(['alice']);
    // One leave, with the last device.
    expect(watcher).toEqual([{ op: 'presence_diff', topic, joins: [], leaves: [ALICE] }]);
  });

  it('does not list an entry whose instance stopped renewing it', async () => {
    const first = instance();
    const topic = newTopic();
    const redis = new Redis(REDIS_URL as string);
    clients.push(redis);
    await first.events.track(topic, 'conn-a', ALICE);

    // What a dead instance leaves behind: an entry nobody renews.
    await redis.hset(`kc:realtime:presence:${topic}`, 'dead-instance:conn-x', JSON.stringify({ ...BOB, until: Date.now() - 1 }));
    await redis.hset(`kc:realtime:presence:${topic}`, 'garbage', 'not json');

    expect(await first.events.membersOf(topic)).toEqual([ALICE]);
    expect(PRESENCE_TTL_MS).toBeGreaterThan(30_000);
  });

  it('removes its members from the topic when the instance shuts down', async () => {
    const first = instance();
    const second = instance();
    const topic = newTopic();
    await first.events.track(topic, 'conn-a', ALICE);

    await first.events.onApplicationShutdown();

    expect(await second.events.membersOf(topic)).toEqual([]);
  });
});
