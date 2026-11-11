// dispatch-notification — test doubles: a push fixture per kind, an in-memory database
// with the claim semantics of the outbox, and a scripted transport.
import { NOTIFICATION_KINDS } from './kinds.generated.ts';
import type { KindSpec } from './messages.ts';
import type {
  DeliveryResult, Outcome, Platform, ProviderMessage, Push, PushDatabase, PushToken, PushTransport, ReceiptEvent,
  RetryResult, Ticket, TicketRef,
} from './types.ts';

export const KIND_ENTRIES = Object.entries(NOTIFICATION_KINDS) as [string, KindSpec][];
export const ENTITY_ID = '11111111-1111-4111-8111-111111111111';
export const MESSAGE_ID = '22222222-2222-4222-8222-222222222222';

export function device(n: number, platform: Platform = n % 2 === 0 ? 'ios' : 'android'): PushToken {
  return { device_id: `device-${n}`, token: `ExponentPushToken[secret-${n}]`, platform };
}

/** A push as kc_private.notification_push returns it for a kind. */
export function pushFor(kind: string, overrides: Partial<Push> & { groupCount?: number; id?: string } = {}): Push {
  const spec = NOTIFICATION_KINDS[kind as keyof typeof NOTIFICATION_KINDS] as KindSpec | undefined;
  const { groupCount = 1, id = `n-${kind}`, ...rest } = overrides;
  return {
    tokens: [device(1, 'android'), device(2, 'ios')],
    title_key: spec?.titleKey ?? 'notifications.none',
    body_key: spec?.bodyKey ?? 'notifications.none',
    args: {
      actor_display_name: 'Dana Levi', post_id: ENTITY_ID, status: 'confirmed',
      ...(spec?.textArgs.includes('messagePreview') ? { message_id: MESSAGE_ID } : {}),
    },
    data: { notification_id: id, kind, category: spec?.category ?? 'critical', entity: { type: 'chat', id: ENTITY_ID }, group_count: groupCount },
    collapse_key: spec?.groupWindowSeconds ? `${kind}:chat:${ENTITY_ID}` : null,
    badge: 7,
    ...rest,
  };
}

interface QueuedEvent {
  id: number;
  processed: boolean;
  claimed: boolean;
  availableAt: number;
  attempts: number;
}
interface NotificationEvent extends QueuedEvent { notificationId: string; push: Push | null }
interface RetryEvent extends QueuedEvent { notificationId: string; deviceIds: string[]; error?: string }
interface ReceiptQueued extends QueuedEvent { tickets: TicketRef[] }

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** In-memory stand-in for the database functions the worker calls. */
export class FakeDatabase implements PushDatabase {
  now = 0;
  private nextId = 1;
  readonly events: NotificationEvent[] = [];
  readonly retries: RetryEvent[] = [];
  readonly receiptEvents: ReceiptQueued[] = [];
  readonly pushes = new Map<string, Push>();
  readonly forgotten = new Set<string>();
  readonly outcomes: Outcome[] = [];
  readonly previewCalls: string[][] = [];
  previews = new Map<string, string | null>();

  /** Enqueues a `notification` event; `push = null` is what the database returns for a
   * centre-only kind, a member in quiet hours or a member without a device. */
  emit(push: Push | null, notificationId = push?.data.notification_id ?? `n-${this.nextId}`): void {
    if (push) this.pushes.set(notificationId, push);
    this.events.push({ id: this.nextId++, processed: false, claimed: false, availableAt: 0, attempts: 0, notificationId, push });
  }

  private claim<T extends QueuedEvent>(queue: T[], limit: number): T[] {
    const due = queue.filter((e) => !e.processed && !e.claimed && e.availableAt <= this.now).slice(0, limit);
    for (const event of due) {
      event.claimed = true;
      event.attempts += 1;
    }
    return due;
  }

  async deliverBatch(limit: number): Promise<DeliveryResult[]> {
    // Claim and confirm happen in one transaction in the database: no await in between.
    const claimed = this.claim(this.events, limit);
    for (const event of claimed) event.processed = true;
    await tick();
    return claimed.map((e) => ({ event_id: e.id, status: 'delivered', notification_id: e.notificationId, push: e.push }));
  }

