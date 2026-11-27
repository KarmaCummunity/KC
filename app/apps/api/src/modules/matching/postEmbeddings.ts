// Drains the post embedding jobs (the `post_embeddings` part of the matching
// schema). Three database functions: `embedding_jobs_claim` turns `embedding`
// outbox events into jobs and hands out up to a limit, never the same job to
// two runs; `embedding_job_store` stores the vector (a job re-queued since the
// claim stays waiting); `embedding_job_fail` records a failure.
//
// The embedder is still a placeholder until a provider is wired (TD-269): the
// vector is a deterministic function of the text, enough to exercise the
// pipeline, not to rank by meaning.
//
// Ported from `supabase/functions/embed-worker/handler.ts`.

import type { JobReport } from '../../platform/jobs/scheduledJob';

/** A claimed job and the post text fields it embeds (`job_id` equals `post_id`). */
export interface ClaimedEmbeddingJob {
  readonly job_id: string;
  readonly post_id: string;
  readonly model: string | null;
  readonly title: string;
  readonly summary: string | null;
  readonly details: unknown;
}

export interface EmbeddingDeps {
  /** Calls `embedding_jobs_claim(limit)`; rejects on a database error. */
  readonly claim: (limit: number) => Promise<ClaimedEmbeddingJob[]>;
  /** Calls `embedding_job_store`; resolves to the database's error message, or null when stored. */
  readonly store: (jobId: string, embedding: number[], model: string) => Promise<string | null>;
  /** Calls `embedding_job_fail`. */
  readonly fail: (jobId: string, reason: string) => Promise<void>;
}

export const DEFAULT_EMBEDDING_BATCH = 20;
export const MAX_EMBEDDING_BATCH = 50;
/** Dimensions of the stored vectors. */
const EMBEDDING_DIMENSIONS = 1536;
/** Longest text that is embedded, in characters. */
const MAX_EMBEDDED_TEXT = 8000;
/** Provenance stored with a placeholder vector when the job names no model. */
const STUB_MODEL = 'stub-v1';

/** A deterministic unit vector from the text. A placeholder: not for ranking quality. */
export function stubEmbed(text: string, dimensions = EMBEDDING_DIMENSIONS): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  for (let index = 0; index < text.length; index += 1) {
    vector[index % dimensions] = (vector[index % dimensions] as number) + text.charCodeAt(index) / 1000;
  }
  // An empty text gives a zero vector; dividing by 1 keeps it finite.
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / norm);
}

/** The text a post is embedded from: its title, summary and details. */
export function embedText(job: Pick<ClaimedEmbeddingJob, 'title' | 'summary' | 'details'>): string {
  return [job.title, job.summary ?? '', JSON.stringify(job.details ?? {})].join('\n').slice(0, MAX_EMBEDDED_TEXT);
}

/**
 * Claims up to `limit` jobs and stores a vector for each. One job's failure is
 * recorded on that job and does not stop the others.
 * @returns `{ processed }`. Rejects when the jobs could not be claimed.
 */
export async function embedClaimedPosts(limit: number, deps: EmbeddingDeps): Promise<JobReport> {
  let processed = 0;
  for (const job of await deps.claim(limit)) {
    const refusal = await deps.store(job.job_id, stubEmbed(embedText(job)), job.model ?? STUB_MODEL);
    if (refusal === null) processed += 1;
    else await deps.fail(job.job_id, refusal);
  }
  return { processed };
}
