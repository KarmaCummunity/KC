// dispatch-notification — HTTP handler: service-role callers only; runs the worker until
// the queues are empty or the time budget is used. Logic in dispatch.ts.
import { isServiceRoleRequest, serviceRoleRequiredResponse } from '../_shared/serviceRoleGuard.ts';
import { type DispatchOptions, type DispatchSummary, runDispatch } from './dispatch.ts';
import type { DispatchScope, PushDatabase, PushTransport } from './types.ts';

export interface HandlerDeps {
  readonly db: PushDatabase;
  readonly transport: PushTransport;
  readonly serviceRoleKey: string | string[];
  readonly options?: Partial<DispatchOptions>;
  /** Stop starting new rounds after this many milliseconds. */
  readonly budgetMs?: number;
  readonly maxRounds?: number;
  readonly now?: () => number;
}

function add(total: DispatchSummary, round: DispatchSummary): void {
  for (const key of Object.keys(round) as (keyof DispatchSummary)[]) total[key] += round[key];
}

/** A scope needs at least one filter; an unscoped call is the generic drain and stays closed. */
function parseScope(body: unknown): DispatchScope | null {
  if (body === null || typeof body !== 'object') return null;
  const scope = (body as { scope?: unknown }).scope;
  if (scope === null || typeof scope !== 'object') return null;
  const s = scope as Record<string, unknown>;
  const eventIds = Array.isArray(s.event_ids) ? s.event_ids.filter((id): id is number => Number.isInteger(id) && id > 0) : [];
  const notificationId = typeof s.notification_id === 'string' ? s.notification_id : null;
  const recipientId = typeof s.recipient_id === 'string' ? s.recipient_id : null;
  const deviceId = typeof s.device_id === 'string' ? s.device_id : null;
  if (eventIds.length === 0 && !notificationId && !recipientId && !deviceId) return null;
  return {
    ...(eventIds.length ? { eventIds: eventIds } : {}),
    ...(notificationId ? { notificationId } : {}),
    ...(recipientId ? { recipientId } : {}),
    ...(deviceId ? { deviceId } : {}),
  };
}

export function createDispatchHandler(deps: HandlerDeps): (req: Request) => Promise<Response> {
  const now = deps.now ?? Date.now;
  return async (req) => {
    if (!isServiceRoleRequest(req, deps.serviceRoleKey)) return serviceRoleRequiredResponse();
    // Scoped activation only: without an explicit event/recipient/device scope the call
    // is the generic drain, which stays closed until a reviewed release (#856).
    const scope = parseScope(await req.json().catch(() => null));
    if (!scope) {
      return new Response(JSON.stringify({ ok: true, closed: true, rounds: 0 }), { headers: { 'Content-Type': 'application/json' } });
    }
    const options = { ...deps.options, scope };
    const started = now();
    const total: DispatchSummary = {
      events: 0, retries: 0, sent: 0, deferred: 0, failed: 0, gaveUp: 0, devicesForgotten: 0, unsendable: 0, receiptsChecked: 0,
    };
    let rounds = 0;
    while (rounds < (deps.maxRounds ?? 20) && now() - started < (deps.budgetMs ?? 20_000)) {
      const round = await runDispatch({ db: deps.db, transport: deps.transport }, options);
      rounds += 1;
      add(total, round);
      // A round that claimed nothing found the queues empty.
      if (round.events + round.retries + round.receiptsChecked === 0) break;
    }
    return new Response(JSON.stringify({ rounds, ...total }), { headers: { 'Content-Type': 'application/json' } });
  };
}
