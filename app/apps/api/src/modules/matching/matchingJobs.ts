import { Inject, Injectable } from '@nestjs/common';
import { GeminiClient } from '../../platform/ai/geminiClient';
import type { ApiConfig } from '../../platform/config/apiConfig';
import { API_CONFIG } from '../../platform/config/apiConfig.module';
import { batchLimit, type JobReport, type ScheduledJob } from '../../platform/jobs/scheduledJob';
import { PortClients } from '../../platform/ports/portClients';
import { type PendingPair, rerankPendingMatches } from './matchRerank';
import { type ClaimedEmbeddingJob, DEFAULT_EMBEDDING_BATCH, embedClaimedPosts, MAX_EMBEDDING_BATCH } from './postEmbeddings';

/** Injection token of the model client the re-rank asks (replaced in tests, so none reaches the network). */
export const MATCH_RERANK_MODEL = Symbol('MATCH_RERANK_MODEL');

/** The model client the configuration describes; without a key the re-rank skips its runs. */
export function matchRerankModelFor(config: ApiConfig): GeminiClient {
  return new GeminiClient(config.gemini);
}

/** Runs every two minutes: gives new and edited posts their embedding. The rules are in `postEmbeddings.ts`. */
@Injectable()
export class EmbedPostsJob implements ScheduledJob {
  readonly name = 'embed-worker';

  constructor(@Inject(PortClients) private readonly clients: PortClients) {}

  /** @param input `{ limit? }`: how many jobs to claim in this run (20 by default, 50 at most). */
  run(input: Readonly<Record<string, unknown>>): Promise<JobReport> {
    const service = this.clients.serviceClient();
    return embedClaimedPosts(batchLimit(input.limit, DEFAULT_EMBEDDING_BATCH, MAX_EMBEDDING_BATCH), {
      async claim(limit) {
        const { data, error } = await service.rpc('embedding_jobs_claim', { p_limit: limit });
        if (error) throw new Error(`embedding_jobs_claim: ${error.message}`);
        return (data ?? []) as ClaimedEmbeddingJob[];
      },
      async store(jobId, embedding, model) {
        const { error } = await service.rpc('embedding_job_store', { p_job_id: jobId, p_embedding: embedding, p_model: model });
        return error ? error.message : null;
      },
      async fail(jobId, reason) {
        await service.rpc('embedding_job_fail', { p_job_id: jobId, p_error: reason });
      },
    });
  }
}

/** Runs every five minutes: the optional model re-rank of match candidates. The rules are in `matchRerank.ts`. */
@Injectable()
export class MatchRerankJob implements ScheduledJob {
  readonly name = 'match-rerank';

  constructor(
    @Inject(PortClients) private readonly clients: PortClients,
    @Inject(MATCH_RERANK_MODEL) private readonly model: Pick<GeminiClient, 'generateJson'>,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  run(): Promise<JobReport> {
    const service = this.clients.serviceClient();
    return rerankPendingMatches({
      modelConfigured: this.config.gemini.apiKey !== null,
      async pending(limit) {
        const { data, error } = await service.rpc('api_match_llm_pending', { p_limit: limit });
        if (error) throw new Error(`api_match_llm_pending: ${error.message}`);
        return (data ?? []) as PendingPair[];
      },
      ask: (systemInstruction, userText) => this.model.generateJson({ systemInstruction, userText }),
      async store(verdict) {
        const { error } = await service.rpc('api_match_llm_store', { p_candidate_id: verdict.candidate_id, p_score: verdict.score, p_reason: verdict.reason });
        return !error;
      },
    });
  }
}
