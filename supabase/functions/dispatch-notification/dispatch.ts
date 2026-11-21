// dispatch-notification — one run of the worker, against the two ports.
//
//   1. receipts due: ask the provider, forget devices it reports as gone
//   2. deliver a batch of `notification` events (the database writes the inbox rows and
//      confirms the events) and claim the push retries that are due
//   3. read the chat previews of the whole run in one query
//   4. send every message in provider-sized requests, a few at a time
//   5. settle everything in one call: dead devices, retries with back-off, receipt checks
//
// Two runs at the same time never send the same push: an event is handed to one worker by
// the claim (SKIP LOCKED) and a first attempt is confirmed in the claiming transaction.
// Nothing here logs a token, a title or a body; the summary holds counts only.
import { buildMessages, type BuiltMessage, PayloadError, previewMessageId } from './messages.ts';
import {
  MAX_MESSAGES_PER_REQUEST, MAX_RECEIPTS_PER_REQUEST, type Outcome, type Push, type PushDatabase,
  type PushTransport, type Ticket, type TicketRef, TransportError,
} from './types.ts';

export interface DispatchOptions {
  /** Events per claim. */
  readonly batchSize: number;
  /** Provider requests in flight at once. */
  readonly concurrency: number;
  /** Claims of a retry event before it is given up. */
  readonly maxAttempts: number;
  readonly receiptDelaySeconds: number;
  /** Tickets per receipt event. */
  readonly receiptChunk: number;
}

export const DEFAULT_OPTIONS: DispatchOptions = {
  batchSize: 100, concurrency: 4, maxAttempts: 5, receiptDelaySeconds: 900, receiptChunk: 300,
};

export interface DispatchSummary {
  events: number;
  retries: number;
  sent: number;
  deferred: number;
  failed: number;
  gaveUp: number;
  devicesForgotten: number;
  unsendable: number;
  receiptsChecked: number;
}

/** Provider codes that mean "this device is gone": the row is deleted. */
const DEAD_DEVICE = new Set(['DeviceNotRegistered']);
/** Provider codes worth another attempt later. */
const TRANSIENT = new Set(['MessageRateExceeded']);

