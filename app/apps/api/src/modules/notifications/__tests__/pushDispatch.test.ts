import { expect, it } from 'vitest';
import { backoffSeconds, runDispatch } from '../pushDispatch';
import { drainPushQueues } from '../pushDrain';
import { type ProviderMessage, type Ticket, TransportError } from '../pushTypes';
import { device, FakeDatabase, FakeTransport, KIND_ENTRIES, MESSAGE_ID, pushFor } from './pushTestKit';

// The worker run against a fake database (outbox claim semantics) and a fake transport.

const ok = (id: string): Ticket => ({ status: 'ok', id });
const failed = (error: string): Ticket => ({ status: 'error', error });
/** A database holding `count` single-device pushes of a kind. */
function seeded(count: number, kind = 'mark_recipient'): FakeDatabase {
  const db = new FakeDatabase();
  for (let i = 0; i < count; i++) db.emit(pushFor(kind, { id: `n${i}`, tokens: [device(i)] }));
  return db;
}
const toOf = (messages: readonly ProviderMessage[]) => messages.map((m) => m.to);

it('messages go out in provider-sized requests: 100 is one request, 101 are two', async () => {
  for (const [count, sizes] of [[100, [100]], [101, [100, 1]], [250, [100, 100, 50]], [1, [1]]] as const) {
    const db = seeded(count);
    const transport = new FakeTransport();
    const summary = await runDispatch({ db, transport }, { batchSize: 500 });
    expect(transport.requests.map((r) => r.length)).toEqual([...sizes]);
    expect([summary.events, summary.sent]).toEqual([count, count]);
  }
});

it('an empty queue costs no provider request and no settle call', async () => {
  const db = new FakeDatabase();
  const transport = new FakeTransport();
  const summary = await runDispatch({ db, transport });
  expect([transport.requests.length, db.outcomes.length, summary.events]).toEqual([0, 0, 0]);
});

it('at most `concurrency` requests are in flight, and the database is asked once per step', async () => {
  const db = seeded(950);
  const transport = new FakeTransport();
  await runDispatch({ db, transport }, { batchSize: 1000, concurrency: 3 });
  expect(transport.requests.length).toEqual(10);
  expect(transport.maxInFlight).toEqual(3);
  expect(db.outcomes.length, 'one settle for the whole run').toEqual(1);
  expect(db.outcomes[0]!.receipts.map((r) => r.length), 'tickets queue for a receipt check').toEqual([300, 300, 300, 50]);
});

it('kinds the database does not push are never sent', async () => {
  const db = new FakeDatabase();
  // What the database returns for sends_push = false, for quiet hours and for no device.
  for (const [kind, spec] of KIND_ENTRIES) db.emit(spec.sendsPush ? pushFor(kind, { id: kind }) : null, kind);
  db.emit(null, 'quiet-hours');
  const transport = new FakeTransport();
  const summary = await runDispatch({ db, transport }, { batchSize: 500 });
  const pushed = KIND_ENTRIES.filter(([, spec]) => spec.sendsPush).map(([kind]) => kind);
  expect(summary.events).toEqual(KIND_ENTRIES.length + 1);
  expect(new Set(transport.sent.map((m) => (m.data as { kind: string }).kind))).toEqual(new Set(pushed));
  expect(transport.sent.length, 'one message per device of each pushed kind').toEqual(pushed.length * 2);
});

it('partial provider failure: each ticket decides for its own device', async () => {
  const db = new FakeDatabase();
  db.emit(pushFor('mark_recipient', { id: 'n1', tokens: [device(1), device(2), device(3), device(4)] }));
  const transport = new FakeTransport(() => [ok('t1'), failed('DeviceNotRegistered'), failed('MessageRateExceeded'), failed('MessageTooBig')]);
  const summary = await runDispatch({ db, transport });
  expect(db.outcomes[0]).toEqual({
    forget_devices: ['device-2'],
    defer: [{ notification_id: 'n1', device_ids: ['device-3'], retry_in_seconds: 30 }],
    retry: [], done: [],
    receipts: [[{ id: 't1', device_id: 'device-1' }]],
    receipt_delay_seconds: 900,
  });
  expect([summary.sent, summary.devicesForgotten, summary.deferred, summary.failed]).toEqual([1, 1, 1, 1]);
});

