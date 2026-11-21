// dispatch-notification — the database port over a direct Postgres connection.
//
// The worker's functions live in `kc_private`, which the HTTP API does not expose, so the
// worker connects through the transaction pooler (design §5: Edge Functions use the
// pooler). Every method is one statement calling one database function; the statements
// are listed in WORKER_SQL so the pgTAP suite and this file name the same functions.
import type { DeliveryResult, DispatchScope, Outcome, PushDatabase, ReceiptEvent, RetryResult, TicketRef } from './types.ts';

export const WORKER_SQL = {
  deliverBatch: 'select r as result from kc_private.notifications_deliver_batch($1::integer) r',
  retryBatch: 'select r as result from kc_private.notification_push_retry_batch($1::integer) r',
  claimReceipts: "select e.id::text as id, e.attempts, e.payload from kc_private.outbox_claim('notification_push_receipt', $1::integer) e",
  deliverBatchScoped: 'select r as result from kc_private.notifications_deliver_batch_scoped($1::bigint[], $2::uuid, $3::integer) r',
  retryBatchScoped: 'select r as result from kc_private.notification_push_retry_batch_scoped($1::bigint[], $2::uuid, $3::uuid, $4::integer) r',
  claimReceiptsScoped: "select e.id::text as id, e.attempts, e.payload from kc_private.outbox_claim_scoped('notification_push_receipt', $1::bigint[], null, null, $2::uuid, $3::integer) e",
  messagePreviews: 'select p.message_id, p.preview from kc_private.notification_message_previews($1::uuid[]) p',
  settle: 'select kc_private.notification_push_settle($1::jsonb)',
} as const;

/** The one thing needed from a Postgres client: run a parameterised statement. */
export type Query = (sql: string, params: unknown[]) => Promise<Record<string, unknown>[]>;

export function createPostgresDatabase(query: Query): PushDatabase {
  return {
    async deliverBatch(limit, scope) {
      const rows = scope
        ? await query(WORKER_SQL.deliverBatchScoped, [scope.eventIds?.length ? scope.eventIds : null, scope.recipientId ?? null, limit])
        : await query(WORKER_SQL.deliverBatch, [limit]);
      return rows.map((row) => row.result as DeliveryResult);
    },
    async retryBatch(limit, scope) {
      const rows = scope
        ? await query(WORKER_SQL.retryBatchScoped, [scope.eventIds?.length ? scope.eventIds : null, scope.notificationId ?? null, scope.deviceId ?? null, limit])
        : await query(WORKER_SQL.retryBatch, [limit]);
      return rows.map((row) => row.result as RetryResult);
    },
    async claimReceipts(limit, scope) {
      const rows = scope
        ? await query(WORKER_SQL.claimReceiptsScoped, [scope.eventIds?.length ? scope.eventIds : null, scope.deviceId ?? null, limit])
        : await query(WORKER_SQL.claimReceipts, [limit]);
      return rows.map((row): ReceiptEvent => ({
        event_id: Number(row.id),
        attempts: Number(row.attempts),
        tickets: ((row.payload as { tickets?: TicketRef[] }).tickets ?? []),
      }));
    },
    async messagePreviews(messageIds) {
      const rows = await query(WORKER_SQL.messagePreviews, [messageIds]);
      return new Map(rows.map((row) => [String(row.message_id), (row.preview as string | null) ?? null]));
    },
    async settle(outcome: Outcome) {
      await query(WORKER_SQL.settle, [JSON.stringify(outcome)]);
    },
  };
}
