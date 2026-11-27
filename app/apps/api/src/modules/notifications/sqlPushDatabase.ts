// The database port of the push worker over plain SQL.
//
// The worker's functions live in `kc_private`, which no port reaches, so they are called
// directly, as the service role. Every method is one statement calling one database
// function; the statements are listed in `WORKER_SQL`, the same ones the Edge Function ran.
//
// Ported from `supabase/functions/dispatch-notification/postgresDatabase.ts`.
import type { DeliveryResult, Outcome, PushDatabase, ReceiptEvent, RetryResult, TicketRef } from './pushTypes';

export const WORKER_SQL = {
  deliverBatch: 'select r as result from kc_private.notifications_deliver_batch($1::integer) r',
  retryBatch: 'select r as result from kc_private.notification_push_retry_batch($1::integer) r',
  claimReceipts: "select e.id::text as id, e.attempts, e.payload from kc_private.outbox_claim('notification_push_receipt', $1::integer) e",
  messagePreviews: 'select p.message_id, p.preview from kc_private.notification_message_previews($1::uuid[]) p',
  settle: 'select kc_private.notification_push_settle($1::jsonb)',
} as const;

/** The one thing needed from a Postgres client: run a parameterised statement. */
export type Query = (sql: string, params: unknown[]) => Promise<Record<string, unknown>[]>;

/** @param query Runs one statement as the service role. */
export function createSqlPushDatabase(query: Query): PushDatabase {
  return {
    async deliverBatch(limit) {
      return (await query(WORKER_SQL.deliverBatch, [limit])).map((row) => row.result as DeliveryResult);
    },
    async retryBatch(limit) {
      return (await query(WORKER_SQL.retryBatch, [limit])).map((row) => row.result as RetryResult);
    },
    async claimReceipts(limit) {
      return (await query(WORKER_SQL.claimReceipts, [limit])).map((row): ReceiptEvent => ({
        event_id: Number(row.id),
        attempts: Number(row.attempts),
        tickets: (row.payload as { tickets?: TicketRef[] }).tickets ?? [],
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
