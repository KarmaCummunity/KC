// rotate-research-salt — the daily rotation of the public research hashing salt
// (FR-RESEARCH-002 AC3, supabase/schemas/90_research/030_public_research.sql). The database
// owns the salt: this worker only asks it to replace the value, so yesterday's address
// hashes can no longer be linked to today's visitors. Service role only; started daily by
// the database job `research_salt_rotate`.
import { isServiceRoleRequest, serviceRoleRequiredResponse } from '../_shared/serviceRoleGuard.ts';

export interface RotateSaltDeps {
  /** The project's service-role key; the only credential the worker accepts. */
  readonly serviceRoleKey: string;
  /** Calls `rotate_research_salt()`; resolves to the rotation time (ISO 8601). */
  readonly rotate: () => Promise<string>;
  /** Receives a failure; the worker never puts its cause in the response. */
  readonly report: (error: unknown) => Promise<void>;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** POST → 200 { ok, rotated_at }; 401 for any caller but the service role; 500 { ok: false, error }. */
export function createRotateSaltHandler(deps: RotateSaltDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
    if (!isServiceRoleRequest(req, deps.serviceRoleKey)) return serviceRoleRequiredResponse();
    try {
      return json({ ok: true, rotated_at: await deps.rotate() });
    } catch (error) {
      await deps.report(error);
      return json({ ok: false, error: 'internal' }, 500);
    }
  };
}
