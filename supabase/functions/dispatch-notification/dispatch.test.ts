// The worker run against a fake database (outbox claim semantics) and a fake transport.
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1';
import { backoffSeconds, runDispatch } from './dispatch.ts';
import { createDispatchHandler } from './handler.ts';
import { device, FakeDatabase, FakeTransport, KIND_ENTRIES, MESSAGE_ID, pushFor } from './testKit.ts';
import { type ProviderMessage, type Ticket, TransportError } from './types.ts';

const ok = (id: string): Ticket => ({ status: 'ok', id });
const failed = (error: string): Ticket => ({ status: 'error', error });
/** A database holding `count` single-device pushes of a kind. */
function seeded(count: number, kind = 'mark_recipient'): FakeDatabase {
  const db = new FakeDatabase();
  for (let i = 0; i < count; i++) db.emit(pushFor(kind, { id: `n${i}`, tokens: [device(i)] }));
  return db;
}
const toOf = (messages: readonly ProviderMessage[]) => messages.map((m) => m.to);

Deno.test('messages go out in provider-sized requests: 100 is one request, 101 are two', async () => {
  for (const [count, sizes] of [[100, [100]], [101, [100, 1]], [250, [100, 100, 50]], [1, [1]]] as const) {
    const db = seeded(count);
    const transport = new FakeTransport();
    const summary = await runDispatch({ db, transport }, { batchSize: 500 });
    assertEquals(transport.requests.map((r) => r.length), [...sizes]);
    assertEquals([summary.events, summary.sent], [count, count]);
  }
});

Deno.test('an empty queue costs no provider request and no settle call', async () => {
  const db = new FakeDatabase();
  const transport = new FakeTransport();
  const summary = await runDispatch({ db, transport });
  assertEquals([transport.requests.length, db.outcomes.length, summary.events], [0, 0, 0]);
});

Deno.test('at most `concurrency` requests are in flight, and the database is asked once per step', async () => {
  const db = seeded(950);
  const transport = new FakeTransport();
  await runDispatch({ db, transport }, { batchSize: 1000, concurrency: 3 });
  assertEquals(transport.requests.length, 10);
  assertEquals(transport.maxInFlight, 3);
  assertEquals(db.outcomes.length, 1, 'one settle for the whole run');
  assertEquals(db.outcomes[0].receipts.map((r) => r.length), [300, 300, 300, 50], 'tickets queue for a receipt check');
});

Deno.test('kinds the database does not push are never sent', async () => {
  const db = new FakeDatabase();
  // What the database returns for sends_push = false, for quiet hours and for no device.
  for (const [kind, spec] of KIND_ENTRIES) db.emit(spec.sendsPush ? pushFor(kind, { id: kind }) : null, kind);
  db.emit(null, 'quiet-hours');
  const transport = new FakeTransport();
  const summary = await runDispatch({ db, transport }, { batchSize: 500 });
  const pushed = KIND_ENTRIES.filter(([, spec]) => spec.sendsPush).map(([kind]) => kind);
  assertEquals(summary.events, KIND_ENTRIES.length + 1);
  assertEquals(new Set(transport.sent.map((m) => (m.data as { kind: string }).kind)), new Set(pushed));
  assertEquals(transport.sent.length, pushed.length * 2, 'one message per device of each pushed kind');
});

Deno.test('partial provider failure: each ticket decides for its own device', async () => {
  const db = new FakeDatabase();
  db.emit(pushFor('mark_recipient', { id: 'n1', tokens: [device(1), device(2), device(3), device(4)] }));
  const transport = new FakeTransport(() => [ok('t1'), failed('DeviceNotRegistered'), failed('MessageRateExceeded'), failed('MessageTooBig')]);
  const summary = await runDispatch({ db, transport });
  assertEquals(db.outcomes[0], {
    forget_devices: ['device-2'],
    defer: [{ notification_id: 'n1', device_ids: ['device-3'], retry_in_seconds: 30 }],
    retry: [], done: [],
    receipts: [[{ id: 't1', device_id: 'device-1' }]],
    receipt_delay_seconds: 900,
  });
  assertEquals([summary.sent, summary.devicesForgotten, summary.deferred, summary.failed], [1, 1, 1, 1]);
});

Deno.test('a failed request defers its own messages only; a rejected request is not retried', async () => {
  for (const [retryable, deferred, failedCount] of [[true, 50, 0], [false, 0, 50]] as const) {
    const db = seeded(150);
    const transport = new FakeTransport((messages, request) => {
      if (request === 1) throw new TransportError('expo_http_x', retryable);
      return messages.map((_m, i) => ok(`t${request}-${i}`));
    });
    const summary = await runDispatch({ db, transport }, { batchSize: 500, concurrency: 1 });
    assertEquals([summary.sent, summary.deferred, summary.failed], [100, deferred, failedCount]);
    assertEquals(db.outcomes[0].defer.length, deferred);
  }
});

