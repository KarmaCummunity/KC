// dispatch-notification — contracts: what the database hands over, what the provider takes,
// and the two ports (database, transport) the worker is written against.

export type Platform = 'ios' | 'android' | 'web';

export interface PushToken {
  readonly device_id: string;
  readonly token: string;
  readonly platform: Platform;
}

/** The push of one notification, as built by kc_private.notification_push. */
export interface Push {
  readonly tokens: readonly PushToken[];
  readonly title_key: string;
  readonly body_key: string;
  /** The notification's data (ids, statuses) plus `actor_display_name`. Never message text. */
  readonly args: Readonly<Record<string, unknown>>;
  readonly data: {
    readonly notification_id: string;
    readonly kind: string;
    readonly category: string;
    readonly entity: { readonly type: string; readonly id: string } | null;
    readonly group_count: number;
  };
  readonly collapse_key: string | null;
  readonly badge: number;
}

/** One result of kc_private.notifications_deliver_batch. */
export interface DeliveryResult {
  readonly event_id: number;
  readonly status: 'delivered' | 'skipped' | 'failed';
  readonly notification_id?: string;
  readonly push?: Push | null;
}

/** One result of kc_private.notification_push_retry_batch. */
export interface RetryResult {
  readonly event_id: number;
  readonly status: 'retry' | 'skipped';
  readonly attempts?: number;
  readonly notification_id?: string;
  readonly push?: Push;
}

export interface TicketRef {
  readonly id: string;
  readonly device_id: string;
}

/** A claimed `notification_push_receipt` outbox event. */
export interface ReceiptEvent {
  readonly event_id: number;
  readonly attempts: number;
  readonly tickets: readonly TicketRef[];
}

/** Everything one run learned; the argument of kc_private.notification_push_settle. */
export interface Outcome {
  forget_devices: string[];
  defer: { notification_id: string; device_ids: string[]; retry_in_seconds: number }[];
  retry: { event_id: number; device_ids?: string[]; error: string; retry_in_seconds: number }[];
  done: number[];
  receipts: TicketRef[][];
  receipt_delay_seconds: number;
}

/** Database port. Each method is one round trip. */
export interface PushDatabase {
  deliverBatch(limit: number): Promise<DeliveryResult[]>;
  retryBatch(limit: number): Promise<RetryResult[]>;
  claimReceipts(limit: number): Promise<ReceiptEvent[]>;
  /** Preview text by message id; null for a message without text. */
  messagePreviews(messageIds: string[]): Promise<Map<string, string | null>>;
  settle(outcome: Outcome): Promise<void>;
}

/** Fields shared by both platforms (Expo push message format). */
interface BaseMessage {
  readonly to: string;
  readonly title: string;
  readonly body: string;
  readonly data: Readonly<Record<string, unknown>>;
  /** `high` only for time-critical kinds; `default` is the platform's own default. */
  readonly priority: 'default' | 'high';
  /** In-transit coalescing on both platforms; on iOS it also replaces the shown one. */
  readonly collapseId?: string;
}

export interface AndroidMessage extends BaseMessage {
  readonly platform: 'android';
  readonly channelId: string;
  /** Replaces the notification already shown with the same tag. */
  readonly tag?: string;
}

export interface IosMessage extends BaseMessage {
  readonly platform: 'ios';
  readonly sound?: 'default';
  readonly badge: number;
  readonly interruptionLevel: 'active' | 'time-sensitive';
  readonly threadId: string;
  readonly categoryId: string;
}

export type ProviderMessage = AndroidMessage | IosMessage;

export interface Ticket {
  readonly status: 'ok' | 'error';
  readonly id?: string;
  /** Provider error code, e.g. DeviceNotRegistered. */
  readonly error?: string;
}

/** A request the provider did not take as a whole. */
export class TransportError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = 'TransportError';
  }
}

/** Provider port. `send` takes at most MAX_MESSAGES_PER_REQUEST and returns one ticket per message, in order. */
export interface PushTransport {
  send(messages: readonly ProviderMessage[]): Promise<Ticket[]>;
  /** Receipts by ticket id; ids the provider does not know yet are absent. */
  getReceipts(ticketIds: readonly string[]): Promise<Record<string, Ticket>>;
}

export const MAX_MESSAGES_PER_REQUEST = 100;
export const MAX_RECEIPTS_PER_REQUEST = 1000;
