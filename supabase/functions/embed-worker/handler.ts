// embed-worker — Issue #827, G1 step 6a-6b (0634). Logic lives here so it is unit-tested with
// mocks. Drains embedding_jobs through three service-role RPCs: embedding_jobs_claim (FOR UPDATE
// SKIP LOCKED, so two runs never take the same job), embedding_job_store (the post's embedding for
// a post-owned listing, the listing's otherwise; a job re-queued since the claim stays pending) and
// embedding_job_fail. The embedder is still a placeholder until a provider is wired (TD-269).

type RpcResult = { data: unknown; error: { message: string } | null };

export interface EmbedWorkerDeps {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<RpcResult>;
}

/** A claimed job and the listing text fields it embeds (embedding_jobs_claim). */
export interface ClaimedJob {
  job_id: string;
  listing_id: string;
  model: string | null;
  title: string;
  summary: string | null;
  details: unknown;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function isServiceRoleJwt(bearer: string): boolean {
  if (!bearer.startsWith('Bearer ')) return false;
  const token = bearer.slice(7);
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload?.role === 'service_role';
  } catch {
    return false;
  }
}

/** Deterministic stub vector from text (not for production ranking quality). */
export function stubEmbed(text: string, dims = 1536): number[] {
  const out = new Array<number>(dims).fill(0);
  for (let i = 0; i < text.length; i++) {
    out[i % dims] += text.charCodeAt(i) / 1000;
  }
  const norm = Math.sqrt(out.reduce((s, v) => s + v * v, 0)) || 1;
  return out.map((v) => v / norm);
}

/** The text a listing is embedded from: title, summary and details, as the worker always built it. */
export function embedText(job: Pick<ClaimedJob, 'title' | 'summary' | 'details'>): string {
  return [job.title, job.summary ?? '', JSON.stringify(job.details ?? {})]
    .join('\n')
    .slice(0, 8000);
}

export function createEmbedWorkerHandler(deps: EmbedWorkerDeps) {
  return async (req: Request): Promise<Response> => {
    const auth = req.headers.get('Authorization') ?? '';
    if (!isServiceRoleJwt(auth)) {
      return json({ ok: false, error: 'unauthenticated' }, 401);
    }

    const limit = Math.min(Number((await req.json().catch(() => ({}))).limit) || 20, 50);
    const claim = await deps.rpc('embedding_jobs_claim', { p_limit: limit });
    if (claim.error) return json({ ok: false, error: claim.error.message }, 500);
    const jobs = (claim.data ?? []) as ClaimedJob[];
    if (!jobs.length) return json({ ok: true, processed: 0 });

    let processed = 0;
    for (const job of jobs) {
      const vector = stubEmbed(embedText(job));
      const stored = await deps.rpc('embedding_job_store', {
        p_job_id: job.job_id,
        p_embedding: vector,
        p_model: job.model ?? 'stub-v1',
      });
      if (stored.error) {
        await deps.rpc('embedding_job_fail', { p_job_id: job.job_id, p_error: stored.error.message });
        continue;
      }
      processed += 1;
    }

    return json({ ok: true, processed });
  };
}
