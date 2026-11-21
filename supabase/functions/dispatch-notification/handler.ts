// Auth first, POST only, explicit validated scope. All production work uses the durable
// scoped queue. The old generic dispatch adapter has no route from this HTTP handler.
import {
  isServiceRoleRequest,
  serviceRoleRequiredResponse,
} from "../_shared/serviceRoleGuard.ts";
import { parseDispatchScope } from "./scope.ts";
import { runScopedDispatch, type ScopedSummary } from "./scopedDispatch.ts";
import type { ScopedDatabase, WorkerScope } from "./scopedDatabase.ts";
import type { PushTransport } from "./types.ts";
export interface HandlerDeps {
  readonly db: ScopedDatabase;
  readonly transport: PushTransport;
  readonly serviceRoleKey: string | string[];
  readonly budgetMs?: number;
  readonly maxRounds?: number;
  readonly now?: () => number;
}
export function createDispatchHandler(
  deps: HandlerDeps,
): (req: Request) => Promise<Response> {
  const now = deps.now ?? Date.now;
  return async (req) => {
    if (!isServiceRoleRequest(req, deps.serviceRoleKey)) return serviceRoleRequiredResponse();
    if (req.method !== "POST") {
      return new Response(null, { status: 405, headers: { Allow: "POST" } });
    }
    const body: unknown = await req.json().catch(() => null);
    let scope: WorkerScope | null = null;
    if (
      body && typeof body === "object" && !Array.isArray(body) &&
      Object.keys(body).length === 1 && Object.hasOwn(body, "scope")
    ) {
      const raw = (body as { scope: unknown }).scope;
      if (
        raw && typeof raw === "object" && !Array.isArray(raw) &&
        Object.keys(raw).length === 1 &&
        (raw as { automatic?: unknown }).automatic === true
      ) scope = { automatic: true };
      else scope = parseDispatchScope(raw);
    }
    if (!scope) return Response.json({ ok: true, closed: true, rounds: 0 });
    const started = now();
    let rounds = 0;
    const total: ScopedSummary = {
      events: 0,
      claimed: 0,
      accepted: 0,
      unknown: 0,
      failed: 0,
      receipts: 0,
    };
    while (
      rounds < (deps.maxRounds ?? 5) &&
      now() - started < (deps.budgetMs ?? 20_000)
    ) {
      const r = await runScopedDispatch(deps.db, deps.transport, scope);
      rounds++;
      for (const key of Object.keys(total) as (keyof ScopedSummary)[]) {
        total[key] += r[key];
      }
      if (r.events + r.claimed + r.receipts === 0) break;
    }
    return Response.json({ rounds, ...total });
  };
}
