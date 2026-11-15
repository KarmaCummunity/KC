// The two adapters behind the worker's ports: the Expo push service and Postgres.
import { assertEquals, assertFalse } from 'jsr:@std/assert@1';
import { createExpoTransport } from './expoTransport.ts';
import { createPostgresDatabase, WORKER_SQL } from './postgresDatabase.ts';
import type { ProviderMessage, TransportError } from './types.ts';

Deno.test('Expo transport: wire format, ticket mapping and error classes', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  let reply: () => Response = () => Response.json({ data: [{ status: 'ok', id: 'a' }, { status: 'error', details: { error: 'DeviceNotRegistered' } }] });
  const transport = createExpoTransport('expo-token', (url, init) => {
    calls.push({ url, init });
    return Promise.resolve(reply());
  });
  const messages = buildTwo();
  assertEquals(await transport.send(messages), [{ status: 'ok', id: 'a' }, { status: 'error', error: 'DeviceNotRegistered' }]);
  assertEquals(calls[0].url, 'https://exp.host/--/api/v2/push/send');
  assertEquals((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer expo-token');
  const wire = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>[];
  assertEquals(wire.length, 2);
  assertFalse('platform' in wire[0], 'the internal platform marker is not sent');
  assertEquals([wire[0].channelId, wire[1].interruptionLevel], ['critical', 'time-sensitive']);

  const failure = async () => {
    try {
      await transport.send(messages);
    } catch (error) {
      return error as TransportError;
    }
    throw new Error('expected a failure');
  };
  for (const [status, retryable] of [[429, true], [503, true], [400, false], [401, false]] as const) {
    reply = () => new Response('ExponentPushToken[secret-1] rejected', { status });
    const error = await failure();
    assertEquals([error.retryable, error.message], [retryable, `expo_http_${status}`], 'the response body never reaches the error');
  }
  reply = () => Response.json({ data: [{ status: 'ok', id: 'a' }] });
  assertEquals((await failure()).message, 'expo_ticket_mismatch');
  reply = () => new Response('not json');
  assertEquals((await failure()).retryable, true);
  const offline = createExpoTransport(undefined, () => Promise.reject(new Error('dns')));
  assertEquals(await offline.send(messages).catch((e: TransportError) => [e.message, e.retryable]), ['expo_unreachable', true]);

  reply = () => Response.json({ data: { a: { status: 'ok' }, b: { status: 'error', details: { error: 'DeviceNotRegistered' } } } });
  assertEquals(await transport.getReceipts(['a', 'b', 'c']), { a: { status: 'ok', id: undefined }, b: { status: 'error', error: 'DeviceNotRegistered' } });
  assertEquals(JSON.parse(String(calls.at(-1)!.init.body)), { ids: ['a', 'b', 'c'] });
});

function buildTwo(): ProviderMessage[] {
  return [
    { platform: 'android', to: 'ExponentPushToken[secret-1]', title: 't', body: 'b', data: {}, priority: 'high', channelId: 'critical' },
    { platform: 'ios', to: 'ExponentPushToken[secret-2]', title: 't', body: 'b', data: {}, priority: 'high', badge: 1, interruptionLevel: 'time-sensitive', threadId: 'x', categoryId: 'critical' },
  ];
}

Deno.test('Postgres adapter: one statement per method, each a single worker function', async () => {
  const calls: [string, unknown[]][] = [];
  const rows: Record<string, Record<string, unknown>[]> = {
    [WORKER_SQL.deliverBatch]: [{ result: { event_id: 1, status: 'delivered' } }],
    [WORKER_SQL.retryBatch]: [{ result: { event_id: 2, status: 'skipped' } }],
    [WORKER_SQL.claimReceipts]: [{ id: '9', attempts: 2, payload: { tickets: [{ id: 't', device_id: 'd' }] } }, { id: '10', attempts: 1, payload: {} }],
    [WORKER_SQL.messagePreviews]: [{ message_id: 'm1', preview: 'hi' }, { message_id: 'm2', preview: null }],
    [WORKER_SQL.settle]: [],
  };
  const db = createPostgresDatabase((sql, params) => {
    calls.push([sql, params]);
    return Promise.resolve(rows[sql]);
  });
  assertEquals(await db.deliverBatch(50), [{ event_id: 1, status: 'delivered' }]);
  assertEquals(await db.retryBatch(50), [{ event_id: 2, status: 'skipped' }]);
  assertEquals(await db.claimReceipts(5), [
    { event_id: 9, attempts: 2, tickets: [{ id: 't', device_id: 'd' }] }, { event_id: 10, attempts: 1, tickets: [] },
  ]);
  assertEquals([...(await db.messagePreviews(['m1', 'm2']))], [['m1', 'hi'], ['m2', null]]);
  await db.settle({ forget_devices: ['d'], defer: [], retry: [], done: [1], receipts: [], receipt_delay_seconds: 900 });
  assertEquals(calls.length, 5);
  assertEquals(JSON.parse(String(calls[4][1][0])).forget_devices, ['d']);
  for (const sql of Object.values(WORKER_SQL)) assertEquals(sql.match(/kc_private\.\w+/g)?.length, 1, sql);
});
