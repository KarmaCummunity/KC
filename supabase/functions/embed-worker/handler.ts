// embed-worker — drains the post embedding jobs (supabase/schemas/76_matching/020_post_embeddings.sql).
// Started every two minutes by the database job `embed_worker`. Three service-role RPCs:
// embedding_jobs_claim (turns `embedding` outbox events into jobs and hands out up to p_limit,
// never the same job to two runs), embedding_job_store (stores the vector; a job re-queued
// since the claim stays waiting) and embedding_job_fail. Logic lives here so it is unit-tested
// with mocks. The embedder is still a placeholder until a provider is wired (TD-269).

import { isServiceRoleRequest, serviceRoleRequiredResponse } from '../_shared/serviceRoleGuard.ts';

type RpcResult = { data: unknown; error: { message: string } | null };

export interface EmbedWorkerDeps {
  /** The project's service-role key; the only credential the worker accepts. */
  serviceRoleKey: string;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<RpcResult>;
}

/** A claimed job and the post text fields it embeds (embedding_jobs_claim; job_id equals post_id). */
export interface ClaimedJob {
  job_id: string;
  post_id: string;
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

/** Deterministic stub vector from text (not for production ranking quality). */
export function stubEmbed(text: string, dims = 1536): number[] {
  const out = new Array<number>(dims).fill(0);
  for (let i = 0; i < text.length; i++) {
    out[i % dims] += text.charCodeAt(i) / 1000;
  }
  const norm = Math.sqrt(out.reduce((s, v) => s + v * v, 0)) || 1;
  return out.map((v) => v / norm);
}

/** The text a post is embedded from: title, summary and details, as the worker always built it. */
export function embedText(job: Pick<ClaimedJob, 'title' | 'summary' | 'details'>): string {
  return [job.title, job.summary ?? '', JSON.stringify(job.details ?? {})]
    .join('\n')
    .slice(0, 8000);
}

export function createEmbedWorkerHandler(deps: EmbedWorkerDeps) {
  return async (req: Request): Promise<Response> => {
    if (!isServiceRoleRequest(req, deps.serviceRoleKey)) return serviceRoleRequiredResponse();

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