it('a failed request defers its own messages only; a rejected request is not retried', async () => {
  for (const [retryable, deferred, failedCount] of [[true, 50, 0], [false, 0, 50]] as const) {
    const db = seeded(150);
    const transport = new FakeTransport((messages, request) => {
      if (request === 1) throw new TransportError('expo_http_x', retryable);
      return messages.map((_m, i) => ok(`t${request}-${i}`));
    });
    const summary = await runDispatch({ db, transport }, { batchSize: 500, concurrency: 1 });
    expect([summary.sent, summary.deferred, summary.failed]).toEqual([100, deferred, failedCount]);
    expect(db.outcomes[0]!.defer.length).toEqual(deferred);
  }
});

it('a deferred push is retried for the failed device only, with growing back-off, then given up', async () => {
  const db = new FakeDatabase();
  db.emit(pushFor('ride_booking_confirmed', { id: 'n1', tokens: [device(1), device(2)] }));
  let down = true;
  const transport = new FakeTransport((messages) => messages.map((m) => (down && m.to.includes('secret-2') ? failed('MessageRateExceeded') : ok(`t-${m.to}`))));

  await runDispatch({ db, transport }, { maxAttempts: 3 });
  expect(toOf(transport.sent)).toEqual(['ExponentPushToken[secret-1]', 'ExponentPushToken[secret-2]']);
  await runDispatch({ db, transport }, { maxAttempts: 3 });
  expect(transport.sent.length, 'not due yet: nothing is sent again').toEqual(2);

  const waits: number[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    db.now += 3600;
    await runDispatch({ db, transport }, { maxAttempts: 3 });
    const retry = db.outcomes.at(-1)!.retry[0];
    expect([retry!.device_ids, retry!.error]).toEqual([['device-2'], 'provider_unavailable']);
    waits.push(retry!.retry_in_seconds);
  }
  expect(waits, 'back-off doubles with the attempts of the event').toEqual([60, 120]);
  db.now += 3600;
  const last = await runDispatch({ db, transport }, { maxAttempts: 3 });
  expect([last.gaveUp, db.outcomes.at(-1)!.done.length], 'after the last attempt the event is confirmed').toEqual([1, 1]);
  expect(toOf(transport.sent).filter((to) => to.includes('secret-1')).length, 'the device that got it is never sent to again').toEqual(1);

  // A retry that succeeds confirms its event and queues the receipt check.
  const db2 = new FakeDatabase();
  db2.emit(pushFor('ride_booking_confirmed', { id: 'n2', tokens: [device(2)] }));
  await runDispatch({ db: db2, transport });
  down = false;
  db2.now += 60;
  const recovered = await runDispatch({ db: db2, transport });
  expect([recovered.retries, recovered.sent, db2.outcomes.at(-1)!.done.length, db2.outcomes.at(-1)!.receipts.length]).toEqual([1, 1, 1, 1]);
  expect(backoffSeconds(0)).toEqual(30);
  expect(backoffSeconds(20), 'capped at an hour').toEqual(3600);
});

it('a retry whose device is gone meanwhile is dropped by the database', async () => {
  const db = new FakeDatabase();
  db.emit(pushFor('mark_recipient', { id: 'n1', tokens: [device(1)] }));
  const transport = new FakeTransport(() => [failed('MessageRateExceeded')]);
  await runDispatch({ db, transport });
  db.forgotten.add('device-1');
  db.now += 60;
  const summary = await runDispatch({ db, transport });
  expect([summary.retries, transport.sent.length]).toEqual([1, 1]);
});

it('two runs at the same time never send the same push twice', async () => {
  const db = seeded(240);
  const transport = new FakeTransport();
  const summaries = await Promise.all([
    runDispatch({ db, transport }, { batchSize: 100 }), runDispatch({ db, transport }, { batchSize: 100 }),
    runDispatch({ db, transport }, { batchSize: 100 }),
  ]);
  const recipients = toOf(transport.sent);
  expect(recipients.length).toEqual(240);
  expect(new Set(recipients).size, 'every device got its push exactly once').toEqual(240);
  expect(summaries.reduce((sum, s) => sum + s.events, 0)).toEqual(240);
  expect(summaries.every((s) => s.events <= 100), 'each run holds its own claim').toBe(true);
});

