// match-rerank — optional Gemini re-rank of fresh match candidates (docs/db/target-design.md
// matching module, supabase/schemas/76_matching/050_match_processing.sql). Started every five
// minutes by the database job `match_rerank`. Logic lives here so it is unit-tested with mocks.
// Clean no-op when: the caller is not the service role, the GEMINI key is absent, or the
// matching setting `llm_rerank_enabled` is off (api_match_llm_pending returns no rows).

import { isServiceRoleRequest } from '../_shared/serviceRoleGuard.ts';
import { buildGeminiBody, parseRerankResponse, type PendingPair } from '../_shared/matching/rerank.ts';

type RpcResult = { data: unknown; error: { message: string } | null };

export interface RerankDeps {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<RpcResult>;
  fetchFn: typeof fetch;
  geminiKey: string;
  model: string;
  serviceKey: string;
  batchSize?: number;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export function createRerankHandler(deps: RerankDeps) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    if (!isServiceRoleRequest(req, deps.serviceKey)) return json({ error: 'forbidden' }, 403);
    if (!deps.geminiKey) return json({ ok: true, skipped: 'no_gemini_key', scored: 0 });

    const pending = await deps.rpc('api_match_llm_pending', { p_limit: deps.batchSize ?? 20 });
    if (pending.error) return json({ error: 'pending_failed' }, 500);
    const pairs = (pending.data ?? []) as PendingPair[];
    if (pairs.length === 0) return json({ ok: true, skipped: 'nothing_pending_or_flag_off', scored: 0 });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${deps.model}:generateContent`;
    const res = await deps.fetchFn(url, {
      method: 'POST',
      // Key in a header, not the query string, so it never lands in access logs.
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': deps.geminiKey },
      body: JSON.stringify(buildGeminiBody(pairs)),
    });
    if (!res.ok) return json({ error: 'gemini_failed', status: res.status }, 502);

    const verdicts = parseRerankResponse(await res.text(), pairs);
    const stored = await Promise.all(
      verdicts.map((v) =>
        deps.rpc('api_match_llm_store', { p_candidate_id: v.candidate_id, p_score: v.score, p_reason: v.reason }),
      ),
    );
    const failed = stored.filter((r) => r.error).length;
    return json({ ok: failed === 0, scored: verdicts.length - failed, failed, pending: pairs.length });
  };
}