Deno.test('a deferred push is retried for the failed device only, with growing back-off, then given up', async () => {
  const db = new FakeDatabase();
  db.emit(pushFor('ride_booking_confirmed', { id: 'n1', tokens: [device(1), device(2)] }));
  let down = true;
  const transport = new FakeTransport((messages) => messages.map((m) => (down && m.to.includes('secret-2') ? failed('MessageRateExceeded') : ok(`t-${m.to}`))));

  await runDispatch({ db, transport }, { maxAttempts: 3 });
  assertEquals(toOf(transport.sent), ['ExponentPushToken[secret-1]', 'ExponentPushToken[secret-2]']);
  await runDispatch({ db, transport }, { maxAttempts: 3 });
  assertEquals(transport.sent.length, 2, 'not due yet: nothing is sent again');

  const waits: number[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    db.now += 3600;
    await runDispatch({ db, transport }, { maxAttempts: 3 });
    const retry = db.outcomes.at(-1)!.retry[0];
    assertEquals([retry.device_ids, retry.error], [['device-2'], 'provider_unavailable']);
    waits.push(retry.retry_in_seconds);
  }
  assertEquals(waits, [60, 120], 'back-off doubles with the attempts of the event');
  db.now += 3600;
  const last = await runDispatch({ db, transport }, { maxAttempts: 3 });
  assertEquals([last.gaveUp, db.outcomes.at(-1)!.done.length], [1, 1], 'after the last attempt the event is confirmed');
  assertEquals(toOf(transport.sent).filter((to) => to.includes('secret-1')).length, 1, 'the device that got it is never sent to again');

  // A retry that succeeds confirms its event and queues the receipt check.
  const db2 = new FakeDatabase();
  db2.emit(pushFor('ride_booking_confirmed', { id: 'n2', tokens: [device(2)] }));
  await runDispatch({ db: db2, transport });
  down = false;
  db2.now += 60;
  const recovered = await runDispatch({ db: db2, transport });
  assertEquals([recovered.retries, recovered.sent, db2.outcomes.at(-1)!.done.length, db2.outcomes.at(-1)!.receipts.length], [1, 1, 1, 1]);
  assertEquals(backoffSeconds(0), 30);
  assertEquals(backoffSeconds(20), 3600, 'capped at an hour');
});

Deno.test('a retry whose device is gone meanwhile is dropped by the database', async () => {
  const db = new FakeDatabase();
  db.emit(pushFor('mark_recipient', { id: 'n1', tokens: [device(1)] }));
  const transport = new FakeTransport(() => [failed('MessageRateExceeded')]);
  await runDispatch({ db, transport });
  db.forgotten.add('device-1');
  db.now += 60;
  const summary = await runDispatch({ db, transport });
  assertEquals([summary.retries, transport.sent.length], [1, 1]);
});

Deno.test('two runs at the same time never send the same push twice', async () => {
  const db = seeded(240);
  const transport = new FakeTransport();
  const summaries = await Promise.all([
    runDispatch({ db, transport }, { batchSize: 100 }), runDispatch({ db, transport }, { batchSize: 100 }),
    runDispatch({ db, transport }, { batchSize: 100 }),
  ]);
  const recipients = toOf(transport.sent);
  assertEquals(recipients.length, 240);
  assertEquals(new Set(recipients).size, 240, 'every device got its push exactly once');
  assertEquals(summaries.reduce((sum, s) => sum + s.events, 0), 240);
  assert(summaries.every((s) => s.events <= 100), 'each run holds its own claim');
});

Deno.test('chat previews are read once per run, by message id, at send time', async () => {
  const db = new FakeDatabase();
  db.previews.set(MESSAGE_ID, 'on my way');
  db.emit(pushFor('chat_message', { id: 'c1' }));
  db.emit(pushFor('chat_message', { id: 'c2' }));
  db.emit(pushFor('support_message', { id: 'c3', args: { message_id: 'other' } }));
  db.emit(pushFor('mark_recipient', { id: 'm1' }));
  const transport = new FakeTransport();
  await runDispatch({ db, transport });
  assertEquals(db.previewCalls, [[MESSAGE_ID, 'other']], 'one query, distinct ids');
  const bodies = transport.sent.map((m) => m.body);
  assertEquals(bodies.filter((b) => b === 'on my way').length, 4);
  assertFalse(JSON.stringify(db.outcomes).includes('on my way'), 'message text never goes back to the database');

  const quiet = seeded(3);
  await runDispatch({ db: quiet, transport: new FakeTransport() });
  assertEquals(quiet.previewCalls, [], 'no chat kind, no preview query');
});

