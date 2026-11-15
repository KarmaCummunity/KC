// dispatch-notification — HTTP handler: service-role callers only; runs the worker until
// the queues are empty or the time budget is used. Logic in dispatch.ts.
import { isServiceRoleRequest } from '../_shared/serviceRoleGuard.ts';
import { type DispatchOptions, type DispatchSummary, runDispatch } from './dispatch.ts';
import type { PushDatabase, PushTransport } from './types.ts';

export interface HandlerDeps {
  readonly db: PushDatabase;
  readonly transport: PushTransport;
  readonly serviceRoleKey: string;
  readonly options?: Partial<DispatchOptions>;
  /** Stop starting new rounds after this many milliseconds. */
  readonly budgetMs?: number;
  readonly maxRounds?: number;
  readonly now?: () => number;
}

function add(total: DispatchSummary, round: DispatchSummary): void {
  for (const key of Object.keys(round) as (keyof DispatchSummary)[]) total[key] += round[key];
}

export function createDispatchHandler(deps: HandlerDeps): (req: Request) => Promise<Response> {
  const now = deps.now ?? Date.now;
  return async (req) => {
    if (!isServiceRoleRequest(req, deps.serviceRoleKey)) return new Response('Unauthorized', { status: 401 });
    const started = now();
    const total: DispatchSummary = {
      events: 0, retries: 0, sent: 0, deferred: 0, failed: 0, gaveUp: 0, devicesForgotten: 0, unsendable: 0, receiptsChecked: 0,
    };
    let rounds = 0;
    while (rounds < (deps.maxRounds ?? 20) && now() - started < (deps.budgetMs ?? 20_000)) {
      const round = await runDispatch({ db: deps.db, transport: deps.transport }, deps.options);
      rounds += 1;
      add(total, round);
      // A round that claimed nothing found the queues empty.
      if (round.events + round.retries + round.receiptsChecked === 0) break;
    }
    return new Response(JSON.stringify({ rounds, ...total }), { headers: { 'Content-Type': 'application/json' } });
  };
}
