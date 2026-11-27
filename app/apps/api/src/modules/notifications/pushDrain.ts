// Runs the push worker until the queues are empty or the time budget of one
// job run is used; the next run continues where this one stopped.
//
// Ported from `supabase/functions/dispatch-notification/handler.ts`.

import { type DispatchOptions, type DispatchSummary, runDispatch } from './pushDispatch';
import type { PushDatabase, PushTransport } from './pushTypes';

export interface DrainDeps {
  readonly db: PushDatabase;
  readonly transport: PushTransport;
  readonly options?: Partial<DispatchOptions>;
  /** Stop starting new rounds after this many milliseconds. */
  readonly budgetMs?: number;
  readonly maxRounds?: number;
  /** Current time in milliseconds; replaced in tests. */
  readonly now?: () => number;
}

const DEFAULT_BUDGET_MS = 20_000;
const DEFAULT_MAX_ROUNDS = 20;

/** The counts of every round, and how many rounds ran. Counts only: never a token, a title or a body. */
export type DrainSummary = DispatchSummary & { rounds: number };

/** Runs rounds of the worker; a round that claimed nothing found the queues empty and ends the run. */
export async function drainPushQueues(deps: DrainDeps): Promise<DrainSummary> {
  const now = deps.now ?? Date.now;
  const started = now();
  const total: DrainSummary = { rounds: 0, events: 0, retries: 0, sent: 0, deferred: 0, failed: 0, gaveUp: 0, devicesForgotten: 0, unsendable: 0, receiptsChecked: 0 };
  while (total.rounds < (deps.maxRounds ?? DEFAULT_MAX_ROUNDS) && now() - started < (deps.budgetMs ?? DEFAULT_BUDGET_MS)) {
    const round = await runDispatch({ db: deps.db, transport: deps.transport }, deps.options);
    total.rounds += 1;
    for (const key of Object.keys(round) as (keyof DispatchSummary)[]) total[key] += round[key];
    if (round.events + round.retries + round.receiptsChecked === 0) break;
  }
  return total;
}
