import { expect, it } from 'vitest';
import { createExpoTransport } from '../expoTransport';
import type { ProviderMessage, TransportError } from '../pushTypes';
import { createSqlPushDatabase, WORKER_SQL } from '../sqlPushDatabase';

// The two adapters behind the worker's ports: the Expo push service and Postgres.

it('Expo transport: wire format, ticket mapping and error classes', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  let reply: () => Response = () => Response.json({ data: [{ status: 'ok', id: 'a' }, { status: 'error', details: { error: 'DeviceNotRegistered' } }] });
  const transport = createExpoTransport('expo-token', (url, init) => {
    calls.push({ url, init });
    return Promise.resolve(reply());
  });
  const messages = buildTwo();
  expect(await transport.send(messages)).toEqual([{ status: 'ok', id: 'a' }, { status: 'error', error: 'DeviceNotRegistered' }]);
  expect(calls[0]!.url).toEqual('https://exp.host/--/api/v2/push/send');
  expect((calls[0]!.init.headers as Record<string, string>).Authorization).toEqual('Bearer expo-token');
  const wire = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>[];
  expect(wire.length).toEqual(2);
  expect('platform' in wire[0]!, 'the internal platform marker is not sent').toBe(false);
  expect([wire[0]!.channelId, wire[1]!.interruptionLevel]).toEqual(['critical', 'time-sensitive']);

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
    expect([error.retryable, error.message], 'the response body never reaches the error').toEqual([retryable, `expo_http_${status}`]);
  }
  reply = () => Response.json({ data: [{ status: 'ok', id: 'a' }] });
  expect((await failure()).message).toEqual('expo_ticket_mismatch');
  reply = () => new Response('not json');
  expect((await failure()).retryable).toEqual(true);
  const offline = createExpoTransport(undefined, () => Promise.reject(new Error('dns')));
  expect(await offline.send(messages).catch((e: TransportError) => [e.message, e.retryable])).toEqual(['expo_unreachable', true]);

  reply = () => Response.json({ data: { a: { status: 'ok' }, b: { status: 'error', details: { error: 'DeviceNotRegistered' } } } });
  expect(await transport.getReceipts(['a', 'b', 'c'])).toEqual({ a: { status: 'ok', id: undefined }, b: { status: 'error', error: 'DeviceNotRegistered' } });
  expect(JSON.parse(String(calls.at(-1)!.init.body))).toEqual({ ids: ['a', 'b', 'c'] });
});

function buildTwo(): ProviderMessage[] {
  return [
    { platform: 'android', to: 'ExponentPushToken[secret-1]', title: 't', body: 'b', data: {}, priority: 'high', channelId: 'critical' },
    { platform: 'ios', to: 'ExponentPushToken[secret-2]', title: 't', body: 'b', data: {}, priority: 'high', badge: 1, interruptionLevel: 'time-sensitive', threadId: 'x', categoryId: 'critical' },
  ];
}

it('Postgres adapter: one statement per method, each a single worker function', async () => {
  const calls: [string, unknown[]][] = [];
  const rows: Record<string, Record<string, unknown>[]> = {
    [WORKER_SQL.deliverBatch]: [{ result: { event_id: 1, status: 'delivered' } }],
    [WORKER_SQL.retryBatch]: [{ result: { event_id: 2, status: 'skipped' } }],
    [WORKER_SQL.claimReceipts]: [{ id: '9', attempts: 2, payload: { tickets: [{ id: 't', device_id: 'd' }] } }, { id: '10', attempts: 1, payload: {} }],
    [WORKER_SQL.messagePreviews]: [{ message_id: 'm1', preview: 'hi' }, { message_id: 'm2', preview: null }],
    [WORKER_SQL.settle]: [],
  };
  const db = createSqlPushDatabase((sql, params) => {
    calls.push([sql, params]);
    return Promise.resolve(rows[sql] ?? []);
  });
  expect(await db.deliverBatch(50)).toEqual([{ event_id: 1, status: 'delivered' }]);
  expect(await db.retryBatch(50)).toEqual([{ event_id: 2, status: 'skipped' }]);
  expect(await db.claimReceipts(5)).toEqual([
    { event_id: 9, attempts: 2, tickets: [{ id: 't', device_id: 'd' }] }, { event_id: 10, attempts: 1, tickets: [] },
  ]);
  expect([...(await db.messagePreviews(['m1', 'm2']))]).toEqual([['m1', 'hi'], ['m2', null]]);
  await db.settle({ forget_devices: ['d'], defer: [], retry: [], done: [1], receipts: [], receipt_delay_seconds: 900 });
  expect(calls.length).toEqual(5);
  expect(JSON.parse(String(calls[4]![1][0])).forget_devices).toEqual(['d']);
  for (const sql of Object.values(WORKER_SQL)) expect(sql.match(/kc_private\.\w+/g)?.length, sql).toEqual(1);
});