  async retryBatch(limit: number): Promise<RetryResult[]> {
    const claimed = this.claim(this.retries, limit);
    await tick();
    return claimed.map((event) => {
      const push = this.pushes.get(event.notificationId);
      const tokens = (push?.tokens ?? []).filter((t) => event.deviceIds.includes(t.device_id) && !this.forgotten.has(t.device_id));
      if (!push || tokens.length === 0) {
        event.processed = true;
        return { event_id: event.id, status: 'skipped' };
      }
      return { event_id: event.id, status: 'retry', attempts: event.attempts, notification_id: event.notificationId, push: { ...push, tokens } };
    });
  }

  async claimReceipts(limit: number): Promise<ReceiptEvent[]> {
    const claimed = this.claim(this.receiptEvents, limit);
    await tick();
    return claimed.map((e) => ({ event_id: e.id, attempts: e.attempts, tickets: e.tickets }));
  }

  messagePreviews(messageIds: string[]): Promise<Map<string, string | null>> {
    this.previewCalls.push(messageIds);
    return Promise.resolve(new Map(messageIds.filter((id) => this.previews.has(id)).map((id) => [id, this.previews.get(id)!])));
  }

  settle(outcome: Outcome): Promise<void> {
    this.outcomes.push(structuredClone(outcome));
    for (const id of outcome.forget_devices) this.forgotten.add(id);
    for (const d of outcome.defer) {
      this.retries.push({
        id: this.nextId++, processed: false, claimed: false, attempts: 0, availableAt: this.now + d.retry_in_seconds,
        notificationId: d.notification_id, deviceIds: d.device_ids,
      });
    }
    const pushEvents: (RetryEvent | ReceiptQueued)[] = [...this.retries, ...this.receiptEvents];
    for (const r of outcome.retry) {
      const event = pushEvents.find((e) => e.id === r.event_id);
      if (!event) continue;
      event.claimed = false;
      event.availableAt = this.now + r.retry_in_seconds;
      if (r.device_ids && 'deviceIds' in event) event.deviceIds = r.device_ids;
    }
    for (const id of outcome.done) {
      const event = pushEvents.find((e) => e.id === id);
      if (event) event.processed = true;
    }
    for (const tickets of outcome.receipts) {
      this.receiptEvents.push({
        id: this.nextId++, processed: false, claimed: false, attempts: 0,
        availableAt: this.now + outcome.receipt_delay_seconds, tickets,
      });
    }
    return Promise.resolve();
  }
}

type SendScript = (messages: readonly ProviderMessage[], request: number) => Ticket[] | Promise<Ticket[]>;

/** Transport that records every request; `script` decides the tickets (default: all ok). */
export class FakeTransport implements PushTransport {
  readonly requests: ProviderMessage[][] = [];
  readonly receiptRequests: string[][] = [];
  receipts: Record<string, Ticket> = {};
  receiptsFail = false;
  inFlight = 0;
  maxInFlight = 0;
  private ticketSeq = 0;

  constructor(private readonly script?: SendScript) {}

  get sent(): ProviderMessage[] {
    return this.requests.flat();
  }

  async send(messages: readonly ProviderMessage[]): Promise<Ticket[]> {
    const request = this.requests.push([...messages]) - 1;
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      await tick();
      if (this.script) return await this.script(messages, request);
      return messages.map(() => ({ status: 'ok', id: `ticket-${this.ticketSeq++}` }));
    } finally {
      this.inFlight -= 1;
    }
  }

  getReceipts(ticketIds: readonly string[]): Promise<Record<string, Ticket>> {
    this.receiptRequests.push([...ticketIds]);
    if (this.receiptsFail) return Promise.reject(new Error('down'));
    return Promise.resolve(Object.fromEntries(ticketIds.filter((id) => id in this.receipts).map((id) => [id, this.receipts[id]])));
  }
}