Deno.test('a push of a kind this build does not know is dropped, not retried, and stops nothing', async () => {
  const db = new FakeDatabase();
  db.emit(pushFor('kind_from_the_future', { id: 'x' }));
  db.emit(pushFor('mark_recipient', { id: 'm' }));
  const transport = new FakeTransport();
  const summary = await runDispatch({ db, transport });
  assertEquals([summary.unsendable, summary.sent, db.outcomes[0].defer.length], [1, 2, 0]);
});

Deno.test('receipts: dead devices are forgotten; an unavailable provider is retried, then given up', async () => {
  const db = seeded(2);
  const transport = new FakeTransport((messages) => messages.map((m) => ok(`t-${m.to}`)));
  await runDispatch({ db, transport });
  assertEquals(transport.receiptRequests, [], 'receipts are not asked for before they are due');
  db.now += 900;
  transport.receiptsFail = true;
  await runDispatch({ db, transport });
  assertEquals(db.outcomes.at(-1)!.retry, [{ event_id: db.receiptEvents[0].id, error: 'receipts_unavailable', retry_in_seconds: 60 }]);
  transport.receiptsFail = false;
  transport.receipts = { 't-ExponentPushToken[secret-0]': ok('r'), 't-ExponentPushToken[secret-1]': failed('DeviceNotRegistered') };
  db.now += 60;
  const summary = await runDispatch({ db, transport });
  assertEquals([summary.receiptsChecked, db.outcomes.at(-1)!.forget_devices, db.outcomes.at(-1)!.done], [2, ['device-1'], [db.receiptEvents[0].id]]);

  const stuck = seeded(1);
  const dead = new FakeTransport();
  await runDispatch({ db: stuck, transport: dead });
  dead.receiptsFail = true;
  for (let i = 0; i < 2; i++) {
    stuck.now += 7200;
    await runDispatch({ db: stuck, transport: dead }, { maxAttempts: 2 });
  }
  assert(stuck.receiptEvents[0].processed, 'a receipt check is not retried for ever');
});

Deno.test('receipts are asked for in provider-sized requests', async () => {
  const db = new FakeDatabase();
  const tickets = Array.from({ length: 2300 }, (_x, i) => ({ id: `t${i}`, device_id: `d${i}` }));
  await db.settle({ forget_devices: [], defer: [], retry: [], done: [], receipts: [tickets], receipt_delay_seconds: 0 });
  const transport = new FakeTransport();
  await runDispatch({ db, transport });
  assertEquals(transport.receiptRequests.map((r) => r.length), [1000, 1000, 300]);
});

Deno.test('the handler takes the service role only, drains the queue and reports counts', async () => {
  const db = seeded(250);
  const transport = new FakeTransport();
  const logged: string[] = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = (...args: unknown[]) => void logged.push(args.map(String).join(' '));
  try {
    const handler = createDispatchHandler({ db, transport, serviceRoleKey: 'service-key', options: { batchSize: 100 } });
    assertEquals((await handler(new Request('http://x', { method: 'POST' }))).status, 401);
    assertEquals((await handler(new Request('http://x', { headers: { Authorization: 'Bearer wrong' } }))).status, 401);
    assertEquals(transport.requests.length, 0);
    const response = await handler(new Request('http://x', { method: 'POST', headers: { Authorization: 'Bearer service-key' } }));
    const body = await response.text();
    const summary = JSON.parse(body);
    assertEquals([response.status, summary.rounds, summary.events, summary.sent], [200, 4, 250, 250]);
    assert(Object.values(summary).every((v) => typeof v === 'number'), 'counts only');
    for (const text of [body, ...logged]) {
      assertFalse(text.includes('ExponentPushToken') || text.includes('Dana'), 'no token and no text in the response or the logs');
      assertFalse(text.includes(transport.sent[0].body), 'no rendered text');
    }
  } finally {
    Object.assign(console, original);
  }
  const bounded = createDispatchHandler({ db: seeded(500), transport: new FakeTransport(), serviceRoleKey: 'k', options: { batchSize: 100 }, maxRounds: 2 });
  const capped = await (await bounded(new Request('http://x', { headers: { Authorization: 'Bearer k' } }))).json();
  assertEquals([capped.rounds, capped.sent], [2, 200], 'a run is bounded; the next call continues');
});
