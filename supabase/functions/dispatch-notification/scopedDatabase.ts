import type { Push } from "./types.ts";
import {
  type DispatchScope,
  parseDispatchScope,
  scopeToWire,
} from "./scope.ts";
import type { Query } from "./postgresDatabase.ts";
export type WorkerScope = DispatchScope | { readonly automatic: true };
export interface DispatchJob {
  id: number;
  lease_id: string;
  phase: "pending" | "receipt";
  attempts: number;
  origin_event_id: number;
  notification_id: string;
  recipient_id: string;
  device_id: string;
  ticket_id: string | null;
  push: Push | null;
}
export interface Settlement {
  id: number;
  lease_id: string;
  state:
    | "accepted"
    | "retry"
    | "permanent"
    | "unknown"
    | "receipt_pending"
    | "provider_accepted"
    | "device_gone";
  ticket_id?: string;
}
export interface ScopedDatabase {
  deliver(scope: WorkerScope, limit: number): Promise<number>;
  claim(
    scope: WorkerScope,
    phase: "pending" | "receipt",
    limit: number,
  ): Promise<DispatchJob[]>;
  beginSend(
    scope: WorkerScope,
    jobs: DispatchJob[],
  ): Promise<Map<number, number>>;
  settle(scope: WorkerScope, results: Settlement[]): Promise<void>;
  previews(ids: string[]): Promise<Map<string, string | null>>;
}
export function wireScope(scope: WorkerScope): Record<string, unknown> {
  if (
    "automatic" in scope && Object.keys(scope).length === 1 &&
    scope.automatic === true
  ) return { automatic: true };
  if (
    Object.keys(scope).some((k) =>
      !["eventIds", "notificationId", "recipientId", "deviceId"].includes(k)
    )
  ) throw new Error("invalid dispatch scope");
  const wire = scopeToWire(scope as DispatchScope);
  if (!parseDispatchScope(wire)) throw new Error("invalid dispatch scope");
  return wire;
}
export const SCOPED_SQL = {
  deliver: "select kc_private.dispatch_deliver($1::jsonb,$2::integer) as count",
  claim:
    "select r as job from kc_private.dispatch_claim($1::jsonb,$2::text,$3::integer) r",
  begin:
    "select r as result from kc_private.dispatch_begin_send($1::jsonb,$2::jsonb) r",
  settle: "select kc_private.dispatch_settle($1::jsonb,$2::jsonb)",
  previews:
    "select message_id,preview from kc_private.notification_message_previews($1::uuid[])",
} as const;
export function createScopedDatabase(query: Query): ScopedDatabase {
  const wire = (s: WorkerScope) => JSON.stringify(wireScope(s));
  return {
    async deliver(scope, limit) {
      return Number(
        (await query(SCOPED_SQL.deliver, [wire(scope), limit]))[0].count,
      );
    },
    async claim(scope, phase, limit) {
      return (await query(SCOPED_SQL.claim, [wire(scope), phase, limit])).map(
        (r) => r.job as DispatchJob,
      );
    },
    async beginSend(scope, jobs) {
      const rows = await query(SCOPED_SQL.begin, [
        wire(scope),
        JSON.stringify(jobs.map((j) => ({ id: j.id, lease_id: j.lease_id }))),
      ]);
      return new Map(rows.map((r) => {
        const x = r.result as { id: number; badge: number };
        return [x.id, x.badge];
      }));
    },
    async settle(scope, results) {
      if (results.length) {
        await query(SCOPED_SQL.settle, [wire(scope), JSON.stringify(results)]);
      }
    },
    async previews(ids) {
      return new Map(
        (await query(SCOPED_SQL.previews, [ids])).map(
          (r) => [String(r.message_id), r.preview as string | null],
        ),
      );
    },
  };
}
