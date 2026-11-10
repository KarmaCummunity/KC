import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { createEmbedWorkerHandler, embedText, isServiceRoleJwt, stubEmbed, type ClaimedJob } from './handler.ts';

const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '');
const jwt = (role: string) => `${b64({ alg: 'HS256' })}.${b64({ role })}.sig`;
const req = (token?: string, body?: unknown) =>
  new Request('http://x/embed-worker', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const JOB: ClaimedJob = {
  job_id: 'j1', listing_id: 'l1', model: 'text-embedding-3-small',
  title: 'Sofa', summary: 'blue', details: { item_condition: 'Good' },
};

type Call = { fn: string; args: Record<string, unknown> };

function deps(results: Record<string, { data: unknown; error: { message: string } | null }>) {
  const calls: Call[] = [];
  return {
    calls,
    d: {
      rpc: (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        return Promise.resolve(results[fn] ?? { data: null, error: null });
      },
    },
  };
}

Deno.test('rejects a caller without a service-role bearer with 401, before any RPC', async () => {
  const { d, calls } = deps({});
  const h = createEmbedWorkerHandler(d);
  assertEquals((await h(req())).status, 401);
  assertEquals((await h(req(jwt('authenticated')))).status, 401);
  assertEquals((await h(req('not-a-jwt'))).status, 401);
  assertEquals(calls, []);
  assertEquals(isServiceRoleJwt(`Bearer ${jwt('service_role')}`), true);
});

Deno.test('claims with the requested limit, capped at 50, defaulting to 20', async () => {
  for (const [body, expected] of [[{ limit: 5 }, 5], [{ limit: 500 }, 50], [{}, 20], [undefined, 20]] as const) {
    const { d, calls } = deps({ embedding_jobs_claim: { data: [], error: null } });
    const res = await createEmbedWorkerHandler(d)(req(jwt('service_role'), body));
    assertEquals(await res.json(), { ok: true, processed: 0 });
    assertEquals(calls, [{ fn: 'embedding_jobs_claim', args: { p_limit: expected } }]);
  }
});

Deno.test('stores each claimed job\'s stub vector with its model', async () => {
  const second = { ...JOB, job_id: 'j2', model: null };
  const { d, calls } = deps({ embedding_jobs_claim: { data: [JOB, second], error: null }, embedding_job_store: { data: true, error: null } });
  const res = await createEmbedWorkerHandler(d)(req(jwt('service_role'), { limit: 2 }));
  assertEquals(await res.json(), { ok: true, processed: 2 });
  assertEquals(calls.map((c) => c.fn), ['embedding_jobs_claim', 'embedding_job_store', 'embedding_job_store']);
  assertEquals(calls[1].args, { p_job_id: 'j1', p_embedding: stubEmbed(embedText(JOB)), p_model: 'text-embedding-3-small' });
  assertEquals(calls[2].args.p_model, 'stub-v1');
});

Deno.test('fails a job whose store errors and goes on', async () => {
  const { d, calls } = deps({
    embedding_jobs_claim: { data: [JOB], error: null },
    embedding_job_store: { data: null, error: { message: 'boom' } },
  });
  const res = await createEmbedWorkerHandler(d)(req(jwt('service_role')));
  assertEquals(await res.json(), { ok: true, processed: 0 });
  assertEquals(calls[2], { fn: 'embedding_job_fail', args: { p_job_id: 'j1', p_error: 'boom' } });
});

Deno.test('answers 500 when the claim fails', async () => {
  const { d } = deps({ embedding_jobs_claim: { data: null, error: { message: 'down' } } });
  const res = await createEmbedWorkerHandler(d)(req(jwt('service_role')));
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { ok: false, error: 'down' });
});

Deno.test('builds the text from title, summary and details, as the worker always did', () => {
  assertEquals(embedText(JOB), 'Sofa\nblue\n{"item_condition":"Good"}');
  assertEquals(embedText({ title: 'T', summary: null, details: null }), 'T\n\n{}');
  assertEquals(embedText({ title: 'x'.repeat(9000), summary: null, details: {} }).length, 8000);
  const v = stubEmbed('abc');
  assertEquals(v.length, 1536);
  assertEquals(Math.round(v.reduce((s, x) => s + x * x, 0) * 1e6), 1e6);
});