/** Seconds before attempt n+1: 30 s doubling, at most an hour. */
export function backoffSeconds(attempts: number): number {
  return Math.min(3600, 30 * 2 ** Math.max(0, attempts));
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/** Runs the tasks with at most `limit` in flight; results keep the order of the tasks. */
async function runBounded<T>(tasks: readonly (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const index = next++;
      results[index] = await tasks[index]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

interface Job {
  readonly notificationId: string;
  readonly push: Push;
  /** Set for a claimed retry event. */
  readonly retry?: { readonly eventId: number; readonly attempts: number };
}

interface Unit extends BuiltMessage {
  readonly job: Job;
}

type UnitResult = { state: 'sent'; ticketId: string } | { state: 'dead' | 'transient' | 'failed' };

function classify(ticket: Ticket | undefined): UnitResult {
  if (ticket?.status === 'ok' && ticket.id) return { state: 'sent', ticketId: ticket.id };
  const code = ticket?.error ?? '';
  if (DEAD_DEVICE.has(code)) return { state: 'dead' };
  return { state: TRANSIENT.has(code) || !ticket ? 'transient' : 'failed' };
}

/** Sends one request; a request-level failure decides the fate of all its messages. */
async function sendChunk(transport: PushTransport, units: readonly Unit[]): Promise<UnitResult[]> {
  try {
    const tickets = await transport.send(units.map((u) => u.message));
    return units.map((_unit, i) => classify(tickets[i]));
  } catch (error) {
    const retryable = !(error instanceof TransportError) || error.retryable;
    return units.map(() => ({ state: retryable ? 'transient' : 'failed' }));
  }
}

/** Step 1: receipts of earlier runs. */
async function checkReceipts(
  db: PushDatabase, transport: PushTransport, options: DispatchOptions, outcome: Outcome, summary: DispatchSummary,
): Promise<void> {
  for (const event of await db.claimReceipts(options.batchSize)) {
    try {
      for (const ids of chunk(event.tickets, MAX_RECEIPTS_PER_REQUEST)) {
        const receipts = await transport.getReceipts(ids.map((t) => t.id));
        for (const ticket of ids) {
          if (DEAD_DEVICE.has(receipts[ticket.id]?.error ?? '')) outcome.forget_devices.push(ticket.device_id);
        }
        summary.receiptsChecked += ids.length;
      }
      outcome.done.push(event.event_id);
    } catch {
      if (event.attempts >= options.maxAttempts) outcome.done.push(event.event_id);
      else outcome.retry.push({ event_id: event.event_id, error: 'receipts_unavailable', retry_in_seconds: backoffSeconds(event.attempts) });
    }
  }
}

/** Step 2: the pushes of this run, first attempts and retries alike. */
async function collectJobs(db: PushDatabase, options: DispatchOptions, summary: DispatchSummary): Promise<Job[]> {
  const jobs: Job[] = [];
  for (const result of await db.deliverBatch(options.batchSize)) {
    summary.events += 1;
    if (result.status === 'delivered' && result.push && result.notification_id) {
      jobs.push({ notificationId: result.notification_id, push: result.push });
    }
  }
  for (const result of await db.retryBatch(options.batchSize)) {
    summary.retries += 1;
    if (result.status === 'retry' && result.push && result.notification_id) {
      jobs.push({
        notificationId: result.notification_id, push: result.push,
        retry: { eventId: result.event_id, attempts: result.attempts ?? 1 },
      });
    }
  }
  return jobs;
}

/** Step 3: messages of every job; a job that cannot be rendered is dropped, not retried. */
async function buildUnits(db: PushDatabase, jobs: readonly Job[], summary: DispatchSummary): Promise<Unit[]> {
  const previewIds = [...new Set(jobs.map((job) => previewMessageId(job.push)).filter((id): id is string => id !== null))];
  const previews = previewIds.length > 0 ? await db.messagePreviews(previewIds) : new Map<string, string | null>();
  const units: Unit[] = [];
  for (const job of jobs) {
    try {
      const preview = previews.get(previewMessageId(job.push) ?? '');
      for (const built of buildMessages(job.push, preview)) units.push({ ...built, job });
    } catch (error) {
      if (!(error instanceof PayloadError)) throw error;
      summary.unsendable += 1;
    }
  }
  return units;
}

/** Step 5, per job: what failed for now is retried for those devices only. */
function settleJob(job: Job, transientDevices: string[], options: DispatchOptions, outcome: Outcome, summary: DispatchSummary): void {
  if (!job.retry) {
    if (transientDevices.length === 0) return;
    outcome.defer.push({ notification_id: job.notificationId, device_ids: transientDevices, retry_in_seconds: backoffSeconds(0) });
    summary.deferred += transientDevices.length;
    return;
  }
  if (transientDevices.length === 0) {
    outcome.done.push(job.retry.eventId);
  } else if (job.retry.attempts >= options.maxAttempts) {
    outcome.done.push(job.retry.eventId);
    summary.gaveUp += transientDevices.length;
  } else {
    outcome.retry.push({
      event_id: job.retry.eventId, device_ids: transientDevices, error: 'provider_unavailable',
      retry_in_seconds: backoffSeconds(job.retry.attempts),
    });
    summary.deferred += transientDevices.length;
  }
}

function hasWork(outcome: Outcome): boolean {
  return outcome.forget_devices.length + outcome.defer.length + outcome.retry.length + outcome.done.length + outcome.receipts.length > 0;
}

/** One run. Returns counts only. */
export async function runDispatch(
  deps: { db: PushDatabase; transport: PushTransport },
  overrides: Partial<DispatchOptions> = {},
): Promise<DispatchSummary> {
  const options = { ...DEFAULT_OPTIONS, ...overrides };
  const summary: DispatchSummary = {
    events: 0, retries: 0, sent: 0, deferred: 0, failed: 0, gaveUp: 0, devicesForgotten: 0, unsendable: 0, receiptsChecked: 0,
  };
  const outcome: Outcome = {
    forget_devices: [], defer: [], retry: [], done: [], receipts: [], receipt_delay_seconds: options.receiptDelaySeconds,
  };

  await checkReceipts(deps.db, deps.transport, options, outcome, summary);
  const jobs = await collectJobs(deps.db, options, summary);
  const units = await buildUnits(deps.db, jobs, summary);

  const chunks = chunk(units, MAX_MESSAGES_PER_REQUEST);
  const results = (await runBounded(chunks.map((c) => () => sendChunk(deps.transport, c)), options.concurrency)).flat();

  const transient = new Map<Job, string[]>();
  const tickets: TicketRef[] = [];
  units.forEach((unit, i) => {
    const result = results[i];
    if (result.state === 'sent') {
      summary.sent += 1;
      tickets.push({ id: result.ticketId, device_id: unit.deviceId });
    } else if (result.state === 'dead') {
      outcome.forget_devices.push(unit.deviceId);
    } else if (result.state === 'transient') {
      transient.set(unit.job, [...(transient.get(unit.job) ?? []), unit.deviceId]);
    } else {
      summary.failed += 1;
    }
  });
  for (const job of jobs) settleJob(job, transient.get(job) ?? [], options, outcome, summary);
  outcome.receipts = chunk(tickets, options.receiptChunk);
  outcome.forget_devices = [...new Set(outcome.forget_devices)];
  summary.devicesForgotten = outcome.forget_devices.length;

  if (hasWork(outcome)) await deps.db.settle(outcome);
  return summary;
}
