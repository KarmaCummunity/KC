import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { createRerankHandler } from './handler.ts';

const req = (token?: string, method = 'POST') =>
  new Request('http://x/match-rerank', { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });

const PAIR = { candidate_id: 'c1', world_slug: 'items', score: 0.6, offer_title: 'Sofa', offer_summary: null,
  request_title: 'Couch', request_summary: null };

function deps(over: Partial<Parameters<typeof createRerankHandler>[0]> = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  let fetched = 0;
  const d = {
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return Promise.resolve(
        fn === 'api_match_llm_pending' ? { data: [PAIR], error: null } : { data: null, error: null }, // the store returns void
      );
    },
    fetchFn: (() => {
      fetched++;
      return Promise.resolve(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text:
        JSON.stringify({ results: [{ id: 'c1', score: 0.9, reason: 'fits' }] }) }] } }] })));
    }) as typeof fetch,
    geminiKey: 'test-key', model: 'm', serviceKey: 'svc', ...over,
  };
  return { d, calls, fetched: () => fetched };
}

Deno.test('rejects non-service callers and non-POST', async () => {
  const { d } = deps();
  const h = createRerankHandler(d);
  assertEquals((await h(req())).status, 403);
  assertEquals((await h(req('garbage'))).status, 403);
  // A well-formed JWT claiming the service role is not the key itself.
  const forged = `${btoa('{"alg":"HS256"}')}.${btoa('{"role":"service_role"}')}.sig`;
  assertEquals((await h(req(forged))).status, 403);
  assertEquals((await h(req('svc', 'GET'))).status, 405);
  // A function without a configured key rejects everyone.
  assertEquals((await createRerankHandler(deps({ serviceKey: '' }).d)(req(''))).status, 403);
});

Deno.test('no-ops without a Gemini key (no RPC, no fetch)', async () => {
  const { d, calls, fetched } = deps({ geminiKey: '' });
  const res = await createRerankHandler(d)(req('svc'));
  assertEquals((await res.json()).skipped, 'no_gemini_key');
  assertEquals(calls.length, 0);
  assertEquals(fetched(), 0);
});

Deno.test('no-ops when the flag is off (pending is empty)', async () => {
  const { d, fetched } = deps({ rpc: () => Promise.resolve({ data: [], error: null }) });
  const res = await createRerankHandler(d)(req('svc'));
  assertEquals((await res.json()).skipped, 'nothing_pending_or_flag_off');
  assertEquals(fetched(), 0);
});

Deno.test('scores pending pairs and stores verdicts', async () => {
  const { d, calls } = deps();
  const body = await (await createRerankHandler(d)(req('svc'))).json();
  assertEquals(body, { ok: true, scored: 1, failed: 0, pending: 1 });
  assertEquals(calls[1], { fn: 'api_match_llm_store', args: { p_candidate_id: 'c1', p_score: 0.9, p_reason: 'fits' } });
});

Deno.test('reports upstream failure without storing', async () => {
  const { d, calls } = deps({ fetchFn: (() => Promise.resolve(new Response('x', { status: 429 }))) as typeof fetch });
  const res = await createRerankHandler(d)(req('svc'));
  assertEquals(res.status, 502);
  assertEquals(calls.length, 1);
});

Deno.test('counts a pair the database no longer knows (match_not_found) as failed', async () => {
  const { d } = deps();
  d.rpc = (fn: string) =>
    Promise.resolve(fn === 'api_match_llm_pending'
      ? { data: [PAIR], error: null }
      : { data: null, error: { message: 'match_not_found' } });
  const body = await (await createRerankHandler(d)(req('svc'))).json();
  assertEquals(body, { ok: false, scored: 0, failed: 1, pending: 1 });
});