it('chat previews are read once per run, by message id, at send time', async () => {
  const db = new FakeDatabase();
  db.previews.set(MESSAGE_ID, 'on my way');
  db.emit(pushFor('chat_message', { id: 'c1' }));
  db.emit(pushFor('chat_message', { id: 'c2' }));
  db.emit(pushFor('support_message', { id: 'c3', args: { message_id: 'other' } }));
  db.emit(pushFor('mark_recipient', { id: 'm1' }));
  const transport = new FakeTransport();
  await runDispatch({ db, transport });
  expect(db.previewCalls, 'one query, distinct ids').toEqual([[MESSAGE_ID, 'other']]);
  const bodies = transport.sent.map((m) => m.body);
  expect(bodies.filter((b) => b === 'on my way').length).toEqual(4);
  expect(JSON.stringify(db.outcomes).includes('on my way'), 'message text never goes back to the database').toBe(false);

  const quiet = seeded(3);
  await runDispatch({ db: quiet, transport: new FakeTransport() });
  expect(quiet.previewCalls, 'no chat kind, no preview query').toEqual([]);
});

it('a push of a kind this build does not know is dropped, not retried, and stops nothing', async () => {
  const db = new FakeDatabase();
  db.emit(pushFor('kind_from_the_future', { id: 'x' }));
  db.emit(pushFor('mark_recipient', { id: 'm' }));
  const transport = new FakeTransport();
  const summary = await runDispatch({ db, transport });
  expect([summary.unsendable, summary.sent, db.outcomes[0]!.defer.length]).toEqual([1, 2, 0]);
});

it('receipts: dead devices are forgotten; an unavailable provider is retried, then given up', async () => {
  const db = seeded(2);
  const transport = new FakeTransport((messages) => messages.map((m) => ok(`t-${m.to}`)));
  await runDispatch({ db, transport });
  expect(transport.receiptRequests, 'receipts are not asked for before they are due').toEqual([]);
  db.now += 900;
  transport.receiptsFail = true;
  await runDispatch({ db, transport });
  expect(db.outcomes.at(-1)!.retry).toEqual([{ event_id: db.receiptEvents[0]!.id, error: 'receipts_unavailable', retry_in_seconds: 60 }]);
  transport.receiptsFail = false;
  transport.receipts = { 't-ExponentPushToken[secret-0]': ok('r'), 't-ExponentPushToken[secret-1]': failed('DeviceNotRegistered') };
  db.now += 60;
  const summary = await runDispatch({ db, transport });
  expect([summary.receiptsChecked, db.outcomes.at(-1)!.forget_devices, db.outcomes.at(-1)!.done]).toEqual([2, ['device-1'], [db.receiptEvents[0]!.id]]);

  const stuck = seeded(1);
  const dead = new FakeTransport();
  await runDispatch({ db: stuck, transport: dead });
  dead.receiptsFail = true;
  for (let i = 0; i < 2; i++) {
    stuck.now += 7200;
    await runDispatch({ db: stuck, transport: dead }, { maxAttempts: 2 });
  }
  expect(stuck.receiptEvents[0]!.processed, 'a receipt check is not retried for ever').toBe(true);
});

it('receipts are asked for in provider-sized requests', async () => {
  const db = new FakeDatabase();
  const tickets = Array.from({ length: 2300 }, (_x, i) => ({ id: `t${i}`, device_id: `d${i}` }));
  await db.settle({ forget_devices: [], defer: [], retry: [], done: [], receipts: [tickets], receipt_delay_seconds: 0 });
  const transport = new FakeTransport();
  await runDispatch({ db, transport });
  expect(transport.receiptRequests.map((r) => r.length)).toEqual([1000, 1000, 300]);
});

it('a job run drains the queue round by round and reports counts only', async () => {
  const db = seeded(250);
  const transport = new FakeTransport();

  const summary = await drainPushQueues({ db, transport, options: { batchSize: 100 } });

  // Three rounds deliver the 250 events; the fourth finds the queues empty and ends the run.
  expect([summary.rounds, summary.events, summary.sent]).toEqual([4, 250, 250]);
  expect(Object.values(summary).every((value) => typeof value === 'number'), 'counts only').toBe(true);
  const report = JSON.stringify(summary);
  expect(report.includes('ExponentPushToken') || report.includes('Dana'), 'no token and no name in the report').toBe(false);
  expect(report.includes(transport.sent[0]!.body), 'no rendered text').toBe(false);
});

it('a job run is bounded by rounds and by time; the next run continues', async () => {
  const capped = await drainPushQueues({ db: seeded(500), transport: new FakeTransport(), options: { batchSize: 100 }, maxRounds: 2 });
  // A clock that jumps 15 seconds per reading: the budget of 20 seconds allows one round.
  let clock = 0;
  const timed = await drainPushQueues({ db: seeded(500), transport: new FakeTransport(), options: { batchSize: 100 }, now: () => (clock += 15_000) });

  expect([capped.rounds, capped.sent]).toEqual([2, 200]);
  expect([timed.rounds, timed.sent]).toEqual([1, 100]);
});
